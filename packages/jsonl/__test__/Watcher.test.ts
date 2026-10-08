import { assert, describe, it } from "@effect/vitest";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	PubSub,
	Result,
	Schema,
	Scope,
	Stream,
} from "effect";
import type { JournalConfig } from "../src/index.js";
import { Journal, JournalResync, JsonlEvent, Line } from "../src/index.js";
import type { Item } from "../src/internal/engine.js";
import { makeEngine } from "../src/internal/engine.js";
import { PAGE_SIZE } from "../src/internal/tail.js";
import type { MemFs } from "./helpers/memfs.js";
import { makeMemFs } from "./helpers/memfs.js";

const PATH = "/journal/watch.jsonl";

const Noted = JsonlEvent.make("noted", { data: Schema.Struct({ round: Schema.Number }) });
const events = [Noted] as const;

class WatchJournal extends Journal.Service<WatchJournal>()("test/WatchJournal", { events, config: { path: PATH } }) {}

/** A journal over a config only known at run time — `make`, bound once. */
const layerFor = (config: JournalConfig) => Layer.effect(WatchJournal, WatchJournal.make(config));

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
		const layer = WatchJournal.layer.pipe(Layer.provide(memfs.layer));
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

			const current = Option.getOrThrow(yield* journal.latest);
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

			const external = Option.getOrThrow(yield* journal.latest);
			assert.strictEqual(external.position.offset, local.position.end, "no gap and no overlap at the boundary");
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
				third.position.offset,
				first.position.end + foreign.length,
				"the offset is where the write actually landed, not where the cursor was",
			);
			assert.strictEqual(third.position.end, memfs.bytes(PATH)?.length, "and its end is the end of the file");

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
			// The watcher's gap read pages through `readLinePages` in 64 KiB pages, so
			// a bigger line exercises the carry across pages — the path that produces
			// duplicated text and duplicate publishes if the carry is mishandled.
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
			assert.strictEqual(delivered[0]?.position.offset, local.position.end, "and its offset describes the file");
			assert.strictEqual(delivered[0]?.position.end, local.position.end + big.length, "over its whole length");
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

			const current = Option.getOrThrow(yield* journal.latest);
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

			const during = Option.getOrThrow(yield* journal.latest);
			assert.deepStrictEqual(during.data, { round: 1 }, "the torn tail is not consumed");

			// The writer finishes the line.
			externalAppend(memfs, whole.slice(20));
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const after = Option.getOrThrow(yield* journal.latest);
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
			const current = Option.getOrThrow(yield* journal.latest);
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

			const current = Option.getOrThrow(yield* journal.latest);
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
			const current = Option.getOrThrow(yield* journal.latest);
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
			const layer = layerFor({ path: windowsPath }).pipe(Layer.provide(memfs.layer));
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

			const current = Option.getOrThrow(yield* journal.latest);
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

			const layer = WatchJournal.layer.pipe(Layer.provide(memfs.layer));
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
			assert.strictEqual(appended.position.offset, 0, "local appends keep working regardless");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("takes the activation directory from the config when given one", () =>
		Effect.gen(function* () {
			// The escape hatch for a path whose parent is not a plain prefix of it.
			const memfs = makeMemFs();
			memfs.mkdir("/elsewhere");
			const layer = layerFor({ path: PATH, directory: "/elsewhere" }).pipe(Layer.provide(memfs.layer));
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

			const layer = WatchJournal.layer.pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);

			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* journal.latest);
			assert.deepStrictEqual(
				current.data,
				{ round: 2 },
				"the arming-window write was delivered without a second write",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a write landed while the watch is REQUESTED but not yet registered is delivered with NO poke", () =>
		Effect.gen(function* () {
			// The race the integration suite hit under load: a backend whose watch
			// registers only after an asynchronous `stat` leaves a window in which
			// the watch has been asked for but is not live. An engine that catches up
			// on a schedule rather than on registration reads the file inside that
			// window, then the write lands, then the watch goes live having seen
			// nothing — and the line is lost until some later write.
			//
			// The hold places the write in exactly that window. Turns are yielded
			// first so a catch-up that does not wait for registration has every
			// chance to run before the write; one that waits cannot run at all.
			const memfs = makeMemFs();
			memfs.mkdir("/journal");
			memfs.write(PATH, line(1));
			const hold = memfs.holdNextWatch(PATH);

			const layer = WatchJournal.layer.pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);

			yield* Effect.promise(() => hold.entered);
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
			externalAppend(memfs, line(2));
			hold.release();

			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount(PATH), 0, "the held watch registered once released");
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* journal.latest);
			assert.deepStrictEqual(current.data, { round: 2 }, "the write inside the arming window was caught up");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("a journal CREATED while the activation watch is not yet registered is still found", () =>
		Effect.gen(function* () {
			// The same window on the activation path: the journal is missing, the
			// directory watch is asked for, and the file appears before that watch
			// is live. The directory watch reports nothing, so only an existence
			// check AFTER it registers can see the file — one made before it is
			// already stale, and the journal would wait on its directory forever.
			const memfs = makeMemFs();
			memfs.mkdir("/journal");
			const hold = memfs.holdNextWatch("/journal");

			const layer = WatchJournal.layer.pipe(Layer.provide(memfs.layer));
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, WatchJournal);

			yield* Effect.promise(() => hold.entered);
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
			// Created behind the journal's back, and deliberately NOT announced
			// with `pokeParent`: the watch was not live to report it.
			memfs.write(PATH, line(1));
			hold.release();

			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount(PATH), 0, "the journal is being watched once it exists");
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

			const current = Option.getOrThrow(yield* journal.latest);
			assert.deepStrictEqual(current.data, { round: 1 }, "the journal created inside the window was ingested");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
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

/** Spin the scheduler until `done` holds, without a clock. */
const settle = (done: () => boolean) =>
	Effect.gen(function* () {
		for (let turn = 0; turn < 100 && !done(); turn++) {
			yield* Effect.yieldNow;
		}
	});

const roundOf = (current: Option.Option<{ readonly data: unknown }>) =>
	Option.getOrUndefined(Option.map(current, (envelope) => (envelope.data as { readonly round: number }).round));

describe("watcher — resync RE-SEEDS from the file as it now is", () => {
	for (const breach of [
		{
			reason: "truncated",
			// Smaller than what was consumed: caught by size.
			apply: (memfs: MemFs) => memfs.write(PATH, line(5)),
		},
		{
			reason: "replaced",
			// No smaller, but a new identity: caught by inode.
			apply: (memfs: MemFs) => memfs.replace(PATH, line(5) + line(5) + line(5)),
		},
	] as const) {
		it.effect(
			`${breach.reason}: \`latest\` is the NEW file's tail at once, and subscribers end with JournalResync`,
			() =>
				Effect.gen(function* () {
					const { memfs, scope, journal } = yield* openJournal(line(1) + line(2));
					const subscriber = yield* Effect.forkChild(Effect.exit(Stream.runCollect(journal.changes())));
					yield* Effect.yieldNow;

					breach.apply(memfs);
					memfs.poke(PATH);
					yield* settle(() => subscriber.pollUnsafe() !== undefined);

					const exit = yield* Fiber.join(subscriber);
					assert.isTrue(Exit.isFailure(exit), "the subscriber ended with the breach");
					const failed = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined;
					assert.instanceOf(failed, JournalResync, "typed as JournalResync");
					assert.strictEqual((failed as JournalResync).reason, breach.reason);

					// Re-seeded from the new file's tail — with NO further append. A reset
					// to empty, or a stale pre-breach value, both fail here.
					assert.strictEqual(roundOf(yield* journal.latest), 5, "latest is the replacement's last envelope");
					yield* Scope.close(scope, Exit.void);
				}),
		);
	}

	it.effect("after a resync, lines already in the file are NOT re-published; new appends are", () =>
		Effect.gen(function* () {
			// Recovery from a resync is a re-read (query / cursor), not a replay
			// through the hub: the engine resumes at the new file's END. Observed on
			// the engine's hub through a subscription taken BEFORE the breach — a
			// raw subscription outlives the resync Exit, so it sees everything
			// published afterwards. A stream subscriber attached after the breach
			// cannot tell: a reset to offset 0 re-publishes round 5 to nobody.
			const memfs = makeMemFs();
			memfs.mkdir("/journal");
			memfs.write(PATH, line(1) + line(2));
			const scope = yield* Scope.make();
			const engine = yield* makeEngine("test/WatchEngine", events, { path: PATH }).pipe(
				Effect.provideService(Scope.Scope, scope),
				Effect.provide(memfs.layer),
			);
			yield* settle(() => memfs.watcherCount(PATH) > 0);
			assert.isAbove(memfs.watcherCount(PATH), 0, "the watcher armed");
			const subscriberScope = yield* Scope.make();
			const subscription = yield* PubSub.subscribe(engine.hub).pipe(
				Effect.provideService(Scope.Scope, subscriberScope),
			);

			memfs.write(PATH, line(5));
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			assert.strictEqual(roundOf(yield* engine.journal.latest), 5, "re-seeded from the new tail");

			externalAppend(memfs, line(6));
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			const ours = yield* engine.journal.append("noted", { round: 7 });
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}

			const takes = yield* PubSub.takeAll(subscription);
			assert.isFalse(Array.isArray(takes[0]), "the resync Exit comes first");
			const resync =
				Exit.isExit(takes[0]) && Exit.isFailure(takes[0]) ? Cause.findErrorOption(takes[0].cause) : Option.none();
			assert.isTrue(Option.isSome(resync) && resync.value instanceof JournalResync, "and it is a JournalResync");
			const rounds = takes.flatMap((take) =>
				Array.isArray(take)
					? (take as ReadonlyArray<Item>).map(
							(item) => (Result.getOrThrow(item).data as { readonly round: number }).round,
						)
					: [],
			);
			assert.deepStrictEqual(rounds, [6, 7], "only what was appended after the resync — round 5 is not replayed");
			assert.strictEqual(
				ours.position.offset,
				new TextEncoder().encode(line(5) + line(6)).length,
				"and offsets describe the new file",
			);
			yield* Scope.close(subscriberScope, Exit.void);
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("watcher — the append-time gap read is paged", () => {
	it.effect("an un-ingested external gap larger than a page is read in pages, not allocated whole", () =>
		Effect.gen(function* () {
			// An append past another writer's un-ingested bytes must publish them
			// first, so it reads the gap. Sized larger than a page, a one-shot read
			// would request the whole gap at once; the request sizes show which.
			const { memfs, scope, journal } = yield* openJournal("");
			const delivered: Array<number> = [];
			const running = yield* Effect.forkChild(
				Stream.runForEach(journal.changes(), (envelope) =>
					Effect.sync(() => {
						delivered.push(envelope.data.round);
					}),
				),
			);
			yield* Effect.yieldNow;

			const foreign = Array.from({ length: 3000 }, (_, index) => line(index + 1)).join("");
			assert.isAbove(foreign.length, 2 * PAGE_SIZE, "the gap spans several pages");
			externalAppend(memfs, foreign); // deliberately NOT poked
			const mark = memfs.readRequests().length;
			const ours = yield* journal.append("noted", { round: 3001 });
			const sizes = memfs.readRequests().slice(mark);

			assert.isAbove(sizes.length, 2, "the gap was read in several requests");
			assert.isAtMost(Math.max(...sizes), PAGE_SIZE, "no single read exceeds a page");
			assert.strictEqual(ours.position.offset, foreign.length, "our line follows the gap");

			yield* settle(() => delivered.length >= 3001);
			yield* Fiber.interrupt(running);
			assert.strictEqual(delivered.length, 3001, "every gap line, then ours, was published");
			assert.deepStrictEqual(delivered.slice(-3), [2999, 3000, 3001], "in file order, the gap before our line");
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

/** A delivered envelope, reduced to what the race tests compare. */
interface Seen {
	readonly round: number;
	readonly offset: number;
	readonly end: number;
}

/** Collect every envelope `changes()` delivers, with its position. */
const collect = (journal: WatchJournal["Service"]) =>
	Effect.gen(function* () {
		const seen: Array<Seen> = [];
		const fiber = yield* Effect.forkChild(
			Stream.runForEach(journal.changes(), (envelope) =>
				Effect.sync(() => {
					seen.push({ round: envelope.data.round, ...envelope.position });
				}),
			),
		);
		yield* Effect.yieldNow;
		return { seen, fiber };
	});

/** The file's lines as positions, the ground truth every assertion is held to. */
const fileLines = (memfs: MemFs) =>
	Line.split(new TextDecoder().decode(memfs.bytes(PATH) ?? new Uint8Array(0))).map((slice) => ({
		round: (JSON.parse(slice.text) as { readonly data: { readonly round: number } }).data.round,
		offset: slice.offset,
		end: slice.end,
	}));

describe("append — another writer racing our write and our fstat", () => {
	it.effect(
		"a foreign line landing between write and fstat: our position is TRUE, theirs is published after ours",
		() =>
			Effect.gen(function* () {
				// The window O_APPEND leaves open: the write reports no position, so the
				// line's end comes from an fstat, and a foreign append landing first
				// overstates it. Placed exactly by the helper, inside that stat.
				const { memfs, scope, journal } = yield* openJournal("");
				const { seen, fiber } = yield* collect(journal);
				let raced = false;
				memfs.afterNextWriteStat(() => {
					raced = true;
					externalAppend(memfs, line(2));
				});

				const ours = yield* journal.append("noted", { round: 1 });
				assert.isTrue(raced, "the foreign line really landed between our write and our fstat");
				const truth = fileLines(memfs);
				assert.deepStrictEqual(
					truth.map((entry) => entry.round),
					[1, 2],
					"on disk: ours, then theirs",
				);
				assert.deepStrictEqual(
					ours.position,
					{ offset: truth[0]?.offset, end: truth[0]?.end },
					"the returned position is where our line really is",
				);
				assert.strictEqual(roundOf(yield* journal.latest), 2, "latest is the file's last envelope — theirs");

				yield* settle(() => seen.length >= 2);
				const later = yield* journal.append("noted", { round: 3 });
				yield* settle(() => seen.length >= 3);
				// Give a duplicate or a late re-publish every chance to arrive.
				for (let turn = 0; turn < 20; turn++) {
					yield* Effect.yieldNow;
				}
				yield* Fiber.interrupt(fiber);

				const after = fileLines(memfs);
				assert.deepStrictEqual(seen, after, "every line once, in file order, each at its true position");
				assert.deepStrictEqual(later.position, { offset: after[2]?.offset, end: after[2]?.end });
				yield* Scope.close(scope, Exit.void);
			}),
	);

	it.effect("foreign lines BEFORE and AFTER ours in one append are published around ours, in file order", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal("");
			const { seen, fiber } = yield* collect(journal);
			// An un-ingested gap ahead of our write (never poked) …
			externalAppend(memfs, line(10));
			// … and a racer behind it, inside our fstat.
			memfs.afterNextWriteStat(() => externalAppend(memfs, line(12)));

			const ours = yield* journal.append("noted", { round: 11 });
			const truth = fileLines(memfs);
			assert.deepStrictEqual(
				truth.map((entry) => entry.round),
				[10, 11, 12],
			);
			assert.deepStrictEqual(ours.position, { offset: truth[1]?.offset, end: truth[1]?.end });
			assert.strictEqual(roundOf(yield* journal.latest), 12);

			yield* settle(() => seen.length >= 3);
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(fiber);
			assert.deepStrictEqual(seen, truth, "before → ours → after, nothing skipped or repeated");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("the fast path: an append with no foreign bytes reads nothing", () =>
		Effect.gen(function* () {
			// The file grew by exactly our line, so no other writer can have touched
			// it. The scan is for the contended case only.
			const { memfs, scope, journal } = yield* openJournal(line(1));
			const mark = memfs.readRequests().length;
			const ours = yield* journal.append("noted", { round: 2 });
			assert.deepStrictEqual(memfs.readRequests().slice(mark), [], "no read was issued by the append");
			assert.deepStrictEqual(ours.position, { offset: fileLines(memfs)[1]?.offset, end: fileLines(memfs)[1]?.end });
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("review fixes — torn tails and the ingest stat race", () => {
	/** Like {@link openJournal}, over a memfs the test configured itself. */
	const openOver = (memfs: MemFs, seed: string) =>
		Effect.gen(function* () {
			memfs.mkdir("/journal");
			memfs.write(PATH, seed);
			const scope = yield* Scope.make();
			const context = yield* Layer.build(WatchJournal.layer.pipe(Layer.provide(memfs.layer))).pipe(
				Effect.provideService(Scope.Scope, scope),
			);
			for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
				yield* Effect.yieldNow;
			}
			assert.isAbove(memfs.watcherCount(PATH), 0, "the watcher armed");
			return { scope, journal: Context.get(context, WatchJournal) };
		});

	const torn = line(2).slice(0, 20);
	const rest = line(2).slice(20);

	it.effect("a line torn when the replay reads it is delivered once its writer completes it", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1));
			// The fragment arrives AFTER construction, through the watcher, which
			// holds its resume point at the fragment's start.
			externalAppend(memfs, torn);
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const running = yield* Effect.forkChild(
				Stream.runCollect(journal.changes({ cursor: 0, onInvalid: "fail" }).pipe(Stream.take(2))),
			);
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
			externalAppend(memfs, rest);
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 1 }, { round: 2 }],
				"the completed line arrives; a torn tail neither fails `onInvalid: fail` nor is skipped for good",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("under the default skip, a line torn during replay is not lost to the de-duplication boundary", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1));
			externalAppend(memfs, torn);
			memfs.poke(PATH);
			yield* Effect.yieldNow;

			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes({ cursor: 0 }).pipe(Stream.take(2))));
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
			externalAppend(memfs, rest);
			memfs.poke(PATH);
			yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 1 }, { round: 2 }],
				"round 2 arrives — not skipped as torn and then filtered out as already replayed",
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a resync re-seeds from the file as it is once appends are excluded", () =>
		Effect.gen(function* () {
			let armed = false;
			let enter: () => void = () => {};
			const entered = new Promise<void>((resolve) => {
				enter = resolve;
			});
			let release: () => void = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const memfs = makeMemFs({
				faults: (base) => ({
					stat: (path) => {
						if (!armed || path !== PATH) return undefined;
						armed = false;
						return base.stat(path).pipe(
							Effect.tap(() =>
								Effect.promise(() => {
									enter();
									return held;
								}),
							),
						);
					},
				}),
			});
			memfs.mkdir("/journal");
			memfs.write(PATH, line(1));
			const scope = yield* Scope.make();
			const engine = yield* makeEngine("test/WatchEngine", events, { path: PATH }).pipe(
				Effect.provideService(Scope.Scope, scope),
				Effect.provide(memfs.layer),
			);
			yield* settle(() => memfs.watcherCount(PATH) > 0);
			// Subscribed BEFORE the breach: a duplicate re-ingest happens within a few
			// scheduler turns, before any subscriber attached afterwards could see it.
			const subscriberScope = yield* Scope.make();
			const subscription = yield* PubSub.subscribe(engine.hub).pipe(
				Effect.provideService(Scope.Scope, subscriberScope),
			);

			// Truncate in place, then hold ingest's stat on the empty file while a
			// local append lands, so the stat the breach is detected from is stale.
			memfs.write(PATH, "");
			armed = true;
			memfs.poke(PATH);
			yield* Effect.promise(() => entered);
			yield* engine.journal.append("noted", { round: 2 });
			release();
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
			yield* engine.journal.append("noted", { round: 3 });
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

			const takes = yield* PubSub.takeAll(subscription);
			assert.isTrue(
				takes.some((take) => Exit.isExit(take) && Exit.isFailure(take)),
				"the truncation was surfaced as a resync",
			);
			const rounds = takes.flatMap((take) =>
				Array.isArray(take)
					? (take as ReadonlyArray<Item>).map(
							(item) => (Result.getOrThrow(item).data as { readonly round: number }).round,
						)
					: [],
			);
			assert.deepStrictEqual(rounds, [2, 3], "round 2 was published once — the re-seed did not rewind past it");
			yield* Scope.close(subscriberScope, Exit.void);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a line another writer lands between the seed's two reads is still ingested", () =>
		Effect.gen(function* () {
			// Seeding opens the file for reading three times: the BOM probe, the
			// resume-point walk, then the `latest` walk. Land a foreign line just
			// before the third, so it falls between the two walks.
			let readOpens = 0;
			let volume: MemFs | undefined;
			const memfs = makeMemFs({
				faults: () => ({
					open: (path, options) => {
						if (path === PATH && options?.flag === "r" && ++readOpens === 3 && volume !== undefined) {
							externalAppend(volume, line(2));
						}
						return undefined;
					},
				}),
			});
			volume = memfs;
			const { scope, journal } = yield* openOver(memfs, line(1));
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

			assert.isAtLeast(readOpens, 3, "the foreign line was injected during seeding");
			assert.deepStrictEqual(
				Option.getOrThrow(yield* journal.latest).data,
				{ round: 2 },
				"`latest` reflects the line — not stranded behind a resume point already past it",
			);
			const next = yield* journal.append("noted", { round: 3 });
			assert.strictEqual(next.position.offset, new TextEncoder().encode(line(1) + line(2)).length);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("an in-place truncation just before a local append is still surfaced", () =>
		Effect.gen(function* () {
			// A long seed line, so the append that follows the truncation is
			// shorter than what was consumed: the file ends up smaller than the
			// consumed offset, which is the only way a same-inode truncation shows.
			const { memfs, scope, journal } = yield* openJournal(line(123456789));
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes()));
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;

			memfs.write(PATH, "");
			yield* journal.append("noted", { round: 2 });
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

			const exit = running.pollUnsafe();
			assert.isDefined(exit, "the subscriber ended instead of waiting on a journal it no longer describes");
			const failure = exit !== undefined && Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
			assert.isTrue(
				Option.isSome(failure) && failure.value instanceof JournalResync && failure.value.reason === "truncated",
				`ended with a truncation resync: ${String(exit)}`,
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("query leaves an unterminated tail out rather than rejecting it", () =>
		Effect.gen(function* () {
			const { scope, journal } = yield* openJournal(line(1) + torn);
			const all = yield* Stream.runCollect(journal.query({ onInvalid: "fail" }));
			assert.deepStrictEqual(
				all.map((envelope) => envelope.data),
				[{ round: 1 }],
			);
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a journal built over a torn tail picks the line up once it completes", () =>
		Effect.gen(function* () {
			const { memfs, scope, journal } = yield* openJournal(line(1) + torn);
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes().pipe(Stream.take(1))));
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
			externalAppend(memfs, rest);
			memfs.poke(PATH);

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(delivered[0]?.data, { round: 2 }, "the seed resumed at the fragment's start");
			assert.deepStrictEqual(Option.getOrThrow(yield* journal.latest).data, { round: 2 });
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a local append finishing while ingest's stat is in flight is not a truncation", () =>
		Effect.gen(function* () {
			let armed = false;
			let enter: () => void = () => {};
			const entered = new Promise<void>((resolve) => {
				enter = resolve;
			});
			let release: () => void = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const memfs = makeMemFs({
				faults: (base) => ({
					// Sample the real size, THEN hold: the stat reports the file as it was
					// before the append that lands while it is held.
					stat: (path) => {
						if (!armed || path !== PATH) return undefined;
						armed = false;
						return base.stat(path).pipe(
							Effect.tap(() =>
								Effect.promise(() => {
									enter();
									return held;
								}),
							),
						);
					},
				}),
			});
			const { scope, journal } = yield* openOver(memfs, line(1));
			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes().pipe(Stream.take(2))));
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;

			armed = true;
			memfs.poke(PATH);
			yield* Effect.promise(() => entered);
			yield* journal.append("noted", { round: 2 });
			release();
			for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
			yield* journal.append("noted", { round: 3 });

			const exit = yield* Fiber.await(running);
			assert.isTrue(Exit.isSuccess(exit), `no JournalResync reached the subscriber: ${String(exit)}`);
			if (Exit.isSuccess(exit)) {
				assert.deepStrictEqual(
					exit.value.map((envelope) => envelope.data),
					[{ round: 2 }, { round: 3 }],
					"each local append delivered exactly once",
				);
			}
			yield* Scope.close(scope, Exit.void);
		}),
	);
});
