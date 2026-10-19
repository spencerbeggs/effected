// Adaptation-ledger entry: watch calls core's WatchOptions.onReady once its
// subscription is registered, which the pinned upstream predates.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Latch, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { MemoryFileSystem } from "../src/index.js";

describe("watch calls WatchOptions.onReady — the port adaptation", () => {
	it.effect("onReady fires once, and a write after it is delivered", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/ready/existing.txt": "x" });
			const ready = yield* Latch.make();
			let calls = 0;
			const events = yield* fs
				.watch("/ready", {
					onReady: () => {
						calls++;
						ready.openUnsafe();
					},
				})
				.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);

			// Only onReady orders the write after registration: no scheduler yield.
			const opened = yield* ready.await.pipe(Effect.timeoutOption("1 second"), TestClock.withLive);
			assert.isTrue(Option.isSome(opened));
			yield* fs.writeFileString("/ready/file.txt", "content");

			assert.deepStrictEqual(Array.from(yield* Fiber.join(events)), [{ _tag: "Create", path: "/ready/file.txt" }]);
			assert.strictEqual(calls, 1);
		}),
	);

	it.effect("a watch on a missing path fails without calling onReady", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({});
			let calls = 0;
			const error = yield* fs
				.watch("/missing", {
					onReady: () => {
						calls++;
					},
				})
				.pipe(Stream.runDrain, Effect.flip);

			assert.strictEqual(error.reason._tag, "NotFound");
			assert.strictEqual(calls, 0);
		}),
	);
});
