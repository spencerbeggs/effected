import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemHandle } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Deferred, Effect, Exit, Fiber, Option, Path, Ref } from "effect";
import type { BuildLockHolder, BuildLockOptions } from "../../src/build/BuildLock.js";
import { BuildLockTimeoutError, acquireBuildLock, buildLockPath } from "../../src/build/BuildLock.js";

const ROOT = "/repo";
const CWD = `${ROOT}/packages/a`;
const LOCK = `${ROOT}/.cache/effected/locks/@scope+a.lock`;

const alive: BuildLockOptions = { pid: 100, isAlive: () => true, pollInterval: "2 millis" };

const holderText = (pid: number) => JSON.stringify({ pid, startedAt: "2026-11-10T12:00:00.000Z", cwd: CWD });

/** Holds the lock until `release` completes, signalling `held` once it is taken. */
const holdUntil = (
	handle: MemoryFileSystemHandle,
	options: BuildLockOptions,
	held: Deferred.Deferred<void>,
	release: Deferred.Deferred<void>,
	onWaiting?: (holder: Option.Option<BuildLockHolder>) => Effect.Effect<void>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			yield* acquireBuildLock(LOCK, CWD, options, onWaiting);
			yield* Deferred.succeed(held, undefined);
			yield* Deferred.await(release);
		}),
	).pipe(Effect.provide(handle.layer));

describe("buildLockPath", () => {
	it.effect("keeps a scoped name readable and inside the locks directory", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			assert.strictEqual(buildLockPath(path, ROOT, "@scope/a"), LOCK);
			assert.strictEqual(buildLockPath(path, ROOT, "../../x"), `${ROOT}/.cache/effected/locks/..+..+x.lock`);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("acquireBuildLock", () => {
	it.effect("writes the holder while the scope is open and removes the file when it closes", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({});
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* acquireBuildLock(LOCK, CWD, alive);
					const text = handle.volume.text(LOCK);
					assert.isDefined(text);
					const holder = JSON.parse(text ?? "{}");
					assert.strictEqual(holder.pid, 100);
					assert.strictEqual(holder.cwd, CWD);
				}),
			).pipe(Effect.provide(handle.layer));
			assert.isUndefined(handle.volume.text(LOCK));
		}),
	);

	it.live("a second build waits for the first, is told once who holds it, then takes the lock", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({});
			const firstHeld = yield* Deferred.make<void>();
			const firstRelease = yield* Deferred.make<void>();
			const secondHeld = yield* Deferred.make<void>();
			const secondRelease = yield* Deferred.make<void>();
			const told = yield* Ref.make<ReadonlyArray<Option.Option<BuildLockHolder>>>([]);

			const first = yield* Effect.forkChild(holdUntil(handle, alive, firstHeld, firstRelease));
			yield* Deferred.await(firstHeld);
			const second = yield* Effect.forkChild(
				holdUntil(handle, { ...alive, pid: 200 }, secondHeld, secondRelease, (holder) =>
					Ref.update(told, (all) => [...all, holder]),
				),
			);
			yield* Effect.sleep("30 millis");
			assert.isFalse(yield* Deferred.isDone(secondHeld), "the second build must not take a held lock");

			yield* Deferred.succeed(firstRelease, undefined);
			yield* Fiber.join(first);
			yield* Deferred.await(secondHeld);
			assert.strictEqual(JSON.parse(handle.volume.text(LOCK) ?? "{}").pid, 200);
			const notices = yield* Ref.get(told);
			assert.strictEqual(notices.length, 1);
			assert.strictEqual(Option.getOrThrow(notices[0] ?? Option.none()).pid, 100);

			yield* Deferred.succeed(secondRelease, undefined);
			yield* Fiber.join(second);
			assert.isUndefined(handle.volume.text(LOCK));
		}),
	);

	it.effect("takes over a lock whose process no longer runs", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ [LOCK]: holderText(999) });
			const told = yield* Ref.make(0);
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* acquireBuildLock(LOCK, CWD, { ...alive, isAlive: (pid) => pid !== 999 }, () =>
						Ref.update(told, (n) => n + 1),
					);
					assert.strictEqual(JSON.parse(handle.volume.text(LOCK) ?? "{}").pid, 100);
				}),
			).pipe(Effect.provide(handle.layer));
			assert.strictEqual(yield* Ref.get(told), 0, "a dead holder is not waited for");
		}),
	);

	it.effect("a lock held past the timeout fails naming its holder, and leaves the holder's file alone", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ [LOCK]: holderText(300) });
			const told = yield* Ref.make(0);
			const error = yield* Effect.scoped(
				acquireBuildLock(LOCK, CWD, { ...alive, timeout: 0 }, () => Ref.update(told, (n) => n + 1)),
			).pipe(Effect.provide(handle.layer), Effect.flip);

			assert.instanceOf(error, BuildLockTimeoutError);
			assert.isTrue(error instanceof BuildLockTimeoutError && error.holder?.pid === 300);
			assert.include(error.message, "process 300");
			assert.include(error.message, LOCK);
			assert.strictEqual(yield* Ref.get(told), 1, "the wait is announced before it gives up");
			assert.strictEqual(handle.volume.text(LOCK), holderText(300));
		}),
	);

	it.live("interrupting the holder releases the lock", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({});
			const held = yield* Deferred.make<void>();
			const never = yield* Deferred.make<void>();
			const fiber = yield* Effect.forkChild(holdUntil(handle, alive, held, never));
			yield* Deferred.await(held);
			assert.isDefined(handle.volume.text(LOCK));
			const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
			assert.isTrue(Exit.hasInterrupts(exit));
			assert.isUndefined(handle.volume.text(LOCK));
		}),
	);

	it.live("on a real disk the create is exclusive: a second taker waits until the first lets go", () =>
		Effect.gen(function* () {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "effected-lock-")));
			const lock = join(dir, ".cache", "effected", "locks", "x.lock");
			const order = yield* Ref.make<ReadonlyArray<string>>([]);
			const holder = (name: string, pid: number) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* acquireBuildLock(lock, dir, { ...alive, pid });
						yield* Ref.update(order, (all) => [...all, `${name} in`]);
						yield* Effect.sleep("40 millis");
						yield* Ref.update(order, (all) => [...all, `${name} out`]);
					}),
				);
			yield* Effect.all([holder("a", 1), holder("b", 2)], { concurrency: "unbounded" }).pipe(
				Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
			);
			const seen = yield* Ref.get(order);
			assert.strictEqual(seen.length, 4);
			// Whoever went first left before the other came in.
			assert.strictEqual(seen[0]?.split(" ")[0], seen[1]?.split(" ")[0], seen.join(", "));
			assert.isTrue(seen[1]?.endsWith("out"), seen.join(", "));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
