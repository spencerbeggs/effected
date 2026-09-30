import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber, FileSystem, Option } from "effect";
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
