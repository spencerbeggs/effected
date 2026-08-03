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

	it.effect("an append past an UN-INGESTED external line takes its offsets from the file", () =>
		Effect.gen(function* () {
			// The two-writer case. `O_APPEND` lands at the real end of the file, so a
			// local append that trusts its own `consumed` cursor while a cooperating
			// writer's bytes sit un-ingested stamps offsets the line is not at,
			// re-publishes itself on the next ingest, and skips the external line
			// entirely.
			const { memfs, scope, journal } = yield* openJournal("");
			// Collected into an array rather than awaited through `take(n)`: a
			// missing publish must fail by naming the envelope that never arrived,
			// not by hanging until the runner's timeout — which costs seconds, says
			// nothing about what broke, and is this repo's one documented unreliable
			// failure mode.
			const delivered: Array<number> = [];
			const running = yield* Effect.forkChild(
				Stream.runForEach(journal.changes(), (envelope) =>
					Effect.sync(() => {
						delivered.push(envelope.data.round);
					}),
				),
			);
			yield* Effect.yieldNow;

			const first = yield* journal.append("noted", { round: 1 });
			// On disk, and deliberately NOT poked: the watcher has not caught up.
			const foreign = line(2);
			externalAppend(memfs, foreign);
			const third = yield* journal.append("noted", { round: 3 });

			assert.strictEqual(
				third.line.offset,
				first.line.end + foreign.length,
				"the offset is where the write actually landed, not where the cursor was",
			);
			assert.strictEqual(third.line.end - third.line.offset, third.line.length + 1, "and its end tiles from there");

			for (let attempt = 0; attempt < 100 && delivered.length < 3; attempt++) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(running);
			assert.deepStrictEqual(delivered, [1, 2, 3], "the external line was published, in file order, before ours");

			// Nothing is published twice when the watcher finally does fire.
			const afterwards: Array<number> = [];
			const later = yield* Effect.forkChild(
				Stream.runForEach(journal.changes(), (envelope) =>
					Effect.sync(() => {
						afterwards.push(envelope.data.round);
					}),
				),
			);
			yield* Effect.yieldNow;
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 4 });
			for (let attempt = 0; attempt < 100 && afterwards.length < 1; attempt++) {
				yield* Effect.yieldNow;
			}
			// Give a spurious re-publish every chance to arrive before concluding
			// there was none.
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(later);
			assert.deepStrictEqual(afterwards, [4], "the late poke re-publishes nothing");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("an external append LARGER than one read chunk is ingested once, whole", () =>
		Effect.gen(function* () {
			// `readRangeText` reads in 64 KiB chunks, so a bigger range exercises its
			// multi-chunk loop — the path that produces duplicated text and duplicate
			// publishes if a handle does not advance its own read position.
			const { memfs, scope, journal } = yield* openJournal("");
			const local = yield* journal.append("noted", { round: 1 });
			const padding = "x".repeat(80 * 1024);
			const big = `${JSON.stringify({
				at: "2026-01-01T00:00:00.000Z",
				event: "noted",
				data: { round: 2 },
				pad: padding,
			})}\n`;
			assert.isAbove(big.length, 64 * 1024, "the append genuinely spans more than one read chunk");

			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes().pipe(Stream.take(2))));
			yield* Effect.yieldNow;
			externalAppend(memfs, big);
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 2 }, { round: 3 }],
				"the oversized line was published exactly once",
			);
			assert.strictEqual(delivered[0]?.line.offset, local.line.end, "and its offset describes the file");
			assert.strictEqual(delivered[0]?.line.end, local.line.end + big.length, "over its whole length");
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

	it.effect("REPLACEMENT is detected by identity, not by size", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1) + line(2));
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes()));
			yield* Effect.yieldNow;

			// A wholesale rewrite that leaves the file NO SMALLER than it was: a size
			// check structurally cannot see this, and only the inode comparison can.
			memfs.replace(PATH, line(8) + line(9) + line(10));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const failure = yield* Effect.flip(Fiber.join(running));
			assert.instanceOf(failure, JournalResync);
			assert.strictEqual((failure as JournalResync).reason, "replaced", "the breach names identity, not truncation");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("resync RE-ARMS: appends to the replacement file are observed", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1) + line(2));

			// Replace the file wholesale, then append to the replacement.
			memfs.replace(PATH, line(9));
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
			// The DIRECTORY event — creation — carries a BARE BASENAME, as the node
			// backend does, so this also exercises the rule that event.path is never
			// used to open anything.
			memfs.pokeParent(PATH);
			yield* Effect.yieldNow;
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 42 }, "observed without a layer rebuild");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("activation HANDS OFF from the directory watch to the file watch", () =>
		Effect.gen(function* () {
			// A non-recursive directory watch reports creation, not a child's later
			// appends. Staying on it after activation therefore leaves the journal
			// permanently blind to external growth — and the only way to see that is
			// a double whose content events reach file watchers only.
			const { memfs, scope, journal } = yield* openJournal(undefined);
			yield* journal.create;
			memfs.pokeParent(PATH);

			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount(PATH), 0, "the journal itself is being watched once it exists");
			assert.strictEqual(memfs.watcherCount("/journal"), 0, "and the activation watch has been let go");

			// A CONTENT event, which only the file watch receives.
			externalAppend(memfs, line(43));
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 43 }, "an append after activation is observed");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);
});

describe("watcher — path conventions", () => {
	it.effect("activates over a BACKSLASH-separated path", () =>
		Effect.gen(function* () {
			// A `/`-only split returns -1 here, which makes the whole path its own
			// basename and points the activation watch at the process working
			// directory: a journal created after its layer was built is then never
			// observed, on every Windows consumer.
			const windowsPath = "C:\\journal\\watch.jsonl";
			const memfs = makeMemFs();
			memfs.mkdir("C:\\journal");
			const layer = WatchJournal.layer({ path: windowsPath }).pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);
			for (let attempt = 0; attempt < 50 && memfs.watcherCount("C:\\journal") === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount("C:\\journal"), 0, "the activation watch found the parent directory");

			yield* journal.create;
			memfs.write(windowsPath, line(7));
			memfs.pokeParent(windowsPath);
			for (let attempt = 0; attempt < 50 && memfs.watcherCount(windowsPath) === 0; attempt++) {
				yield* Effect.yieldNow;
			}

			const current = Option.getOrThrow(yield* SubscriptionRef.get(journal.latest));
			assert.deepStrictEqual(current.data, { round: 7 }, "the creation event matched on the basename");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("a watch that FAILS to arm does not kill the supervisor", () =>
		Effect.gen(function* () {
			// The journal vanishes in the instant between the existence check and
			// the watch, which is what the real backend reports as a typed
			// filesystem failure — it stats the path first and fails. `Effect.ignore`
			// absorbs a typed failure and NOT a throw, so a double that threw would
			// hand the supervisor a defect and kill the fibre outright: the journal
			// would then never fall back to the activation watch, and would be
			// silently blind for the rest of its scope.
			const memfs = makeMemFs();
			memfs.mkdir("/journal");
			memfs.write(PATH, line(1));
			memfs.beforeWatch((target) => {
				if (target === PATH) memfs.unlink(PATH);
			});

			const layer = WatchJournal.layer({ path: PATH }).pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);

			for (let attempt = 0; attempt < 50 && memfs.watcherCount("/journal") === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(
				memfs.watcherCount("/journal"),
				0,
				"the supervisor survived the failed watch and fell back to activation",
			);

			// And the journal is still a working one.
			yield* journal.create;
			const appended = yield* journal.append("noted", { round: 1 });
			assert.strictEqual(appended.line.offset, 0, "local appends keep working regardless");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("takes the activation directory from the config when given one", () =>
		Effect.gen(function* () {
			// The escape hatch for a path whose parent is not a plain prefix of it.
			const memfs = makeMemFs();
			memfs.mkdir("/elsewhere");
			const layer = WatchJournal.layer({ path: PATH, directory: "/elsewhere" }).pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			for (let attempt = 0; attempt < 50 && memfs.watcherCount("/elsewhere") === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount("/elsewhere"), 0, "the configured directory is the watch target");
			assert.strictEqual(memfs.watcherCount("/journal"), 0, "and the derived one is not consulted");
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
