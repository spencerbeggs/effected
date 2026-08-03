import { assert, describe, it } from "@effect/vitest";
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream, SubscriptionRef } from "effect";
import { Journal, JournalResync, JsonlEvent } from "../src/index.js";
import type { MemFs } from "./helpers/memfs.js";
import { makeMemFs } from "./helpers/memfs.js";

const PATH = "/journal/watch.jsonl";

const Noted = JsonlEvent.make("noted", { data: Schema.Struct({ round: Schema.Number }) });
const events = [Noted] as const;

class WatchJournal extends Journal.Service<WatchJournal>()("test/WatchJournal", { events }) {}

const line = (round: number) =>
	`${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", event: "noted", data: { round } })}\n`;

/** Append to the file behind the journal's back — a foreign writer. */
const externalAppend = (memfs: MemFs, text: string): void => {
	const current = memfs.bytes(PATH);
	const addition = new TextEncoder().encode(text);
	const next = new Uint8Array((current?.length ?? 0) + addition.length);
	if (current !== undefined) next.set(current);
	next.set(addition, current?.length ?? 0);
	memfs.write(PATH, next);
};

/** Build the journal in its own scope so the watcher runs for the test's life. */
const openJournal = (seed?: string) =>
	Effect.gen(function* () {
		const memfs = makeMemFs();
		// The parent directory exists before the journal does — that is what makes
		// watching it for the creation event possible.
		memfs.mkdir("/journal");
		if (seed !== undefined) memfs.write(PATH, seed);
		const layer = WatchJournal.layer({ path: PATH }).pipe(Layer.provide(memfs.layer));
		const scope = yield* Scope.make();
		const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
		// Wait for the forked supervisor to ARM its watch, rather than yielding a
		// hopeful number of times. Asserting the precondition also means a poke
		// into an empty registry cannot masquerade as a working watcher.
		const target = seed === undefined ? "/journal" : PATH;
		for (let attempt = 0; attempt < 50 && memfs.watcherCount(target) === 0; attempt++) {
			yield* Effect.yieldNow;
		}
		assert.isAbove(memfs.watcherCount(target), 0, `the watcher armed on ${target}`);
		return { memfs, scope, journal: Context.get(context, WatchJournal) };
	});

describe("watcher — external growth", () => {
	it.effect("an external append reaches `latest` after a poke", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1));
			externalAppend(memfs, line(2));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 2 }, "the foreign writer's line was ingested");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a subscriber cannot tell an external append from a local one", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal("");
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes().pipe(Stream.take(3))));
			yield* Effect.yieldNow;

			// Interleave: local, external, local. They must arrive in FILE order as
			// one sequence — a subscriber sees no seam.
			yield* journal.append("noted", { round: 1 });
			externalAppend(memfs, line(2));
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 1 }, { round: 2 }, { round: 3 }],
				"file order, one interleaved sequence",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("offsets stay contiguous across the local/external boundary", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal("");
			const local = yield* journal.append("noted", { round: 1 });
			externalAppend(memfs, line(2));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const external = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.strictEqual(external.line.offset, local.line.end, "no gap and no overlap at the boundary");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a multi-byte payload survives the byte→string seam", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal("");
			// A 4-byte astral character: a naive per-chunk decode mangles these at a
			// boundary, and the bug only shows with non-ASCII payloads.
			const emoji = "\u{1F600}".repeat(64);
			const text = `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", event: "noted", data: { round: 7 } })}\n`;
			externalAppend(memfs, text.replace('"round":7', `"round":7,"pad":"${emoji}"`));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 7 }, "the line decoded intact");
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("watcher — torn external tail", () => {
	it.effect("holds the offset until a partial line completes", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1));

			// A foreign writer caught mid-line: no terminator yet.
			const whole = line(2);
			externalAppend(memfs, whole.slice(0, 20));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const during = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(during.data, { round: 1 }, "the torn tail is not consumed");

			// The writer finishes the line.
			externalAppend(memfs, whole.slice(20));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const after = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(after.data, { round: 2 }, "and is ingested once complete");
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("watcher — resync", () => {
	it.effect("truncation raises a TYPED resync error on the stream", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1) + line(2));
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes()));
			yield* Effect.yieldNow;

			// The file shrinks below what has been read — the append-only contract
			// every cursor depends on has been broken.
			memfs.write(PATH, line(1).slice(0, 10));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const exit = yield* Fiber.await(running);
			assert.isTrue(Exit.isFailure(exit), "the stream fails rather than silently reconciling");
			const failure = yield* Effect.flip(Fiber.join(running));
			assert.instanceOf(failure, JournalResync);
			assert.strictEqual((failure as JournalResync).reason, "truncated");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("resync RE-ARMS: appends to the replacement file are observed", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1) + line(2));

			// Replace the file wholesale, then append to the replacement.
			memfs.write(PATH, line(9));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			externalAppend(memfs, line(10));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			// Raising the error is not enough: a watcher that followed the old inode
			// would be permanently blind to this second append.
			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 10 }, "the replacement file is being read");
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("watcher — activation over a missing file", () => {
	it.effect("a journal created AFTER its layer was built is observed, with no restart", () =>
		Effect.gen(function* () {
			// Decision 10: the layer constructs over a missing path. The watcher must
			// begin observing once the file appears — event-driven, no timer.
			const { memfs, scope, journal } = yield* openJournal(undefined);
			assert.isFalse(memfs.has(PATH));

			yield* journal.create;
			externalAppend(memfs, line(42));
			// The directory poke carries a BARE BASENAME, as the node backend does —
			// so this also exercises the rule that event.path is never used to open
			// anything.
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 42 }, "observed without a layer rebuild");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);
});

describe("watcher — the arming window", () => {
	it.effect("a write DURING arming is delivered with NO second write", () =>
		Effect.gen(function* () {
			// The bug this pins: catch-up-then-arm leaves a gap in which the file can
			// grow while nothing watches and nothing will re-read, so the write stays
			// invisible until some LATER event triggers another ingest.
			//
			// The write must land INSIDE that window — after the engine has seeded
			// `consumed`, before the watch is live. Written any earlier it is covered
			// by seeding; any later it produces an event that covers it. Either way
			// the test would pass regardless of ordering, which is exactly how the
			// first version of this test passed against the bug it was written for.
			// The `beforeWatch` hook is what places it precisely.
			//
			// Exactly ONE write, and no poke: a second would trigger the catch-up
			// itself and mask the defect.
			const memfs = makeMemFs();
			memfs.mkdir("/journal");
			memfs.write(PATH, line(1));
			memfs.beforeWatch((target) => {
				if (target === PATH) {
					externalAppend(memfs, line(2));
				}
			});

			const layer = WatchJournal.layer({ path: PATH }).pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);

			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(
				current.data,
				{ round: 2 },
				"the arming-window write was delivered without a second write",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("overlapping ingests do NOT double-publish", () =>
		Effect.gen(function* () {
			// `ingest` reads `consumed`, then writes it only after publishing, so two
			// overlapping runs could read the same offset and publish the same lines
			// twice. Forced overlap: several pokes delivered back to back.
			const { memfs, scope, journal } = yield* openJournal(line(1));
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes().pipe(Stream.take(2))));
			yield* Effect.yieldNow;

			externalAppend(memfs, line(2));
			// Five pokes for one append: without serialization these race.
			for (let index = 0; index < 5; index++) {
				memfs.poke(PATH);
			}
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 2 }, { round: 3 }],
				"each line published exactly once despite overlapping ingests",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);
});
