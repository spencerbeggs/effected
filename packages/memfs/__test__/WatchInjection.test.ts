// Deterministic watch injection: `watchEvents: "manual"` stops mutations from
// publishing watch events, and a handle's `emit` delivers exactly the events a
// test chooses — through the same path matching a real event takes.
// `watcherCount` is the live number of subscribed watchers.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { firstEvent } from "./helpers.js";

const seed = { "/d/a.txt": "a", "/other": MemoryFileSystem.directory() } as const;

describe("watchEvents: manual", () => {
	it.effect("a mutation publishes nothing; the emitted event is the first one seen", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed, { watchEvents: "manual" });
			const event = yield* firstEvent(
				handle.fileSystem,
				"/d",
				undefined,
				handle.fileSystem.writeFileString("/d/b.txt", "b"),
				Effect.sync(() => handle.emit("/d/a.txt", "Update")),
			);
			assert.deepStrictEqual(event, { _tag: "Update", path: "/d/a.txt" });
		}),
	);

	it.effect("emit goes through path matching: an event outside the watch is not delivered", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed, { watchEvents: "manual" });
			const event = yield* firstEvent(
				handle.fileSystem,
				"/d",
				undefined,
				Effect.sync(() => handle.emit("/other/x.txt", "Create")),
				Effect.sync(() => handle.emit("/d/x.txt", "Remove")),
			);
			assert.deepStrictEqual(event, { _tag: "Remove", path: "/d/x.txt" });
		}),
	);

	it.effect("a relative emit path joins the root and is normalized", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "a.txt": "a" }, { root: "/ws", watchEvents: "manual" });
			const event = yield* firstEvent(
				handle.fileSystem,
				"/ws",
				undefined,
				Effect.sync(() => handle.emit("./sub/../a.txt", "Update")),
				Effect.void,
			);
			assert.deepStrictEqual(event, { _tag: "Update", path: "/ws/a.txt" });
		}),
	);
});

describe("handle.emit under automatic events", () => {
	it.effect("delivers alongside the events mutations publish", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed);
			const event = yield* firstEvent(
				handle.fileSystem,
				"/d",
				undefined,
				Effect.sync(() => handle.emit("/d/a.txt", "Create")),
				handle.fileSystem.writeFileString("/d/b.txt", "b"),
			);
			assert.deepStrictEqual(event, { _tag: "Create", path: "/d/a.txt" });
		}),
	);

	it.effect("is the default: a mutation still publishes its own event", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed);
			const event = yield* firstEvent(
				handle.fileSystem,
				"/d",
				undefined,
				handle.fileSystem.writeFileString("/d/b.txt", "b"),
				Effect.sync(() => handle.emit("/d/a.txt", "Update")),
			);
			assert.deepStrictEqual(event, { _tag: "Create", path: "/d/b.txt" });
		}),
	);
});

describe("handle.watcherCount", () => {
	it.effect("counts live subscriptions: 0, then 1 once ready, then 0 after the stream ends", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed, { watchEvents: "manual" });
			assert.strictEqual(handle.watcherCount(), 0);
			let ready = false;
			const fiber = yield* handle.fileSystem
				.watch("/d", { onReady: () => (ready = true) })
				.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
			yield* Effect.yieldNow;
			assert.isTrue(ready);
			assert.strictEqual(handle.watcherCount(), 1);
			handle.emit("/d/a.txt", "Update");
			yield* Fiber.join(fiber);
			assert.strictEqual(handle.watcherCount(), 0);
		}),
	);

	it.effect("an interrupted watcher is released", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(seed);
			const fs: FileSystem.FileSystem = handle.fileSystem;
			const fiber = yield* fs.watch("/d").pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));
			yield* Effect.yieldNow;
			assert.strictEqual(handle.watcherCount(), 1);
			yield* Fiber.interrupt(fiber);
			assert.strictEqual(handle.watcherCount(), 0);
		}),
	);
});

// Whether a watcher on /d has received an event once a write has had a few
// scheduler turns to publish. The automatic case is the positive control that
// keeps the manual assertion from passing vacuously.
const eventSeenAfterWrite = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const fiber = yield* fs
		.watch("/d")
		.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
	yield* Effect.yieldNow;
	yield* fs.writeFileString("/d/b.txt", "b");
	for (let turn = 0; turn < 5; turn++) yield* Effect.yieldNow;
	const seen = fiber.pollUnsafe() !== undefined;
	yield* Fiber.interrupt(fiber);
	return seen;
});

describe("watchEvents through the layer forms", () => {
	it.effect("control: under automatic events, the write is seen", () =>
		Effect.gen(function* () {
			assert.isTrue(yield* eventSeenAfterWrite);
		}).pipe(Effect.provide(MemoryFileSystem.layerWith(seed))),
	);

	it.effect("layerWith accepts the option: mutations publish nothing", () =>
		Effect.gen(function* () {
			assert.isFalse(yield* eventSeenAfterWrite);
		}).pipe(Effect.provide(MemoryFileSystem.layerWith(seed, { watchEvents: "manual" }))),
	);
});
