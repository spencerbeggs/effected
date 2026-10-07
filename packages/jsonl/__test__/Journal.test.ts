import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import {
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	PlatformError,
	PubSub,
	Result,
	Schema,
	Scope,
	Stream,
	SubscriptionRef,
} from "effect";
import { TestClock } from "effect/testing";
import type { EnvelopeUnion, EnvelopeWithTag, JournalConfig } from "../src/index.js";
import {
	Envelope,
	Journal,
	JournalClosed,
	JournalNotFound,
	JsonlEvent,
	Line,
	TerminalViolation,
} from "../src/index.js";
import type { AnyEnvelope, Item } from "../src/internal/engine.js";
import { makeEngine } from "../src/internal/engine.js";
import type { MemFs } from "./helpers/memfs.js";
import { makeMemFs, textOf } from "./helpers/memfs.js";

const PATH = "/journal/mail.jsonl";

const Started = JsonlEvent.make("started", {
	data: Schema.Struct({ round: Schema.Number, phase: Schema.String }),
});
const Unlinked = JsonlEvent.make("unlinked", { data: Schema.Void, terminal: true });
const Relinked = JsonlEvent.make("relinked", { data: Schema.Void, reopen: true });
const events = [Started, Unlinked, Relinked] as const;

const Pair = JsonlEvent.make("pair", { data: Schema.Struct({ a: Schema.Number, b: Schema.Number }) });
const pairEvents = [Pair] as const;

/** A decoded `Schema.Class` payload — a class INSTANCE, not a plain record. */
class Boxed extends Schema.Class<Boxed>("Boxed")({
	round: Schema.Number,
	phase: Schema.String,
	note: Schema.optionalKey(Schema.String),
}) {}
const Box = JsonlEvent.make("boxed", { data: Boxed });
const boxEvents = [Box] as const;

class MailJournal extends Journal.Service<MailJournal>()("test/MailJournal", { events, config: { path: PATH } }) {}
class PairJournal extends Journal.Service<PairJournal>()("test/PairJournal", {
	events: pairEvents,
	config: { path: PATH },
}) {}
class BoxJournal extends Journal.Service<BoxJournal>()("test/BoxJournal", {
	events: boxEvents,
	config: { path: PATH },
}) {}

/** A runtime-only path, as a service: what a config `Effect` reads. */
class JournalPath extends Context.Service<JournalPath, string>()("test/JournalPath") {}

class PathedJournal extends Journal.Service<PathedJournal>()("test/PathedJournal", {
	events,
	config: Effect.gen(function* () {
		return { path: yield* JournalPath };
	}),
}) {}

class ConfigUnavailable extends Schema.TaggedError<ConfigUnavailable>()("ConfigUnavailable", {}) {}

class UnconfiguredJournal extends Journal.Service<UnconfiguredJournal>()("test/UnconfiguredJournal", {
	events,
	config: Effect.fail(new ConfigUnavailable()),
}) {}

/** Build a fresh memfs, with the parent directory present, and the class's layer over it. */
const harness = (seed?: string, memfs: MemFs = makeMemFs()) => {
	// The parent directory exists even when the journal does not: `create`
	// opens the path `O_APPEND`, which fails ENOENT under a missing parent on a
	// real filesystem, and memfs is honest about that.
	memfs.mkdir("/journal");
	if (seed !== undefined) memfs.write(PATH, seed);
	return { memfs, layer: MailJournal.layer.pipe(Layer.provide(memfs.layer)) };
};

// The layer's error channel carries `PlatformError`: a missing journal is legal
// and constructs cleanly, but an unreadable one is a real failure rather than a
// defect nobody can catch.
const runJournal = <A, E>(
	seed: string | undefined,
	body: (journal: MailJournal["Service"], memfs: MemFs) => Effect.Effect<A, E>,
	memfs?: MemFs,
): Effect.Effect<A, E | PlatformError.PlatformError> =>
	Effect.gen(function* () {
		const harnessed = harness(seed, memfs);
		return yield* Effect.gen(function* () {
			const journal = yield* MailJournal;
			return yield* body(journal, harnessed.memfs);
		}).pipe(Effect.provide(harnessed.layer));
	});

/**
 * The registry-erased engine over a memfs, in a scope the test closes — for
 * the tests that drive the hub directly. The hub is on no public shape.
 */
const openEngine = (memfs: MemFs, config: Partial<JournalConfig> = {}) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const engine = yield* makeEngine("test/Engine", events, { path: PATH, ...config }).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provide(memfs.layer),
		);
		return { scope, engine };
	});

const at = (iso: string) => DateTime.formatIso(DateTime.makeUnsafe(iso));

/** Assert the envelope carries `started`, then narrow — never a silent skip. */
const started = (envelope: EnvelopeUnion<typeof events>): EnvelopeWithTag<typeof events, "started"> => {
	assert.strictEqual(envelope.event, "started", "wrong envelope variant");
	return envelope as EnvelopeWithTag<typeof events, "started">;
};

const envelopeLine = (round: number, event = "started"): string =>
	`${JSON.stringify({ at: at("2026-01-01T00:00:00.000Z"), event, data: event === "started" ? { round, phase: "p" } : null })}\n`;

const failure = (method: string, tag: "NotFound" | "PermissionDenied") =>
	PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: PATH });

/** Spin the scheduler until `done` holds, without a clock. */
const settle = (done: () => boolean) =>
	Effect.gen(function* () {
		for (let turn = 0; turn < 100 && !done(); turn++) {
			yield* Effect.yieldNow;
		}
	});

const roundOf = (envelope: Option.Option<EnvelopeUnion<typeof events>>): number | undefined =>
	Option.match(envelope, { onNone: () => undefined, onSome: (value) => started(value).data.round });

describe("Journal — layer and lifecycle", () => {
	it.effect("constructs over a NONEXISTENT path without failing", () =>
		runJournal(undefined, (journal, memfs) =>
			Effect.gen(function* () {
				// A missing journal is a legal state: the layer builds and is usable.
				assert.isFalse(memfs.has(PATH));
				assert.isTrue(Option.isNone(yield* journal.latest), "and its state is empty");
			}),
		),
	);

	it.effect("an UNREADABLE journal fails construction TYPED, never as a defect", () =>
		Effect.gen(function* () {
			// A missing file is a legal state; a file that exists and cannot be read
			// is a real failure. Typing the layer's error channel `never` would make
			// this arrive as a defect no caller could catch.
			// The journal really exists (seeded), so `stat` answers from the volume;
			// only `open` is faulted, as a permissions error would.
			const denied = MemoryFileSystem.layerWith(
				{ [PATH]: "" },
				{ faults: { open: () => Effect.fail(failure("open", "PermissionDenied")) } },
			);
			const layer = MailJournal.layer.pipe(Layer.provide(denied));
			const scope = yield* Scope.make();
			const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope)));
			assert.isTrue(Exit.isFailure(exit), "construction fails rather than presenting an empty journal");
			const cause = (exit as Exit.Failure<never, unknown>).cause;
			assert.isTrue(Cause.hasFails(cause), "typed failure");
			assert.isFalse(Cause.hasDies(cause), "never a defect");
			yield* Scope.close(scope, Exit.void);
		}),
	);

	it.effect("a journal that VANISHES between the stat and the seed still constructs cleanly", () =>
		Effect.gen(function* () {
			// The one window construction cannot close: `stat` says the file is
			// there, then it is gone before the seed opens it. That is a missing
			// journal, which is legal — not an unreadable one. The fault delegates to
			// the real stat FIRST and unlinks after, so the race is real rather than
			// a stat that lies.
			let vanish = true;
			let unlink: (path: string) => void = () => {};
			const memfs = makeMemFs({
				faults: (base) => ({
					stat: (path) =>
						vanish && path === PATH
							? base.stat(path).pipe(
									Effect.tap(() =>
										Effect.sync(() => {
											vanish = false;
											unlink(PATH);
										}),
									),
								)
							: undefined,
				}),
			});
			unlink = memfs.unlink;
			const exit = yield* Effect.exit(
				runJournal(
					envelopeLine(1),
					(journal) =>
						Effect.gen(function* () {
							assert.isTrue(Option.isNone(yield* journal.latest), "nothing was seeded from a file that is gone");
							// And the journal is a working one once it is created.
							yield* journal.create;
							const envelope = yield* journal.append("started", { round: 2, phase: "p" });
							assert.strictEqual(envelope.position.offset, 0, "a fresh file starts at offset 0");
						}),
					memfs,
				),
			);
			assert.isFalse(vanish, "the fault fired: the file really did vanish after the stat");
			assert.isTrue(Exit.isSuccess(exit), `construction tolerated the race: ${String(exit)}`);
		}),
	);

	it.effect("append against a missing journal fails typed AND creates no file", () =>
		runJournal(undefined, (journal, memfs) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(journal.append("started", { round: 1, phase: "p" }));
				assert.isTrue(Exit.isFailure(exit));
				const cause = (exit as Exit.Failure<never, unknown>).cause;
				assert.isTrue(Cause.hasFails(cause), "typed failure");
				assert.isFalse(Cause.hasDies(cause), "never a defect");
				const failed = yield* Effect.flip(journal.append("started", { round: 1, phase: "p" }));
				assert.instanceOf(failed, JournalNotFound);
				// The headline half: an append NEVER materializes the file.
				assert.isFalse(memfs.has(PATH), "append must not create the journal");
				assert.deepStrictEqual(memfs.paths(), []);
			}),
		),
	);

	it.effect("a NotFound from `stat` on append is JournalNotFound, and nothing is written", () =>
		Effect.gen(function* () {
			// Absence is recognised by `stat` failing NotFound — not by an `exists`
			// probe beforehand. The file is really present here; only the stat
			// says otherwise, so an append that skipped the stat (or trusted some
			// other probe) would write.
			let missing = false;
			const memfs = makeMemFs({
				faults: () => ({
					stat: (path) => (missing && path === PATH ? Effect.fail(failure("stat", "NotFound")) : undefined),
				}),
			});
			return yield* runJournal(
				"",
				(journal) =>
					Effect.gen(function* () {
						missing = true;
						const failed = yield* Effect.flip(journal.append("started", { round: 1, phase: "p" }));
						assert.instanceOf(failed, JournalNotFound);
						assert.strictEqual((failed as JournalNotFound).path, PATH);
						assert.strictEqual(textOf(memfs, PATH), "", "nothing reached the file");
					}),
				memfs,
			);
		}),
	);

	it.effect("a non-NotFound `stat` failure on append passes through UNTRANSLATED", () =>
		Effect.gen(function* () {
			let denied = false;
			const memfs = makeMemFs({
				faults: () => ({
					stat: (path) => (denied && path === PATH ? Effect.fail(failure("stat", "PermissionDenied")) : undefined),
				}),
			});
			return yield* runJournal(
				"",
				(journal) =>
					Effect.gen(function* () {
						denied = true;
						const failed = yield* Effect.flip(journal.append("started", { round: 1, phase: "p" }));
						assert.isTrue(PlatformError.isPlatformError(failed), "a PlatformError, not a JournalNotFound");
						assert.strictEqual((failed as PlatformError.PlatformError).reason._tag, "PermissionDenied");
					}),
				memfs,
			);
		}),
	);

	it.effect("create is explicit and makes the journal appendable", () =>
		runJournal(undefined, (journal, memfs) =>
			Effect.gen(function* () {
				yield* journal.create;
				assert.isTrue(memfs.has(PATH));
				yield* journal.append("started", { round: 1, phase: "p" });
				assert.include(textOf(memfs, PATH), '"started"');
			}),
		),
	);

	it.effect("create on an EXISTING journal leaves its content untouched", () =>
		runJournal(envelopeLine(1), (journal, memfs) =>
			Effect.gen(function* () {
				yield* journal.create;
				assert.strictEqual(textOf(memfs, PATH), envelopeLine(1), "O_APPEND opens without truncating");
			}),
		),
	);

	it.effect("remove deletes the journal and tolerates a missing one", () =>
		runJournal(undefined, (journal, memfs) =>
			Effect.gen(function* () {
				yield* journal.remove; // absent: must not fail
				yield* journal.create;
				yield* journal.remove;
				assert.isFalse(memfs.has(PATH));
			}),
		),
	);
});

describe("Journal — definition: the static layer, make and config", () => {
	class SeenA extends Context.Service<SeenA, MailJournal["Service"]>()("test/SeenA") {}
	class SeenB extends Context.Service<SeenB, MailJournal["Service"]>()("test/SeenB") {}
	const seen = <I, S extends MailJournal["Service"], E, R>(
		tag: Context.Key<I, S>,
		journal: Layer.Layer<MailJournal, E, R>,
	) =>
		Layer.effect(
			tag,
			Effect.gen(function* () {
				return (yield* MailJournal) as S;
			}),
		).pipe(Layer.provide(journal));

	it.effect("`layer` is a VALUE: two consumers providing it get ONE journal", () =>
		Effect.gen(function* () {
			// The hazard the old `layer(config)` factory had: each call minted a
			// fresh layer, so two modules each providing "the" journal got two
			// unserialized engines over one file. A static value memoizes.
			const { memfs } = harness("");
			const graph = Layer.mergeAll(seen(SeenA, MailJournal.layer), seen(SeenB, MailJournal.layer)).pipe(
				Layer.provide(memfs.layer),
			);
			yield* Effect.gen(function* () {
				const a = yield* SeenA;
				const b = yield* SeenB;
				assert.strictEqual(a, b, "one journal, however often its layer is provided");
				// Behaviourally one: B's state moves with A's append, with no watcher
				// involved — the helper's watch only fires when the test pokes it.
				yield* a.append("started", { round: 1, phase: "a" });
				assert.strictEqual(roundOf(yield* b.latest), 1, "one `latest`, shared");
			}).pipe(Effect.provide(graph));
		}),
	);

	it.effect("`make` builds an INDEPENDENT journal per build", () =>
		Effect.gen(function* () {
			const { memfs } = harness("");
			// The runtime-path form. Two layers wrapping `make` are two journals —
			// the documented reason to bind such a layer once.
			const first = Layer.effect(MailJournal, MailJournal.make({ path: PATH }));
			const second = Layer.effect(MailJournal, MailJournal.make({ path: PATH }));
			const graph = Layer.mergeAll(seen(SeenA, first), seen(SeenB, second)).pipe(Layer.provide(memfs.layer));
			yield* Effect.gen(function* () {
				const a = yield* SeenA;
				const b = yield* SeenB;
				assert.notStrictEqual(a, b, "two builds, two journals");
				yield* a.append("started", { round: 1, phase: "a" });
				assert.strictEqual(roundOf(yield* a.latest), 1);
				assert.isTrue(
					Option.isNone(yield* b.latest),
					"the other journal's state does not move until its own watcher ingests",
				);
			}).pipe(Effect.provide(graph));
		}),
	);

	it.effect("`config` may be an Effect, resolved from the layer's context when it builds", () =>
		Effect.gen(function* () {
			const memfs = makeMemFs();
			memfs.mkdir("/runtime");
			const layer = PathedJournal.layer.pipe(
				Layer.provide(Layer.succeed(JournalPath, "/runtime/chosen.jsonl")),
				Layer.provide(memfs.layer),
			);
			yield* Effect.gen(function* () {
				const journal = yield* PathedJournal;
				yield* journal.create;
				yield* journal.append("started", { round: 1, phase: "p" });
			}).pipe(Effect.provide(layer));
			assert.include(textOf(memfs, "/runtime/chosen.jsonl"), '"round":1', "the path came from the service");
			assert.deepStrictEqual(memfs.paths(), ["/runtime/chosen.jsonl"], "and nothing else was touched");
		}),
	);

	it.effect("a failing config Effect fails the layer build with ITS error, typed", () =>
		Effect.gen(function* () {
			const memfs = makeMemFs();
			const scope = yield* Scope.make();
			const exit = yield* Effect.exit(
				Layer.build(UnconfiguredJournal.layer.pipe(Layer.provide(memfs.layer))).pipe(
					Effect.provideService(Scope.Scope, scope),
				),
			);
			assert.isTrue(Exit.isFailure(exit));
			const failed = Cause.findErrorOption((exit as Exit.Failure<never, unknown>).cause);
			assert.isTrue(Option.isSome(failed) && failed.value instanceof ConfigUnavailable, "the config's own error");
			yield* Scope.close(scope, Exit.void);
		}),
	);
});

describe("Journal — append", () => {
	it.effect("stamps `at` from the Clock, exactly, under TestClock", () =>
		runJournal("", (journal, memfs) =>
			Effect.gen(function* () {
				// TestClock starts at the epoch; set it somewhere unmistakable.
				yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-03T17:04:11.912Z")));
				const envelope = yield* journal.append("started", { round: 7, phase: "run" });
				assert.strictEqual(DateTime.formatIso(envelope.at), "2026-08-03T17:04:11.912Z");
				// And it is what landed on disk, not just what was returned.
				assert.include(textOf(memfs, PATH), '"at":"2026-08-03T17:04:11.912Z"');
			}),
		),
	);

	it.effect("writes exactly one complete line, terminator included", () =>
		runJournal("", (journal, memfs) =>
			Effect.gen(function* () {
				yield* journal.append("started", { round: 1, phase: "p" });
				const text = textOf(memfs, PATH);
				assert.isTrue(text.endsWith("\n"));
				assert.strictEqual(Line.split(text).length, 1);
			}),
		),
	);

	it.effect("appends accumulate in order, with positions that tile the file", () =>
		runJournal("", (journal, memfs) =>
			Effect.gen(function* () {
				const first = yield* journal.append("started", { round: 1, phase: "a" });
				const second = yield* journal.append("started", { round: 2, phase: "b" });
				const lines = Line.split(textOf(memfs, PATH));
				assert.strictEqual(lines.length, 2);
				const decoded = Envelope.decodeAllResult(events, textOf(memfs, PATH));
				assert.deepStrictEqual(decoded.map(Result.isSuccess), [true, true]);
				assert.deepStrictEqual(first.position, { offset: lines[0]?.offset, end: lines[0]?.end });
				assert.deepStrictEqual(second.position, { offset: lines[1]?.offset, end: lines[1]?.end });
			}),
		),
	);

	it.effect("updates `latest` to the appended envelope", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				yield* journal.append("started", { round: 3, phase: "c" });
				const envelope = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(envelope.event, "started");
				assert.deepStrictEqual(envelope.data, { round: 3, phase: "c" });
			}),
		),
	);

	it.effect("an UNREGISTERED tag is a defect, not a typed failure, and writes nothing", () =>
		runJournal("", (journal, memfs) =>
			Effect.gen(function* () {
				// The typed surface admits only registered tags, so reaching the
				// encoder with another one is a bug in the caller's casts — never a
				// recoverable condition to put in the error channel.
				const exit = yield* Effect.exit(journal.append("nope" as never, { round: 1, phase: "p" } as never));
				assert.isTrue(Exit.isFailure(exit));
				const cause = (exit as Exit.Failure<never, unknown>).cause;
				assert.isTrue(Cause.hasDies(cause), "a defect");
				assert.isFalse(Cause.hasFails(cause), "not a typed failure");
				assert.strictEqual(textOf(memfs, PATH), "", "nothing was written");
			}),
		),
	);
});

describe("Journal — latest and latestChanges", () => {
	it("`latest` is a read-only Effect, not a ref a consumer could set", () => {
		// Type-level: the surface exposes no SubscriptionRef. Never called.
		const _readOnly = (journal: MailJournal["Service"]) =>
			// @ts-expect-error — `latest` is an Effect; there is nothing to set.
			SubscriptionRef.set(journal.latest, Option.none());
		assert.isFunction(_readOnly);
	});

	it.effect("`latestChanges` emits the CURRENT value first, without waiting for a change", () =>
		runJournal(envelopeLine(1), (journal) =>
			Effect.gen(function* () {
				const head = yield* Effect.forkChild(Stream.runHead(journal.latestChanges));
				yield* settle(() => head.pollUnsafe() !== undefined);
				// Polled rather than joined: a stream that only emitted CHANGES would
				// hang a join here, and a hang names nothing.
				const exit = head.pollUnsafe();
				assert.isDefined(exit, "the current value arrived with no append to trigger it");
				yield* Fiber.interrupt(head);
				const first = Option.flatten(yield* Fiber.join(head).pipe(Effect.orElseSucceed(() => Option.none())));
				assert.strictEqual(roundOf(first), 1, "and it is the seeded tail");
			}),
		),
	);

	it.effect("`latestChanges` then follows every change, in order", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				const seenRounds: Array<number | undefined> = [];
				const running = yield* Effect.forkChild(
					Stream.runForEach(journal.latestChanges, (current) =>
						Effect.sync(() => {
							seenRounds.push(roundOf(current));
						}),
					),
				);
				yield* settle(() => seenRounds.length > 0);
				yield* journal.append("started", { round: 1, phase: "a" });
				yield* settle(() => seenRounds.length > 1);
				yield* journal.append("started", { round: 2, phase: "b" });
				yield* settle(() => seenRounds.length > 2);
				yield* Fiber.interrupt(running);
				assert.deepStrictEqual(seenRounds, [undefined, 1, 2], "empty, then each append");
			}),
		),
	);
});

describe("Journal — terminal and reopen", () => {
	it.effect("refuses an append after a terminal event", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				yield* journal.append("unlinked", undefined);
				const exit = yield* Effect.exit(journal.append("started", { round: 1, phase: "p" }));
				assert.isTrue(Exit.isFailure(exit));
				const cause = (exit as Exit.Failure<never, unknown>).cause;
				assert.isTrue(Cause.hasFails(cause));
				assert.isFalse(Cause.hasDies(cause));
				const failed = yield* Effect.flip(journal.append("started", { round: 1, phase: "p" }));
				assert.instanceOf(failed, TerminalViolation);
			}),
		),
	);

	it.effect("permits a `reopen` event after a terminal one, and appends after it", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				yield* journal.append("unlinked", undefined);
				yield* journal.append("relinked", undefined);
				// The journal is live again: an ordinary event now succeeds.
				const envelope = yield* journal.append("started", { round: 9, phase: "again" });
				assert.strictEqual(envelope.data.round, 9);
			}),
		),
	);

	it.effect("reports quiescence from the tail, and clears it on reopen", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				assert.isFalse(yield* journal.quiescent, "empty journal is not quiescent");
				yield* journal.append("unlinked", undefined);
				assert.isTrue(yield* journal.quiescent, "terminal tail is quiescent");
				yield* journal.append("relinked", undefined);
				assert.isFalse(yield* journal.quiescent, "reopened journal is not quiescent");
			}),
		),
	);
});

describe("Journal — appendPatch", () => {
	it.effect("shallow-merges the patch over the last envelope's data", () =>
		runJournal(envelopeLine(1), (journal) =>
			Effect.gen(function* () {
				const envelope = yield* journal.appendPatch("started", { round: 2 });
				// `phase` is inherited; `round` is patched.
				assert.deepStrictEqual(envelope.data, { round: 2, phase: "p" });
			}),
		),
	);

	it.effect("does not pollute Object.prototype through a __proto__ patch key", () =>
		runJournal(envelopeLine(1), (journal) =>
			Effect.gen(function* () {
				const hostile = JSON.parse('{"round":5,"__proto__":{"polluted":true}}') as Record<string, never>;
				const envelope = yield* journal.appendPatch("started", hostile);
				assert.isUndefined(Reflect.get({}, "polluted"));
				assert.isUndefined(Reflect.get(Object.prototype, "polluted"));
				// Prototype INTEGRITY, not just global cleanliness: an [[Set]] copy
				// hijacks the target's prototype without touching Object.prototype.
				const data = envelope.data as object;
				assert.strictEqual(Object.getPrototypeOf(data), Object.prototype, "payload prototype intact");
				assert.isUndefined(Reflect.get(data, "polluted"));
			}),
		),
	);

	it.effect("filters a hostile key coming from the BASE side too", () =>
		Effect.gen(function* () {
			// The base is decoded journal data, which an external writer controls
			// just as directly as the patch.
			const base = `${JSON.stringify({
				at: at("2026-01-01T00:00:00.000Z"),
				event: "started",
				data: JSON.parse('{"round":1,"phase":"p","__proto__":{"polluted":true}}') as unknown,
			})}\n`;
			return yield* runJournal(base, (journal) =>
				Effect.gen(function* () {
					const envelope = yield* journal.appendPatch("started", { round: 2 });
					assert.isUndefined(Reflect.get(Object.prototype, "polluted"));
					assert.strictEqual(Object.getPrototypeOf(envelope.data as object), Object.prototype);
				}),
			);
		}),
	);
});

describe("Journal — bounded tail reads", () => {
	it.effect("seeds `latest` from an existing journal", () =>
		runJournal(`${envelopeLine(1)}${envelopeLine(2)}${envelopeLine(3)}`, (journal) =>
			Effect.gen(function* () {
				const current = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(current.event, "started");
				assert.deepStrictEqual(current.data, { round: 3, phase: "p" });
			}),
		),
	);

	it.effect("WIDENS the window when the last line is longer than it", () =>
		Effect.gen(function* () {
			// One line far larger than the 8KiB default window, so the first read
			// contains no complete line at all and the widening path must run.
			const huge = `${JSON.stringify({
				at: at("2026-01-01T00:00:00.000Z"),
				event: "started",
				data: { round: 42, phase: "x".repeat(20_000) },
			})}\n`;
			return yield* runJournal(`${envelopeLine(1)}${huge}`, (journal) =>
				Effect.gen(function* () {
					const current = Option.getOrThrow(yield* journal.latest);
					assert.strictEqual(started(current).data.round, 42, "widening found the oversized last line");
				}),
			);
		}),
	);

	it.effect("walks back over a torn tail to the last valid ENVELOPE", () =>
		runJournal(`${envelopeLine(1)}${envelopeLine(2)}${envelopeLine(3).slice(0, 20)}`, (journal) =>
			Effect.gen(function* () {
				const current = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(started(current).data.round, 2);
			}),
		),
	);

	it.effect("is not fooled by a torn SCALAR tail", () =>
		runJournal(`${envelopeLine(1)}4`, (journal) =>
			Effect.gen(function* () {
				const current = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(started(current).data.round, 1, "a bare 4 is not an envelope");
			}),
		),
	);

	it.effect("is none for an empty journal", () =>
		runJournal("", (journal) =>
			Effect.gen(function* () {
				assert.isTrue(Option.isNone(yield* journal.latest));
			}),
		),
	);
});

describe("Journal — BOM", () => {
	it.effect("reads a BOM'd journal cleanly — the first line is not malformed", () =>
		runJournal(`﻿${envelopeLine(1)}${envelopeLine(2)}`, (journal) =>
			Effect.gen(function* () {
				const current = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(started(current).data.round, 2);
			}),
		),
	);

	it.effect("makes offsets POST-BOM relative — the first line begins at 0", () =>
		runJournal(`﻿${envelopeLine(1)}`, (journal) =>
			Effect.gen(function* () {
				const current = Option.getOrThrow(yield* journal.latest);
				assert.strictEqual(current.position.offset, 0, "the BOM does not shift the first line");
			}),
		),
	);

	it.effect("treats a non-leading U+FEFF as ordinary content", () =>
		Effect.gen(function* () {
			const withInner = `${JSON.stringify({
				at: at("2026-01-01T00:00:00.000Z"),
				event: "started",
				data: { round: 1, phase: "a﻿b" },
			})}\n`;
			return yield* runJournal(withInner, (journal) =>
				Effect.gen(function* () {
					const current = Option.getOrThrow(yield* journal.latest);
					assert.strictEqual(started(current).data.phase, "a﻿b", "an interior BOM is content");
				}),
			);
		}),
	);
});

describe("Journal — shutdown", () => {
	it.effect("refuses a late append with a TYPED failure rather than hanging", () =>
		Effect.gen(function* () {
			const { memfs, layer } = harness("");

			// Capture the service, then let its scope close.
			const escaped = yield* Effect.scoped(
				Effect.gen(function* () {
					const journal = yield* MailJournal;
					yield* journal.append("started", { round: 1, phase: "p" });
					return journal;
				}).pipe(Effect.provide(layer)),
			);

			// The scope is closed; the journal must REFUSE, not wait. A Latch here
			// would suspend forever — the reason refusal is a flag, not a latch.
			const exit = yield* Effect.exit(escaped.append("started", { round: 2, phase: "q" }));
			assert.isTrue(Exit.isFailure(exit));
			const cause = (exit as Exit.Failure<never, unknown>).cause;
			assert.isTrue(Cause.hasFails(cause), "refusal is typed");
			assert.isFalse(Cause.hasDies(cause));
			const failed = yield* Effect.flip(escaped.append("started", { round: 3, phase: "r" }));
			assert.instanceOf(failed, JournalClosed);
			// And the refused append wrote nothing.
			assert.strictEqual(Line.split(textOf(memfs, PATH)).length, 1);
		}),
	);

	it.effect("refuses a late append WITHOUT queuing behind an in-flight one", () =>
		Effect.gen(function* () {
			// The ordering decision 11 turns on, made observable. With a write held
			// open, an append occupies the permit; closing the scope sets the closed
			// flag and then waits for that permit to drain. A late append must be
			// refused DURING that window — while the in-flight append is still
			// running — which only happens if the flag is checked before the permit
			// is taken. Checked only inside the permit, the late append would queue
			// behind the gated one and be refused after it, and `inFlight` below
			// would already be complete.
			//
			// Its failure mode under that mutation is a HANG, surfacing as a vitest
			// timeout rather than an assertion — which is the point: it is the same
			// hang decision 11 says a `Latch` would cause, reproduced by moving the
			// check one line later. `Effect.timeout` cannot shorten it, because the
			// gate is real-time while `it.effect` runs on the TestClock.
			const { memfs, layer } = harness("");

			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, MailJournal);

			memfs.closeGate();
			const inFlight = yield* Effect.forkChild(journal.append("started", { round: 1, phase: "held" }));
			yield* Effect.yieldNow;
			const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
			yield* Effect.yieldNow;

			assert.isTrue(memfs.gateWasEntered(), "the in-flight write really did reach the gate");
			const failed = yield* Effect.flip(journal.append("started", { round: 2, phase: "late" }));
			assert.instanceOf(failed, JournalClosed);
			// The discriminating assertion: the held append has NOT finished yet.
			assert.isUndefined(inFlight.pollUnsafe(), "refused while the in-flight append still runs");

			memfs.openGate();
			yield* Fiber.join(inFlight);
			yield* Fiber.join(closing);
		}),
	);
});

describe("Journal — one bound layer is memoized", () => {
	it.effect("the same journal throughout one provide", () =>
		Effect.gen(function* () {
			const { layer } = harness("");
			const [a, b] = yield* Effect.gen(function* () {
				const first = yield* MailJournal;
				const second = yield* MailJournal;
				return [first, second] as const;
			}).pipe(Effect.provide(layer));
			assert.strictEqual(a, b, "one bound layer yields one journal");
		}),
	);
});

describe("Journal — appendPatch inherits from a Schema.Class payload", () => {
	const runBox = <A, E>(seed: string, body: (journal: BoxJournal["Service"]) => Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const memfs = makeMemFs();
			memfs.write(PATH, seed);
			return yield* Effect.gen(function* () {
				return yield* body(yield* BoxJournal);
			}).pipe(Effect.provide(BoxJournal.layer.pipe(Layer.provide(memfs.layer))));
		});

	it.effect("a partial patch INHERITS untouched fields from a class-instance base", () =>
		runBox(
			`${JSON.stringify({ at: at("2026-01-01T00:00:00.000Z"), event: "boxed", data: { round: 1, phase: "keep-me" } })}\n`,
			(journal) =>
				Effect.gen(function* () {
					const envelope = yield* journal.appendPatch("boxed", { round: 2 });
					assert.strictEqual(envelope.data.round, 2, "the patched field changed");
					assert.strictEqual(envelope.data.phase, "keep-me", "the untouched field was INHERITED, not dropped");
				}),
		),
	);

	it.effect("an OPTIONAL untouched field is inherited rather than dropped", () =>
		// Worth stating precisely, because the failure mode is NOT what it first
		// looks like: with a `Schema.Class` payload the replacement path produces
		// a plain object, which the class schema REJECTS — so the old guard
		// failed loudly (`InvalidData`) rather than silently. The defect was that
		// `appendPatch` was unusable with the kit's dominant payload idiom, not
		// that it lost data quietly. The fix is the same either way.
		runBox(
			`${JSON.stringify({
				at: at("2026-01-01T00:00:00.000Z"),
				event: "boxed",
				data: { round: 1, phase: "p", note: "must-survive" },
			})}\n`,
			(journal) =>
				Effect.gen(function* () {
					const envelope = yield* journal.appendPatch("boxed", { round: 2 });
					assert.strictEqual(envelope.data.note, "must-survive", "an optional field must survive a partial patch");
				}),
		),
	);
});

describe("Journal — concurrent appendPatch (lost-update)", () => {
	it.effect("two concurrent patches to different fields BOTH survive", () =>
		Effect.gen(function* () {
			// The read-merge-write must all happen under one lock. Read outside it,
			// and both patches see the same base and the second silently reverts
			// the first — invisible, because each append individually succeeds.
			const memfs = makeMemFs();
			memfs.write(
				PATH,
				`${JSON.stringify({ at: at("2026-01-01T00:00:00.000Z"), event: "pair", data: { a: 0, b: 0 } })}\n`,
			);
			const layer = PairJournal.layer.pipe(Layer.provide(memfs.layer));

			yield* Effect.gen(function* () {
				const journal = yield* PairJournal;

				// Hold the first patch inside the write permit.
				memfs.closeGate();
				const first = yield* Effect.forkChild(journal.appendPatch("pair", { a: 1 }));
				yield* Effect.yieldNow;
				assert.isTrue(memfs.gateWasEntered(), "the first patch is genuinely mid-write");

				// The second patch must not have read the base yet.
				const second = yield* Effect.forkChild(journal.appendPatch("pair", { b: 1 }));
				yield* Effect.yieldNow;

				memfs.openGate();
				yield* Fiber.join(first);
				const result = yield* Fiber.join(second);

				assert.deepStrictEqual(result.data, { a: 1, b: 1 }, "neither patch reverted the other");
			}).pipe(Effect.provide(layer));
		}),
	);
});

/** The rounds in a run of hub takes, envelope chunks only. */
const roundsOf = (takes: ReadonlyArray<unknown>): ReadonlyArray<number> =>
	takes
		.filter((take): take is ReadonlyArray<Item> => Array.isArray(take))
		.flatMap((chunk) =>
			chunk.map((item) => (Result.getOrThrow(item) as AnyEnvelope & { data: { round: number } }).data.round),
		);

describe("Journal — a stalled subscriber cannot wedge writers or shutdown", () => {
	it.effect("writes proceed and scope close completes while the hub is full", () =>
		Effect.gen(function* () {
			// A real subscriber that never drains. Note "no subscribers" would NOT
			// reproduce this: a hub with nobody listening accepts every publish
			// immediately, because there is nothing to buffer for. The stall needs
			// an actual subscription sitting at capacity — on the engine's hub,
			// which no public shape carries.
			const memfs = makeMemFs();
			memfs.write(PATH, "");
			const { scope, engine } = yield* openEngine(memfs, {
				capacity: 1,
				shutdownPublishTimeout: Duration.millis(50),
			});
			const journal = engine.journal;

			// Subscribe and never take: this is what makes the hub fill.
			const subscriberScope = yield* Scope.make();
			yield* PubSub.subscribe(engine.hub).pipe(Effect.provideService(Scope.Scope, subscriberScope));

			// Fills the hub to capacity.
			yield* journal.append("started", { round: 1, phase: "a" });
			// Blocks in publish — but its WRITE must land.
			const stalled = yield* Effect.forkChild(journal.append("started", { round: 2, phase: "b" }));
			yield* Effect.yieldNow;
			// A third writer proceeds through its write half regardless.
			const alsoStalled = yield* Effect.forkChild(journal.append("started", { round: 3, phase: "c" }));
			yield* Effect.yieldNow;

			assert.strictEqual(Line.split(textOf(memfs, PATH)).length, 3, "every write landed despite the stalled hub");
			assert.isUndefined(stalled.pollUnsafe(), "the stalled append has not completed (backpressure holds)");

			// Scope close must NOT deadlock on the wedged publish. The bound is
			// Clock-based, so under `it.effect`'s TestClock it fires only when the
			// clock is advanced — which makes this an assertion that the bound
			// exists rather than a real-time wait.
			const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
			yield* TestClock.adjust(Duration.millis(100));
			yield* Fiber.join(closing);

			yield* Fiber.interrupt(stalled);
			yield* Fiber.interrupt(alsoStalled);
			yield* Scope.close(subscriberScope, Exit.void);
		}),
	);
});

describe("Journal — the terminal Exit never overtakes a completed append", () => {
	it.effect("an outer-scope subscriber sees EVERY completed append before stream end", () =>
		Effect.gen(function* () {
			// The subscription lives in a scope that OUTLIVES the journal's, which is
			// the only way to observe what the terminal Exit did. Once publishing
			// left the write critical section, draining writes stopped implying
			// draining publishes — so the Exit, which is not on the baton chain,
			// could be published while an already-completed append's envelope was
			// still in flight.
			const memfs = makeMemFs();
			memfs.write(PATH, "");
			const outerScope = yield* Scope.make();
			const { scope: journalScope, engine } = yield* openEngine(memfs, {
				capacity: 1,
				shutdownPublishTimeout: Duration.seconds(30),
			});
			const journal = engine.journal;

			const subscription = yield* PubSub.subscribe(engine.hub).pipe(Effect.provideService(Scope.Scope, outerScope));

			// Capacity 1. A is accepted and fills the hub; B's publish then blocks on
			// capacity; C's blocks on B's BATON. That third append is what makes the
			// overtake reachable: with the Exit published directly it queues as a
			// waiting publisher AFTER B but BEFORE C — because C only reaches the hub
			// once B's baton is passed — so the stream ends between two completed
			// appends. With two appends the two blocked publishers happen to drain
			// FIFO in the right order and the bug hides.
			yield* journal.append("started", { round: 1, phase: "a" });
			const second = yield* Effect.forkChild(journal.append("started", { round: 2, phase: "b" }));
			yield* Effect.yieldNow;
			const third = yield* Effect.forkChild(journal.append("started", { round: 3, phase: "c" }));
			yield* Effect.yieldNow;

			// Close the journal while both publishes are still outstanding.
			const closing = yield* Effect.forkChild(Scope.close(journalScope, Exit.void));
			yield* Effect.yieldNow;

			// Draining makes room, letting the queued publishers through in turn.
			const takes: Array<unknown> = [];
			for (let index = 0; index < 4; index++) {
				takes.push(yield* PubSub.take(subscription));
			}
			yield* Fiber.join(second);
			yield* Fiber.join(third);
			yield* Fiber.join(closing);

			// All three completed appends, in order, and only THEN the stream end.
			assert.isTrue(Array.isArray(takes[0]), "first take is an envelope chunk");
			assert.isTrue(Array.isArray(takes[1]), "second take is an envelope chunk");
			assert.isTrue(Array.isArray(takes[2]), "the THIRD completed append is delivered before the Exit");
			assert.isFalse(Array.isArray(takes[3]), "the terminal Exit comes last");
			assert.deepStrictEqual(roundsOf(takes), [1, 2, 3], "every completed append was delivered");

			yield* Scope.close(outerScope, Exit.void);
		}),
	);
});

describe("Journal — BOM offsets are logical on every path", () => {
	const line = (round: number) =>
		`${JSON.stringify({ at: at("2026-01-01T00:00:00.000Z"), event: "started", data: { round, phase: "p" } })}\n`;
	/** The oversized last line of a journal comfortably larger than the 8 KiB default window. */
	const giant = `${JSON.stringify({ at: at("2026-01-01T00:00:00.000Z"), event: "started", data: { round: 999, phase: "y".repeat(9000) } })}\n`;
	const large = (rounds: number) => Array.from({ length: rounds }, (_, index) => line(index)).join("") + giant;

	const cases = [
		{ name: "no BOM, small", bom: "", body: line(1) + line(2), last: line(2) },
		{ name: "BOM, small", bom: "﻿", body: line(1) + line(2), last: line(2) },
		{ name: "no BOM, larger than the window", bom: "", body: large(60), last: giant },
		{ name: "BOM, larger than the window", bom: "﻿", body: large(60), last: giant },
	] as const;

	for (const testCase of cases) {
		it.effect(`${testCase.name}: the tail position is post-BOM logical`, () =>
			runJournal(`${testCase.bom}${testCase.body}`, (journal) =>
				Effect.gen(function* () {
					const current = started(Option.getOrThrow(yield* journal.latest));
					// Logical: the last line ends exactly at the journal's post-BOM
					// byte length, whatever the window did or the BOM was.
					const logicalSize = Line.byteLength(testCase.body);
					assert.strictEqual(current.position.end, logicalSize, "end is the logical size");
					assert.strictEqual(
						current.position.offset,
						logicalSize - Line.byteLength(testCase.last),
						"offset is logical too",
					);
				}),
			),
		);
	}

	it.effect("the `consumed` seed is logical: the next append continues the offsets", () =>
		runJournal(`﻿${large(60)}`, (journal) =>
			Effect.gen(function* () {
				const before = started(Option.getOrThrow(yield* journal.latest));
				const appended = yield* journal.append("started", { round: 1000, phase: "next" });
				// A physical seed would start the new line three bytes past where the
				// previous one ended.
				assert.strictEqual(appended.position.offset, before.position.end, "no gap and no overlap across the seed");
			}),
		),
	);
});
