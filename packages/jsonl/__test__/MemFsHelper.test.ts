import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber, FileSystem, Option, PlatformError } from "effect";
import { makeMemFs } from "./helpers/memfs.js";

const PATH = "/gate/file.txt";

/**
 * The read gate's own contract.
 *
 * Every read in `src` is sized by a `stat` taken before the file is opened, so
 * for an append-only journal the two `sampleFirst` orders are
 * indistinguishable through the Journal — the stat bound hides the difference.
 * The order matters only to a test that relies on it (the query stat-bound
 * test needs `false` to actually sample after the write, or it goes vacuous),
 * so it is pinned here, at the helper, with an UNBOUNDED read that can see it.
 */
const gatedRead = (sampleFirst: boolean) =>
	Effect.gen(function* () {
		const memfs = makeMemFs();
		memfs.write(PATH, "abc");
		const text = yield* Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = yield* fs.open(PATH, { flag: "r" });
			const gate = memfs.gateNextRead({ sampleFirst });
			const running = yield* Effect.forkChild(file.readAlloc(64));
			yield* Effect.promise(() => gate.entered);
			memfs.write(PATH, "abcdef");
			gate.release();
			const read = yield* Fiber.join(running);
			return new TextDecoder().decode(Option.getOrElse(read, () => new Uint8Array(0)));
		}).pipe(Effect.scoped, Effect.provide(memfs.layer));
		return text;
	}).pipe(Effect.timeout(Duration.seconds(10)));

describe("gateNextRead", () => {
	it.effect("sampleFirst: true returns the bytes as of the moment the read sampled", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* gatedRead(true), "abc", "the write inside the gate is not observed");
		}),
	);

	it.effect("sampleFirst: false samples after the suspension, so the read observes the write", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* gatedRead(false), "abcdef", "the write inside the gate is observed");
		}),
	);
});

describe("makeMemFs faults", () => {
	const denied = PlatformError.systemError({
		_tag: "PermissionDenied",
		module: "FileSystem",
		method: "open",
		pathOrDescriptor: PATH,
	});

	it.effect("an extra fault runs AHEAD of the helper's decorations", () =>
		Effect.gen(function* () {
			let calls = 0;
			const memfs = makeMemFs({
				faults: () => ({
					open: () => {
						calls += 1;
						return Effect.fail(denied);
					},
				}),
			});
			memfs.write(PATH, "abc");
			const failed = yield* Effect.flip(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					return yield* fs.open(PATH, { flag: "r" });
				}).pipe(Effect.scoped, Effect.provide(memfs.layer)),
			);
			assert.strictEqual(calls, 1);
			assert.strictEqual(failed.reason._tag, "PermissionDenied");
		}),
	);

	it.effect("a DECLINING extra fault still gets the helper's gated handle", () =>
		Effect.gen(function* () {
			let calls = 0;
			const memfs = makeMemFs({
				faults: () => ({
					open: () => {
						calls += 1;
						return undefined;
					},
				}),
			});
			memfs.write(PATH, "abc");
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const file = yield* fs.open(PATH, { flag: "r" });
				yield* file.readAlloc(3);
			}).pipe(Effect.scoped, Effect.provide(memfs.layer));
			assert.strictEqual(calls, 1, "the extra handler was consulted");
			assert.deepStrictEqual(memfs.readRequests(), [3], "and the read went through the instrumented handle");
		}),
	);
});
