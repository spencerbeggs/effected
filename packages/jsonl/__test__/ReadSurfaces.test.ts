import { assert, describe, it } from "@effect/vitest";
import { Context, DateTime, Duration, Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect";
import { Journal, JsonlEvent } from "../src/index.js";
import type { MemFs } from "./helpers/memfs.js";
import { makeMemFs } from "./helpers/memfs.js";

const PATH = "/journal/read.jsonl";

/**
 * A payload schema that COUNTS every time it is decoded.
 *
 * This is the only way to prove filter-before-decode. An output-set assertion
 * cannot distinguish "never decoded" from "decoded and then discarded" — both
 * produce exactly the same elements — so the neighbour's schema is instrumented
 * instead, and a control test proves the instrument actually fires.
 */
let neighbourDecodes = 0;
const LoudNeighbour = Schema.declare((_u: unknown): _u is unknown => {
	neighbourDecodes += 1;
	return true;
});

const Mine = JsonlEvent.make("mine", { data: Schema.Struct({ round: Schema.Number }) });
const Neighbour = JsonlEvent.make("neighbour", { data: LoudNeighbour });
const Ended = JsonlEvent.make("ended", { data: Schema.Void, terminal: true });
const events = [Mine, Neighbour, Ended] as const;

class ReadJournal extends Journal.Service<ReadJournal>()("test/ReadJournal", { events }) {}

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const line = (event: string, data: unknown, options?: { scope?: string; at?: number }) =>
	`${JSON.stringify({
		at: iso(options?.at ?? 0),
		event,
		...(options?.scope === undefined ? {} : { scope: options.scope }),
		data,
	})}\n`;

const harness = (seed: string) => {
	const memfs = makeMemFs();
	memfs.write(PATH, seed);
	return { memfs, layer: ReadJournal.layer({ path: PATH }).pipe(Layer.provide(memfs.layer)) };
};

/** Append behind the journal's back — a cooperating foreign writer. */
const externalAppend = (memfs: MemFs, text: string): void => {
	const current = memfs.bytes(PATH);
	const addition = new TextEncoder().encode(text);
	const next = new Uint8Array((current?.length ?? 0) + addition.length);
	if (current !== undefined) next.set(current);
	next.set(addition, current?.length ?? 0);
	memfs.write(PATH, next);
};

/**
 * Build the journal in its own scope, with its watcher armed.
 *
 * The join tests need the memfs itself — to gate a read and to poke the
 * watcher — which the `Effect.provide` form deliberately hides.
 */
const openJournal = (seed: string) =>
	Effect.gen(function* () {
		const { memfs, layer } = harness(seed);
		const scope = yield* Scope.make();
		const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
		for (let attempt = 0; attempt < 50 && memfs.watcherCount(PATH) === 0; attempt++) {
			yield* Effect.yieldNow;
		}
		assert.isAbove(memfs.watcherCount(PATH), 0, "the watcher armed before the test drove it");
		return { memfs, scope, journal: Context.get(context, ReadJournal) };
	});

const withJournal = <A, E>(seed: string, body: (journal: ReadJournal["Service"]) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const { layer } = harness(seed);
		return yield* Effect.gen(function* () {
			const journal = yield* ReadJournal;
			return yield* body(journal);
		}).pipe(Effect.provide(layer));
	});

describe("query", () => {
	const seed = line("mine", { round: 1 }) + line("mine", { round: 2 }) + line("mine", { round: 3 });

	it.effect("streams every envelope when unsliced", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const all = yield* Stream.runCollect(journal.query());
				assert.deepStrictEqual(
					all.map((envelope) => envelope.data),
					[{ round: 1 }, { round: 2 }, { round: 3 }],
				);
			}),
		),
	);

	it.effect("carries logical byte offsets that tile the file", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const all = yield* Stream.runCollect(journal.query());
				assert.strictEqual(all[0]?.line.offset, 0);
				for (let index = 0; index < all.length - 1; index++) {
					assert.strictEqual(all[index]?.line.end, all[index + 1]?.line.offset, "no gap, no overlap");
				}
			}),
		),
	);

	it.effect("resumes from a cursor, delivering exactly the remainder", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const all = yield* Stream.runCollect(journal.query());
				const cursor = all[0]?.line.end ?? 0;
				const rest = yield* Stream.runCollect(journal.query({ cursor }));
				assert.deepStrictEqual(
					rest.map((envelope) => envelope.data),
					[{ round: 2 }, { round: 3 }],
					"the cursored read is the unprocessed remainder — nothing repeated, nothing skipped",
				);
			}),
		),
	);

	it.effect("a cursor mid-line skips the partial line rather than half-decoding it", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const all = yield* Stream.runCollect(journal.query());
				// Point INTO the second line rather than at its start.
				const midLine = (all[1]?.line.offset ?? 0) + 4;
				const rest = yield* Stream.runCollect(journal.query({ cursor: midLine }));
				assert.deepStrictEqual(
					rest.map((envelope) => envelope.data),
					[{ round: 3 }],
					"the straddled line is skipped whole; the next complete line resumes",
				);
			}),
		),
	);

	it.effect("an empty events array matches nothing", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const none = yield* Stream.runCollect(journal.query({ events: [] }));
				assert.strictEqual(none.length, 0, "restricting to an empty set means an empty set");
			}),
		),
	);
});

describe("Slice — from/to boundary", () => {
	const seed =
		line("mine", { round: 1 }, { at: 100 }) +
		line("mine", { round: 2 }, { at: 200 }) +
		line("mine", { round: 3 }, { at: 300 });

	it.effect("`from` is INCLUSIVE at the exact boundary instant", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const got = yield* Stream.runCollect(journal.query({ from: DateTime.makeUnsafe(200) }));
				assert.deepStrictEqual(
					got.map((envelope) => envelope.data),
					[{ round: 2 }, { round: 3 }],
					"the envelope exactly at `from` is included",
				);
			}),
		),
	);

	it.effect("`to` is EXCLUSIVE at the exact boundary instant", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const got = yield* Stream.runCollect(journal.query({ to: DateTime.makeUnsafe(200) }));
				assert.deepStrictEqual(
					got.map((envelope) => envelope.data),
					[{ round: 1 }],
					"the envelope exactly at `to` is excluded",
				);
			}),
		),
	);

	it.effect("adjacent windows tile exactly — no envelope delivered twice or missed", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const first = yield* Stream.runCollect(
					journal.query({ from: DateTime.makeUnsafe(0), to: DateTime.makeUnsafe(200) }),
				);
				const second = yield* Stream.runCollect(
					journal.query({ from: DateTime.makeUnsafe(200), to: DateTime.makeUnsafe(400) }),
				);
				assert.deepStrictEqual(
					[...first, ...second].map((envelope) => envelope.data),
					[{ round: 1 }, { round: 2 }, { round: 3 }],
					"half-open windows partition the journal",
				);
			}),
		),
	);
});

describe("filter-before-decode", () => {
	// The neighbour's payload schema counts its own decodes. Filtering after a
	// full decode would produce exactly these same elements, so only the counter
	// can tell the two implementations apart.
	const seed =
		line("mine", { round: 1 }) +
		line("neighbour", { anything: "loud" }) +
		line("mine", { round: 2 }) +
		line("neighbour", { anything: "louder" });

	it.effect("a filtered query never decodes the neighbour's payload", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				neighbourDecodes = 0;
				const mine = yield* Stream.runCollect(journal.query({ events: ["mine"] }));
				assert.deepStrictEqual(
					mine.map((envelope) => envelope.data),
					[{ round: 1 }, { round: 2 }],
				);
				assert.strictEqual(neighbourDecodes, 0, "the neighbour's schema was never reached");
			}),
		),
	);

	it.effect("a scope filter is also applied before the payload decode", () =>
		Effect.gen(function* () {
			const scoped =
				line("mine", { round: 1 }, { scope: "a" }) + line("neighbour", { anything: "loud" }, { scope: "b" });
			return yield* withJournal(scoped, (journal) =>
				Effect.gen(function* () {
					neighbourDecodes = 0;
					const mine = yield* Stream.runCollect(journal.query({ scopes: ["a"] }));
					assert.strictEqual(mine.length, 1);
					assert.strictEqual(neighbourDecodes, 0, "the out-of-scope payload was never decoded");
				}),
			);
		}),
	);

	it.effect("the spy is real: an UNFILTERED read does reach the neighbour", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				// Without this, a spy that could never fire would make the two tests
				// above pass vacuously.
				neighbourDecodes = 0;
				yield* Stream.runCollect(journal.query());
				assert.strictEqual(neighbourDecodes, 2, "the spy fires for both neighbour lines when nothing filters them");
			}),
		),
	);
});

describe("changes", () => {
	it.effect("delivers live appends through the slice", () =>
		withJournal("", (journal) =>
			Effect.gen(function* () {
				const running = yield* Effect.forkChild(
					Stream.runCollect(journal.changes({ events: ["mine"] }).pipe(Stream.take(2))),
				);
				yield* Effect.yieldNow;
				yield* journal.append("mine", { round: 1 });
				yield* journal.append("mine", { round: 2 });
				const delivered = yield* Fiber.join(running);
				assert.deepStrictEqual(
					delivered.map((envelope) => envelope.data),
					[{ round: 1 }, { round: 2 }],
				);
			}),
		),
	);

	it.effect("ENDS when a terminal event reaches the tail", () =>
		withJournal("", (journal) =>
			Effect.gen(function* () {
				const running = yield* Effect.forkChild(Stream.runCollect(journal.changes()));
				yield* Effect.yieldNow;
				yield* journal.append("mine", { round: 1 });
				yield* journal.append("ended", undefined);
				// An assertion that the stream ENDS: joining returns rather than hanging.
				const delivered = yield* Fiber.join(running);
				assert.deepStrictEqual(
					delivered.map((envelope) => envelope.event),
					["mine", "ended"],
					"the terminal envelope is delivered, then the stream ends",
				);
			}),
		),
	);

	it.effect("ends even when the slice EXCLUDES the terminal event", () =>
		withJournal("", (journal) =>
			Effect.gen(function* () {
				const running = yield* Effect.forkChild(Stream.runCollect(journal.changes({ events: ["mine"] })));
				yield* Effect.yieldNow;
				yield* journal.append("mine", { round: 1 });
				yield* journal.append("ended", undefined);
				const delivered = yield* Fiber.join(running);
				assert.deepStrictEqual(
					delivered.map((envelope) => envelope.event),
					["mine"],
					"the terminal envelope ends the subscription without being delivered",
				);
			}),
		),
	);

	it.effect("subscribing to an ALREADY-quiescent journal terminates immediately", () =>
		withJournal(line("mine", { round: 1 }) + line("ended", null), (journal) =>
			Effect.gen(function* () {
				// The terminal event happened before this subscriber existed, so there
				// is no Exit in flight for it — a hub has no replay. The stream must
				// still END. Asserted by the collect RETURNING, never by a timeout.
				const delivered = yield* Stream.runCollect(journal.changes());
				assert.strictEqual(delivered.length, 0, "no live events, and no hang");
			}),
		),
	);

	it.effect("an append landing DURING the replay is delivered, not lost at the join", () =>
		Effect.gen(function* () {
			// The join test that CAN see the gap. The append has to land strictly
			// after the replay has sampled the file and strictly before a
			// subscribe-after-replay implementation would have attached — anywhere
			// else and the test passes whatever the ordering is, which is exactly how
			// the previous version of this test passed against the defect.
			const { memfs, scope, journal } = yield* openJournal(line("mine", { round: 1 }) + line("mine", { round: 2 }));
			const collected: Array<number> = [];
			const gate = memfs.gateNextRead();
			const running = yield* Effect.forkChild(
				Stream.runForEach(journal.changes({ cursor: 0, events: ["mine"] }), (envelope) =>
					Effect.sync(() => {
						collected.push(envelope.data.round);
					}),
				),
			);

			// The replay's read has taken its bytes and is suspended inside the handle.
			yield* Effect.promise(() => gate.entered);
			yield* journal.append("mine", { round: 3 });
			gate.release();

			for (let attempt = 0; attempt < 100 && collected.length < 3; attempt++) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(running);
			assert.deepStrictEqual(collected, [1, 2, 3], "the append published during the replay survived the join");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("an envelope in BOTH the replay and the live tail is delivered ONCE", () =>
		Effect.gen(function* () {
			// The other half of subscribing before replaying: a line already on disk
			// when the replay reads it can still be in flight to the hub, so it
			// arrives twice unless the overlap is de-duplicated on the byte offset.
			const { memfs, scope, journal } = yield* openJournal(line("mine", { round: 1 }) + line("mine", { round: 2 }));
			externalAppend(memfs, line("mine", { round: 3 }));

			const collected: Array<number> = [];
			const gate = memfs.gateNextRead();
			const running = yield* Effect.forkChild(
				Stream.runForEach(journal.changes({ cursor: 0, events: ["mine"] }), (envelope) =>
					Effect.sync(() => {
						collected.push(envelope.data.round);
					}),
				),
			);

			// The replay has round 3 in its snapshot; the poke makes the watcher
			// ingest and publish that same line while the replay is still suspended.
			yield* Effect.promise(() => gate.entered);
			memfs.poke(PATH);
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			gate.release();

			for (let attempt = 0; attempt < 100 && collected.length < 3; attempt++) {
				yield* Effect.yieldNow;
			}
			// Give a duplicate every chance to arrive before concluding it did not.
			for (let turn = 0; turn < 20; turn++) {
				yield* Effect.yieldNow;
			}
			yield* Fiber.interrupt(running);
			assert.deepStrictEqual(collected, [1, 2, 3], "the overlapping envelope is delivered exactly once");
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);

	it.effect("replay-from-cursor and the live tail are ONE stream", () =>
		withJournal(line("mine", { round: 1 }) + line("mine", { round: 2 }), (journal) =>
			Effect.gen(function* () {
				const running = yield* Effect.forkChild(Stream.runCollect(journal.changes({ cursor: 0 }).pipe(Stream.take(3))));
				yield* Effect.yieldNow;
				yield* journal.append("mine", { round: 3 });
				const delivered = yield* Fiber.join(running);
				assert.deepStrictEqual(
					delivered.map((envelope) => envelope.data),
					[{ round: 1 }, { round: 2 }, { round: 3 }],
					"history then tail, with no gap and no duplicate at the join",
				);
			}),
		),
	);
});

describe("projection", () => {
	it.effect("folds over its slice only", () =>
		withJournal("", (journal) =>
			Effect.gen(function* () {
				const running = yield* Effect.forkChild(
					Stream.runCollect(
						journal
							.projection(0, (total, envelope) => total + envelope.data.round, { events: ["mine"] })
							.pipe(Stream.take(3)),
					),
				);
				yield* Effect.yieldNow;
				yield* journal.append("mine", { round: 1 });
				yield* journal.append("mine", { round: 10 });
				const states = yield* Fiber.join(running);
				assert.deepStrictEqual([...states], [0, 1, 11], "the running total, emitted as it advances");
			}),
		),
	);
});

describe("consumption postures", () => {
	const seed = line("mine", { round: 1 }) + line("mine", { round: 2 }) + line("mine", { round: 3 });

	it.effect("lossless: runForEach sees every element", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const seen: Array<unknown> = [];
				yield* Stream.runForEach(journal.query({ events: ["mine"] }), (envelope) =>
					Effect.sync(() => {
						seen.push(envelope.data.round);
					}),
				);
				assert.deepStrictEqual(seen, [1, 2, 3]);
			}),
		),
	);

	it.effect("latest-wins: toQueue with a sliding strategy keeps the NEWEST", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const queue = yield* Stream.toQueue(journal.query({ events: ["mine"] }), {
					capacity: 1,
					strategy: "sliding",
				});
				// A sliding queue of capacity 1 keeps only the most recent element.
				// WHICH element survives is the whole property: a length assertion
				// alone passes just as happily on a dropping queue, which keeps the
				// oldest and discards the state a status display actually wants.
				for (let turn = 0; turn < 20; turn++) {
					yield* Effect.yieldNow;
				}
				const taken = yield* Queue.takeAll(queue);
				assert.deepStrictEqual(
					taken.map((envelope) => envelope.data.round),
					[3],
					"the newest element survived and the older ones slid out",
				);
			}).pipe(Effect.scoped),
		),
	);

	it.effect("batch-draining: a bounded queue plus takeAll amortizes a burst", () =>
		withJournal(seed, (journal) =>
			Effect.gen(function* () {
				const queue = yield* Stream.toQueue(journal.query({ events: ["mine"] }), { capacity: 16 });
				// Let the whole burst land before taking: a take that races the
				// producer proves nothing about amortizing, because ONE element also
				// satisfies "at least one".
				for (let turn = 0; turn < 20; turn++) {
					yield* Effect.yieldNow;
				}
				const batch = yield* Queue.takeAll(queue);
				assert.deepStrictEqual(
					batch.map((envelope) => envelope.data.round),
					[1, 2, 3],
					"the entire burst is drained in ONE take",
				);
			}).pipe(Effect.scoped),
		),
	);
});

describe("outer-scope subscription", () => {
	it.effect("a subscription outliving the journal sees every completed append, then end", () =>
		Effect.gen(function* () {
			// The normal consumer shape: the subscription is held by something that
			// outlives the journal's own scope.
			const { layer } = harness("");
			const journalScope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, journalScope));
			const journal = Context.get(context, ReadJournal);

			const running = yield* Effect.forkChild(Stream.runCollect(journal.changes()));
			yield* Effect.yieldNow;
			yield* journal.append("mine", { round: 1 });
			yield* journal.append("mine", { round: 2 });
			yield* Scope.close(journalScope, Exit.void);

			const delivered = yield* Fiber.join(running);
			assert.deepStrictEqual(
				delivered.map((envelope) => envelope.data),
				[{ round: 1 }, { round: 2 }],
				"every completed append arrived before the stream ended",
			);
		}).pipe(Effect.timeout(Duration.seconds(10))),
	);
});
