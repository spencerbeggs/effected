import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemHandle, MemoryFileSystemOptions, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem, Path } from "effect";
import { Deferred, Effect, Fiber, PlatformError, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { NotAnActionError } from "../../src/build/ActionRun.js";
import { NotAPackageError } from "../../src/build/BuildRun.js";
import type { WatchTrigger } from "../../src/build/BuildWatch.js";
import { BuildWatch, DEFAULT_EXCLUDES } from "../../src/build/BuildWatch.js";

const ROOT = "/repo";
const CWD = `${ROOT}/packages/a`;

const SEED: MemoryFileSystemSeed = {
	[`${ROOT}/package.json`]: "{}",
	[`${ROOT}/.config/effected.toml`]: "",
	[`${CWD}/package.json`]: "{}",
	[`${CWD}/src/index.ts`]: "",
};

/** Lets every forked fiber run until it blocks. */
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

const waitForWatchers = (handle: MemoryFileSystemHandle, count: number) =>
	Effect.gen(function* () {
		for (let turn = 0; turn < 500 && handle.watcherCount() < count; turn++) yield* Effect.yieldNow;
		assert.strictEqual(handle.watcherCount(), count);
		yield* settle;
	});

const changed = (...paths: ReadonlyArray<string>): WatchTrigger => ({ _tag: "Changed", paths });

interface Harness {
	readonly handle: MemoryFileSystemHandle;
	readonly triggers: Effect.Effect<ReadonlyArray<WatchTrigger>>;
	readonly fiber: Fiber.Fiber<never, PlatformError.PlatformError>;
}

/** Forks `run` over a manual-events volume and waits for its watchers to be installed. */
const start = (options: {
	readonly seed?: MemoryFileSystemSeed;
	readonly cwd?: string;
	readonly watchers?: number;
	readonly exclude?: Effect.Effect<ReadonlyArray<string>>;
}) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(options.seed ?? SEED, { watchEvents: "manual" });
		const log = yield* Ref.make<ReadonlyArray<WatchTrigger>>([]);
		const fiber = yield* BuildWatch.run({
			cwd: options.cwd ?? CWD,
			root: ROOT,
			exclude: options.exclude ?? Effect.succeed(DEFAULT_EXCLUDES),
			build: (trigger) => Ref.update(log, (all) => [...all, trigger]),
		}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
		yield* waitForWatchers(handle, options.watchers ?? 3);
		const harness: Harness = { handle, triggers: Ref.get(log), fiber };
		return harness;
	});

/** Emits each event, then lets the debounce elapse. */
const burst = (
	handle: MemoryFileSystemHandle,
	events: ReadonlyArray<readonly [string, "Create" | "Update" | "Remove"]>,
) =>
	Effect.gen(function* () {
		for (const [path, event] of events) handle.emit(path, event);
		yield* settle;
		yield* TestClock.adjust("100 millis");
		yield* settle;
	});

describe("BuildWatch.run", () => {
	it.effect("runs Initial before any event", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, { watchEvents: "manual" });
			const seen = yield* Ref.make<ReadonlyArray<readonly [WatchTrigger, number]>>([]);
			const fiber = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: (trigger) => Ref.update(seen, (all) => [...all, [trigger, handle.watcherCount()] as const]),
			}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
			yield* waitForWatchers(handle, 3);
			// Every watcher was installed when Initial ran, so no edit made after it can be lost.
			assert.deepStrictEqual(yield* Ref.get(seen), [[{ _tag: "Initial" }, 3]]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("collapses a burst within the debounce into one batch", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			handle.emit(`${CWD}/src/a.ts`, "Update");
			yield* settle;
			yield* TestClock.adjust("30 millis");
			handle.emit(`${CWD}/src/b.ts`, "Create");
			yield* settle;
			yield* TestClock.adjust("30 millis");
			handle.emit(`${CWD}/src/a.ts`, "Update");
			yield* settle;
			yield* TestClock.adjust("99 millis");
			yield* settle;
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }], "the window is not quiet yet");
			yield* TestClock.adjust("1 millis");
			yield* settle;
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("src/a.ts", "src/b.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("treats a save-by-rename as one path", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(handle, [
				[`${CWD}/src/index.ts`, "Create"],
				[`${CWD}/src/index.ts`, "Remove"],
				[`${CWD}/src/index.ts`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("src/index.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("ignores every default exclusion", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(
				handle,
				DEFAULT_EXCLUDES.flatMap((exclude) => [
					[`${CWD}/${exclude}`, "Update"] as const,
					[`${CWD}/${exclude}/nested/file.js`, "Create"] as const,
				]),
			);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("does not exclude a path that merely shares a prefix", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(handle, [
				[`${CWD}/distribution/x.ts`, "Update"],
				[`${CWD}/.github/actions/local-notes.md`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed(".github/actions/local-notes.md", "distribution/x.ts"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("re-reads exclude before each batch", () =>
		Effect.gen(function* () {
			const excludes = yield* Ref.make<ReadonlyArray<string>>(["generated"]);
			const { handle, triggers, fiber } = yield* start({ exclude: Ref.get(excludes) });
			yield* burst(handle, [
				[`${CWD}/generated/a.ts`, "Update"],
				[`${CWD}/out/a.ts`, "Update"],
			]);
			yield* Ref.set(excludes, ["out"]);
			yield* burst(handle, [
				[`${CWD}/generated/b.ts`, "Update"],
				[`${CWD}/out/b.ts`, "Update"],
			]);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("out/a.ts"), changed("generated/b.ts")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("watches the root tier for effected.toml only", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({});
			yield* burst(handle, [[`${ROOT}/effected.toml`, "Create"]]);
			yield* burst(handle, [[`${ROOT}/README.md`, "Update"]]);
			yield* burst(handle, [[`${ROOT}/.config/effected.toml`, "Update"]]);
			assert.deepStrictEqual(yield* triggers, [
				{ _tag: "Initial" },
				changed("../../effected.toml"),
				changed("../../.config/effected.toml"),
			]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("skips a missing .config directory", () =>
		Effect.gen(function* () {
			const seed: MemoryFileSystemSeed = {
				[`${ROOT}/package.json`]: "{}",
				[`${CWD}/package.json`]: "{}",
			};
			const { handle, triggers, fiber } = yield* start({ seed, watchers: 2 });
			yield* burst(handle, [[`${ROOT}/effected.toml`, "Create"]]);
			assert.isUndefined(fiber.pollUnsafe(), "run is still watching");
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }, changed("../../effected.toml")]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("does not watch the root tier when root is cwd", () =>
		Effect.gen(function* () {
			const { handle, triggers, fiber } = yield* start({ cwd: ROOT, watchers: 1 });
			yield* burst(handle, [
				[`${ROOT}/.cache/effected/build.jsonl`, "Update"],
				[`${ROOT}/.cache/effected/locks/a.lock`, "Create"],
			]);
			assert.strictEqual(handle.watcherCount(), 1);
			assert.deepStrictEqual(yield* triggers, [{ _tag: "Initial" }]);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("queues exactly one follow-up for changes during a build", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, { watchEvents: "manual" });
			const log = yield* Ref.make<ReadonlyArray<WatchTrigger>>([]);
			const running = yield* Ref.make(0);
			const peak = yield* Ref.make(0);
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const build = (trigger: WatchTrigger) =>
				Effect.gen(function* () {
					const now = yield* Ref.updateAndGet(running, (n) => n + 1);
					yield* Ref.update(peak, (p) => Math.max(p, now));
					yield* Ref.update(log, (all) => [...all, trigger]);
					const changes = yield* Ref.get(log);
					if (changes.length === 2) {
						yield* Deferred.succeed(entered, undefined);
						yield* Deferred.await(release);
					}
					yield* Ref.update(running, (n) => n - 1);
				});
			const fiber = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build,
			}).pipe(Effect.provide(handle.layer), Effect.forkChild({ startImmediately: true }));
			yield* waitForWatchers(handle, 3);
			yield* burst(handle, [[`${CWD}/src/first.ts`, "Update"]]);
			yield* Deferred.await(entered);
			for (const name of ["c", "a", "b"]) {
				handle.emit(`${CWD}/src/${name}.ts`, "Update");
				yield* settle;
				yield* TestClock.adjust("150 millis");
				yield* settle;
			}
			assert.strictEqual((yield* Ref.get(log)).length, 2, "no build starts while one runs");
			yield* Deferred.succeed(release, undefined);
			yield* settle;
			yield* TestClock.adjust("100 millis");
			yield* settle;
			assert.deepStrictEqual(yield* Ref.get(log), [
				{ _tag: "Initial" },
				changed("src/first.ts"),
				changed("src/a.ts", "src/b.ts", "src/c.ts"),
			]);
			yield* TestClock.adjust("1 second");
			yield* settle;
			assert.strictEqual((yield* Ref.get(log)).length, 3, "exactly one follow-up");
			assert.strictEqual(yield* Ref.get(peak), 1);
			yield* Fiber.interrupt(fiber);
		}),
	);

	it.effect("fails with the watcher's PlatformError", () =>
		Effect.gen(function* () {
			const failure = PlatformError.systemError({
				_tag: "Unknown",
				module: "FileSystem",
				method: "watch",
				pathOrDescriptor: CWD,
				description: "watcher died",
			});
			const options: MemoryFileSystemOptions = {
				watchEvents: "manual",
				faults: (base) => ({
					watch: (path, watchOptions) => (path === CWD ? Stream.fail(failure) : base.watch(path, watchOptions)),
				}),
			};
			const handle = yield* MemoryFileSystem.makeHandle(SEED, options);
			const error = yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: () => Effect.void,
			}).pipe(Effect.provide(handle.layer), Effect.flip);
			assert.strictEqual(error, failure);
		}),
	);

	/** Runs `run` over a volume whose `watch` ends at once for every directory `ends` accepts, and returns its error. */
	const runWithEndingWatch = (ends: (dir: string) => boolean) =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(SEED, {
				watchEvents: "manual",
				faults: (base) => ({
					watch: (path, watchOptions) => (ends(path) ? Stream.empty : base.watch(path, watchOptions)),
				}),
			});
			return yield* BuildWatch.run({
				cwd: CWD,
				root: ROOT,
				exclude: Effect.succeed(DEFAULT_EXCLUDES),
				build: () => Effect.void,
			}).pipe(Effect.provide(handle.layer), Effect.flip);
		});

	/** The stopped-watcher error's `SystemError`, failing the test when the reason is anything else. */
	const stoppedReason = (error: PlatformError.PlatformError) => {
		const reason = error.reason;
		assert.instanceOf(reason, PlatformError.SystemError);
		if (!(reason instanceof PlatformError.SystemError)) throw new Error("unreachable");
		assert.strictEqual(reason._tag, "Unknown");
		assert.strictEqual(reason.method, "watch");
		assert.strictEqual(reason.description, "The watcher stopped.");
		return reason;
	};

	it.effect("fails when every watcher stops", () =>
		Effect.gen(function* () {
			const reason = stoppedReason(yield* runWithEndingWatch(() => true));
			assert.include([CWD, ROOT, `${ROOT}/.config`], reason.pathOrDescriptor);
		}),
	);

	it.effect("fails when the package watcher stops while the root tier stays live", () =>
		Effect.gen(function* () {
			const reason = stoppedReason(yield* runWithEndingWatch((dir) => dir === CWD));
			assert.strictEqual(reason.pathOrDescriptor, CWD);
		}),
	);
});

/** A pnpm workspace at ROOT with one package at CWD, plus whatever `extra` adds. */
const workspace = (extra: MemoryFileSystemSeed = {}): MemoryFileSystemSeed => ({
	[`${ROOT}/package.json`]: JSON.stringify({ name: "root" }),
	[`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"\n',
	[`${CWD}/package.json`]: JSON.stringify({ name: "@scope/a" }),
	...extra,
});

const inVolume = <A, E>(seed: MemoryFileSystemSeed, effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(seed);
		return yield* effect.pipe(Effect.provide(handle.layer));
	});

describe("BuildWatch.target", () => {
	it.effect("target fails NotAPackageError without a package.json", () =>
		Effect.gen(function* () {
			const { [`${CWD}/package.json`]: _manifest, ...seed } = workspace();
			const error = yield* inVolume(seed, Effect.flip(BuildWatch.target(CWD, "package")));
			assert.instanceOf(error, NotAPackageError);
		}),
	);

	it.effect("target fails NotAnActionError for an action whose config has no [action] table", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: '[package.build]\ncopy = ["public"]\n' });
			const error = yield* inVolume(seed, Effect.flip(BuildWatch.target(CWD, "action")));
			assert.instanceOf(error, NotAnActionError);
		}),
	);

	it.effect("target succeeds for an action whose effected.toml does not parse", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[action\n" });
			const target = yield* inVolume(seed, BuildWatch.target(CWD, "action"));
			assert.deepStrictEqual(target, { cwd: CWD, root: ROOT });
		}),
	);

	it.effect("target resolves the workspace root above cwd", () =>
		Effect.gen(function* () {
			const target = yield* inVolume(workspace(), BuildWatch.target(CWD, "package"));
			assert.deepStrictEqual(target, { cwd: CWD, root: ROOT });
		}),
	);
});

describe("BuildWatch.actionExcludes", () => {
	it.effect("actionExcludes adds a custom persistLocal.path", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: '[action.persistLocal]\npath = "out/local"\n' });
			const excludes = yield* inVolume(seed, BuildWatch.actionExcludes({ cwd: CWD, root: ROOT }));
			assert.include(excludes, "out/local");
			for (const entry of DEFAULT_EXCLUDES) assert.include(excludes, entry);
		}),
	);

	it.effect("actionExcludes falls back to the defaults when the config will not load", () =>
		Effect.gen(function* () {
			const seed = workspace({ [`${CWD}/effected.toml`]: "[action\n" });
			const excludes = yield* inVolume(seed, BuildWatch.actionExcludes({ cwd: CWD, root: ROOT }));
			assert.deepStrictEqual(excludes, DEFAULT_EXCLUDES);
		}),
	);
});
