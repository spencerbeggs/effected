// The journal engine: one file, one write path, one hub, one watcher.
//
// Built type-erased — tags are strings, payloads `unknown` — and typed once, by
// `Journal`, at the service boundary. Keeping the registry generics out of here
// is what keeps the engine free of casts.

import type { Duration as DurationType, PlatformError, Scope, Take } from "effect";
import {
	ByteSize,
	Channel,
	DateTime,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Option,
	PubSub,
	Result,
	Semaphore,
	Stream,
	SubscriptionRef,
} from "effect";
import type { EnvelopeUnion, Frame } from "../Envelope.js";
import { Envelope, completeResult, frameResult } from "../Envelope.js";
import type { DecodeError, InvalidData, MalformedLine, UnknownEvent, UnserializableData } from "../JsonlError.js";
import { JournalClosed, JournalNotFound, JournalResync, TerminalViolation } from "../JsonlError.js";
import type { JsonlEvent } from "../JsonlEvent.js";
import { Line, isBlank } from "../Line.js";
import type { LinePosition, LineSlice } from "../LineSlice.js";
import type { AnySlice } from "../Slice.js";
import { matchesFrame } from "../Slice.js";
import { canMerge, shallowMerge } from "./merge.js";
import type { LinePage } from "./tail.js";
import { probeBomBytes, readLinePages, readTailUntil } from "./tail.js";

/**
 * Options for one append.
 *
 * @public
 */
export interface AppendOptions {
	/** The partition key to stamp on the envelope. */
	readonly scope?: string | undefined;
}

/**
 * Configuration for one journal.
 *
 * @public
 */
export interface JournalConfig {
	/** Path to the journal file. It need not exist yet. */
	readonly path: string;
	/**
	 * The directory to watch while the journal does not exist yet.
	 *
	 * Defaults to `path`'s parent — everything before its last `/` or `\`, the
	 * one piece of path arithmetic this package performs. Name it explicitly when
	 * your path convention does not survive that, such as a drive-relative
	 * Windows path. Used only until the journal exists.
	 */
	readonly directory?: string | undefined;
	/**
	 * Capacity of the internal subscriber hub. Bounded with backpressure: a slow
	 * subscriber slows appends rather than silently missing envelopes.
	 */
	readonly capacity?: number | undefined;
	/**
	 * How long scope close waits for subscribers to accept the end of the
	 * journal. Defaults to five seconds; a subscriber that never consumes must
	 * not be able to hold shutdown hostage.
	 */
	readonly shutdownPublishTimeout?: DurationType.Input | undefined;
}

/**
 * Why an append failed.
 *
 * `PlatformError` passes through untranslated. **Treat any `PlatformError` from
 * an append as a possibly-torn tail**: a failed write cannot be read as
 * "nothing was written". The next reader walks back over the fragment.
 *
 * @public
 */
export type AppendError =
	| JournalClosed
	| JournalNotFound
	| TerminalViolation
	| InvalidData
	| UnserializableData
	| PlatformError.PlatformError;

/**
 * Why a historical read failed. A {@link DecodeError} only arrives when the
 * slice asks for it with `onInvalid: "fail"`.
 *
 * @public
 */
export type QueryError = JournalNotFound | DecodeError | PlatformError.PlatformError;

/**
 * Why a live read failed: anything a query can fail with, plus the file being
 * truncated or replaced beneath the subscriber.
 *
 * @public
 */
export type ChangesError = QueryError | JournalResync;

/** A registry-erased envelope. */
export type AnyEnvelope = EnvelopeUnion<JsonlEvent.Registry>;

/** A line that could not be decoded, kept so a subscriber can decide what it means to it. */
interface Rejected {
	readonly error: DecodeError;
	/** The frame, when the line got that far — what a slice matches a rejection against. */
	readonly frame: Option.Option<Frame>;
	readonly position: LinePosition;
}

/**
 * One decoded line, as the hub and the read surfaces carry it.
 *
 * @internal
 */
export type Item = Result.Result<AnyEnvelope, Rejected>;

const positionOf = (item: Item): LinePosition =>
	Result.isSuccess(item) ? item.success.position : item.failure.position;

/**
 * The journal, registry-erased.
 *
 * @internal
 */
export interface ErasedJournal {
	readonly append: (event: string, data: unknown, options?: AppendOptions) => Effect.Effect<AnyEnvelope, AppendError>;
	readonly appendPatch: (
		event: string,
		patch: unknown,
		options?: AppendOptions,
	) => Effect.Effect<AnyEnvelope, AppendError>;
	readonly latest: Effect.Effect<Option.Option<AnyEnvelope>>;
	readonly latestChanges: Stream.Stream<Option.Option<AnyEnvelope>>;
	readonly quiescent: Effect.Effect<boolean>;
	readonly query: (slice?: AnySlice) => Stream.Stream<AnyEnvelope, QueryError>;
	readonly changes: (slice?: AnySlice) => Stream.Stream<AnyEnvelope, ChangesError>;
	readonly projection: <S>(
		initial: S,
		fold: (state: S, envelope: AnyEnvelope) => S,
		slice?: AnySlice,
	) => Stream.Stream<S, ChangesError>;
	readonly create: Effect.Effect<void, PlatformError.PlatformError>;
	readonly remove: Effect.Effect<void, PlatformError.PlatformError>;
}

/**
 * The engine: the journal, plus the hub it publishes to. The hub is exposed
 * to tests only — it is not part of any public shape.
 *
 * @internal
 */
export interface Engine {
	readonly journal: ErasedJournal;
	readonly hub: PubSub.PubSub<Take.Take<Item, JournalResync>>;
}

const SHUTDOWN_PUBLISH_TIMEOUT = Duration.seconds(5);

/**
 * How many times the watcher re-arms a watch that ends without observing
 * anything before it gives up. No timer is permitted here to back off a watch
 * that completes instantly, so giving up is the honest failure: local appends
 * keep working, live observation does not.
 */
const MAX_IMMEDIATE_REARMS = 8;

/**
 * Scheduler turns yielded to a freshly-forked watch consumer before the
 * catch-up read. `fs.watch` exposes no "registered" signal, so arming is
 * ordered ahead of catch-up by scheduling, not synchronisation — empirically
 * sufficient, not a proof. The airtight primitive would be
 * `FileSystem.WatchBackend.register`, at the cost of `WatchBackend` in `R`.
 */
const ARM_YIELDS = 3;

const encoder = new TextEncoder();

/**
 * Index of the last path separator, on either convention — a Windows path
 * contains no `/` at all.
 */
const lastSeparator = (path: string): number => Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

/** The last segment of a path, for comparison only — never opened. */
const basenameOf = (path: string): string => path.slice(lastSeparator(path) + 1);

/** {@link JournalConfig.directory}'s default. */
const parentOf = (path: string): string => {
	const separator = lastSeparator(path);
	if (separator < 0) return ".";
	return separator === 0 ? path.slice(0, 1) : path.slice(0, separator);
};

const identityOf = (info: FileSystem.File.Info): Option.Option<string> =>
	Option.map(info.ino, (ino) => `${info.dev}:${ino}`);

/**
 * Admit decoded items through a slice: matching envelopes pass, rejections end
 * the stream only when the slice asks (`onInvalid: "fail"`) and the line could
 * have mattered to it — its frame matched, or it had no frame to match.
 */
const admit = (items: ReadonlyArray<Item>, slice: AnySlice | undefined): Stream.Stream<AnyEnvelope, DecodeError> => {
	const admitted: Array<AnyEnvelope> = [];
	for (const item of items) {
		if (Result.isSuccess(item)) {
			if (matchesFrame(item.success, slice)) admitted.push(item.success);
			continue;
		}
		const rejected = item.failure;
		const relevant = Option.isNone(rejected.frame) || matchesFrame(rejected.frame.value, slice);
		if (slice?.onInvalid === "fail" && relevant) {
			// Everything before the bad line is delivered first.
			return Stream.concat(Stream.fromIterable(admitted), Stream.fail(rejected.error));
		}
	}
	return Stream.fromIterable(admitted);
};

/**
 * Build the engine over one journal file.
 *
 * @internal
 */
export const makeEngine = (
	id: string,
	events: JsonlEvent.Registry,
	config: JournalConfig,
): Effect.Effect<Engine, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const { path } = config;
		const terminalTags = new Set(events.filter((event) => event.terminal).map((event) => event.tag));
		const reopenTags = new Set(events.filter((event) => event.reopen).map((event) => event.tag));
		const isTerminal = (item: Item): boolean => Result.isSuccess(item) && terminalTags.has(item.success.event);

		/** Guards the WRITE critical section: file write plus state updates. */
		const writePermit = Semaphore.makeUnsafe(1);
		/**
		 * Serializes ingests against each other — two overlapping runs would read
		 * the same `consumed` and publish the same lines twice. Its own lock so an
		 * append is not blocked behind a slow catch-up read.
		 */
		const ingestPermit = Semaphore.makeUnsafe(1);
		/**
		 * The publish baton. Each publisher links a fresh Deferred onto this chain
		 * **under the write permit**, fixing publish order to write order, then
		 * awaits its predecessor and publishes OUTSIDE the permit — so a stalled
		 * subscriber blocks publishers without wedging writers or scope close.
		 */
		let publishBaton: Deferred.Deferred<void> = Deferred.makeUnsafe<void>();
		Deferred.doneUnsafe(publishBaton, Exit.void);
		/** Bytes of leading BOM, probed from the file — never inferred from a window. */
		let bomBytes = 0;
		/**
		 * The file's identity, for detecting replacement. `ino` is an `Option` in
		 * core's `File.Info`; where it is missing this degrades to truncation-only
		 * detection.
		 */
		let identity: Option.Option<string> = Option.none();
		/** Refusal state. Read before the permit so a late append fails fast. */
		let closed = false;
		/** Logical bytes consumed so far — where the next ingest resumes. */
		let consumed = 0;

		const hub = yield* PubSub.bounded<Take.Take<Item, JournalResync>>(config.capacity ?? 64);
		const latest = yield* SubscriptionRef.make(Option.none<AnyEnvelope>());

		const logicalSize = (info: FileSystem.File.Info): number => ByteSize.toNumberUnsafe(info.size) - bomBytes;

		/** `stat`, with a missing file as `none` rather than a failure. */
		const statOrMissing = fs.stat(path).pipe(
			Effect.map(Option.some),
			Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
		);

		const requireStat = Effect.flatMap(statOrMissing, (info) =>
			Option.match(info, {
				onNone: () => Effect.fail(new JournalNotFound({ path })),
				onSome: Effect.succeed,
			}),
		);

		const isTerminalTail = Effect.map(
			SubscriptionRef.get(latest),
			(current) => Option.isSome(current) && terminalTags.has(current.value.event),
		);

		/**
		 * Decode one line into an item, filter before decode: a line whose frame
		 * does not match `slice` returns `undefined` and its payload schema never
		 * runs. With no slice, every line becomes an item.
		 */
		const itemOf = (line: LineSlice, slice: AnySlice | undefined): Item | undefined => {
			const position = { offset: line.offset, end: line.end };
			const frame = frameResult(line);
			if (Result.isFailure(frame)) {
				return Result.fail({ error: frame.failure, frame: Option.none(), position });
			}
			if (!matchesFrame(frame.success, slice)) {
				return undefined;
			}
			const envelope = completeResult(events, line, frame.success);
			return Result.isSuccess(envelope)
				? Result.succeed(envelope.success)
				: Result.fail({ error: envelope.failure, frame: Option.some(frame.success), position });
		};

		const itemsOf = (page: LinePage, slice: AnySlice | undefined): ReadonlyArray<Item> => {
			const items: Array<Item> = [];
			for (const line of Line.split(page.text, page.start)) {
				// A line exists once its `\n` lands. An unterminated tail may be a
				// writer mid-append: reading it now would reject a line that is about to
				// be valid — and move the replay's de-duplication boundary past it, so
				// the completed line would then be dropped from the live half.
				if (!line.terminated || isBlank(line)) continue;
				const item = itemOf(line, slice);
				if (item !== undefined) items.push(item);
			}
			return items;
		};

		/**
		 * The complete, non-blank lines in `[from, to)`, in file order. `advanced`
		 * is where the last COMPLETE line ended: a torn tail holds the offset
		 * until its writer finishes it.
		 */
		const scanRange = (from: number, to: number) =>
			Effect.gen(function* () {
				const lines: Array<LineSlice> = [];
				let advanced = from;
				yield* Stream.runForEach(readLinePages(fs, path, from, to, bomBytes), (page) =>
					Effect.sync(() => {
						for (const line of Line.split(page.text, page.start)) {
							if (!line.terminated) return;
							advanced = line.end;
							if (!isBlank(line)) lines.push(line);
						}
					}),
				);
				return { lines, advanced };
			});

		const toItems = (lines: ReadonlyArray<LineSlice>): Array<Item> =>
			lines.map((line) => itemOf(line, undefined) as Item);

		/** Decode the gap `[from, to)` a watcher catch-up has to publish. */
		const decodeRange = (from: number, to: number) =>
			Effect.map(scanRange(from, to), ({ lines, advanced }) => ({ items: toItems(lines), advanced }));

		const lastEnvelope = (items: ReadonlyArray<Item>): Option.Option<AnyEnvelope> => {
			for (let index = items.length - 1; index >= 0; index--) {
				const item = items[index] as Item;
				if (Result.isSuccess(item)) return Option.some(item.success);
			}
			return Option.none();
		};

		/** Link onto the publish chain. Call ONLY under the write permit. */
		const linkBaton = () => {
			const predecessor = publishBaton;
			const baton = Deferred.makeUnsafe<void>();
			publishBaton = baton;
			return { predecessor, baton };
		};

		/**
		 * Publish in chain order, outside the write permit. `uninterruptibleMask`
		 * installs the baton hand-off before any interrupt can land, while the
		 * await-and-publish itself stays interruptible — otherwise an interrupt in
		 * between would leave every later publisher waiting on a baton nobody
		 * passes.
		 */
		const publishAfter = (link: ReturnType<typeof linkBaton>, items: ReadonlyArray<Item>) =>
			Effect.uninterruptibleMask((restore) =>
				restore(
					Effect.gen(function* () {
						yield* Deferred.await(link.predecessor);
						for (const item of items) {
							yield* PubSub.publish(hub, [item]);
						}
					}),
				).pipe(Effect.ensuring(Deferred.done(link.baton, Exit.void))),
			);

		/**
		 * Adopt the file as it is now: its BOM, its identity, its current state,
		 * and the end of its last complete line as the resume point. Construction
		 * and recovery from a resync both start here, so there is one definition
		 * of "caught up".
		 */
		const seed = (info: FileSystem.File.Info) =>
			Effect.gen(function* () {
				bomBytes = yield* probeBomBytes(fs, path);
				identity = identityOf(info);
				// Resume where the last COMPLETE line ends, not at the file's size: a
				// torn tail may be a writer mid-append, and resuming past it would read
				// only the second half of that line once it completes. Read BEFORE
				// `latest`: the two walks each sample the file, so a line another writer
				// lands between them is then past `consumed` and the watcher publishes
				// it — read after, it would be skipped for good and `latest` left stale.
				const resume = yield* readTailUntil(fs, path, bomBytes, (window) => {
					const lines = Line.split(window.text, window.start);
					for (let index = lines.length - 1; index >= 0; index--) {
						const line = lines[index] as LineSlice;
						if (line.terminated) return Option.some(line.end);
					}
					return Option.none();
				});
				consumed = Option.getOrElse(resume, () => 0);
				const found = yield* readTailUntil(fs, path, bomBytes, (window) =>
					Envelope.lastValid(events, window.text, window.start),
				);
				yield* SubscriptionRef.set(latest, found);
			});

		/**
		 * The one write path. `build` runs **inside the write permit**, so an
		 * inherit-and-patch reads the state it patches under the same lock that
		 * serializes the write — reading it outside was a lost-update race.
		 */
		const appendWith = (
			event: string,
			build: (current: Option.Option<AnyEnvelope>) => unknown,
			scope: string | undefined,
		): Effect.Effect<AnyEnvelope, AppendError> =>
			Effect.gen(function* () {
				// Checked BEFORE the permit too: a late append must not queue behind a
				// draining flush only to be refused after waiting.
				if (closed) {
					return yield* new JournalClosed({ event });
				}
				const { envelope, before, after, link } = yield* writePermit.withPermits(1)(
					Effect.gen(function* () {
						if (closed) {
							return yield* new JournalClosed({ event });
						}
						yield* requireStat;
						const current = yield* SubscriptionRef.get(latest);
						if (Option.isSome(current) && terminalTags.has(current.value.event) && !reopenTags.has(event)) {
							return yield* new TerminalViolation({ event, terminal: current.value.event });
						}
						const encoded = Envelope.encodeResult(events, {
							event,
							data: build(current) as never,
							at: yield* DateTime.now,
							...(scope === undefined ? {} : { scope }),
						});
						if (Result.isFailure(encoded)) {
							// The typed surface only admits registered tags.
							if (encoded.failure._tag === "UnknownEvent") return yield* Effect.die(encoded.failure);
							return yield* encoded.failure;
						}
						const bytes = encoder.encode(encoded.success);

						// ONE `writeAll` of the complete line to an O_APPEND handle. A
						// failure means POSSIBLY TORN, never "nothing was written".
						let end = yield* Effect.scoped(
							Effect.gen(function* () {
								const file = yield* fs.open(path, { flag: "a" });
								yield* file.writeAll(bytes);
								return logicalSize(yield* file.stat);
							}),
						);
						const text = encoded.success.slice(0, -1);
						let own: LineSlice = { offset: end - bytes.length, end, length: bytes.length - 1, text, terminated: true };
						let before: Array<Item> = [];
						let after: Array<Item> = [];
						if (own.offset !== consumed) {
							// Other writers' bytes are in the file too, and `end` alone cannot
							// say where ours landed: O_APPEND reports no position, and another
							// process may append between our write and our `fstat`, which
							// overstates `end`. So read the gap and FIND our line in it. Lines
							// ahead of ours are published first, lines after it after it, so
							// the hub carries the file's order however the bytes interleaved.
							// When the file grew by exactly our line, no other writer can have
							// touched it and nothing is read — the common case.
							const scan = yield* scanRange(consumed, end);
							const index = scan.lines.findLastIndex((line) => line.text === text && line.offset <= own.offset);
							if (index !== -1) {
								own = scan.lines[index] as LineSlice;
								before = toItems(scan.lines.slice(0, index));
								after = toItems(scan.lines.slice(index + 1));
								end = scan.advanced;
							} else {
								// Not where it can only be: the file was truncated or replaced
								// underneath the write. Keep the fstat position; the watcher's
								// resync check names the breach.
								before = toItems(scan.lines);
							}
						}
						// Never lowered here: only a resync moves `consumed` back. When our
						// line was not found, the file shrank or was replaced beneath the
						// write, and keeping the higher offset is what lets the next ingest
						// see the size fall below it and surface the breach.
						consumed = Math.max(consumed, end);

						// Decode our own line back, so the envelope returned is exactly the
						// one a reader of the file gets.
						const decoded = Envelope.decodeResult(events, own);
						if (Result.isFailure(decoded)) {
							// A payload schema whose encoded form does not decode is the
							// caller's to know about; anything else is a bug here.
							if (decoded.failure._tag === "InvalidData") return yield* decoded.failure;
							return yield* Effect.die(decoded.failure as MalformedLine | UnknownEvent);
						}
						yield* SubscriptionRef.set(
							latest,
							Option.orElse(lastEnvelope(after), () => Option.some(decoded.success)),
						);
						return { envelope: decoded.success, before, after, link: linkBaton() };
					}),
				);
				yield* publishAfter(link, [...before, Result.succeed(envelope), ...after]);
				return envelope;
			}).pipe(Effect.withSpan(`${id}.append`, { attributes: { event } }));

		/**
		 * The historical read, one array of items per page. The region is fixed
		 * by ONE stat, so an append landing while the pages are read stays out.
		 */
		const history = (slice: AnySlice | undefined): Stream.Stream<ReadonlyArray<Item>, QueryError> =>
			Stream.unwrap(
				Effect.map(requireStat, (info) =>
					readLinePages(fs, path, slice?.cursor ?? 0, logicalSize(info), bomBytes).pipe(
						Stream.map((page) => itemsOf(page, slice)),
					),
				),
			);

		const changes = (slice: AnySlice | undefined): Stream.Stream<AnyEnvelope, ChangesError> =>
			Stream.unwrap(
				Effect.gen(function* () {
					const replay = slice?.cursor === undefined ? Stream.empty : history(slice);
					// Quiescent already? A terminal published before this subscriber
					// attached is invisible to it — a hub has no replay — so without this
					// the stream would wait for something that already happened.
					if ((yield* isTerminalTail) || closed) {
						return replay.pipe(Stream.flatMap((items) => admit(items, slice)));
					}
					// SUBSCRIBE BEFORE REPLAYING, in the effect the stream is unwrapped
					// from. `Stream.fromPubSubTake` subscribes on first pull, which
					// `Stream.concat` does not reach until the replay is done — every
					// append published meanwhile would be lost.
					const subscription = yield* PubSub.subscribe(hub);
					// A line can be on disk when the replay reads it AND still in flight
					// to the hub. Offsets are monotonic, so the last replayed `end` is the
					// boundary between "delivered" and "new".
					let replayedThrough = slice?.cursor ?? 0;
					const replayed = replay.pipe(
						Stream.tap((items) =>
							Effect.sync(() => {
								const last = items.at(-1);
								if (last !== undefined) replayedThrough = Math.max(replayedThrough, positionOf(last).end);
							}),
						),
					);
					const live = Stream.fromChannel(Channel.fromEffectTake(PubSub.take(subscription))).pipe(
						// The terminal envelope ends THIS subscription whatever the slice
						// says, and before de-duplication: a terminal the replay already
						// delivered must still end the stream.
						Stream.takeUntil(isTerminal),
						Stream.filter((item) => positionOf(item).offset >= replayedThrough),
						Stream.map((item) => [item]),
					);
					// ONE seam, filtered the same way on both sides of the join.
					return Stream.concat(replayed, live).pipe(Stream.flatMap((items) => admit(items, slice)));
				}),
			);

		/**
		 * Ingest whatever has been appended since `consumed`, into the same hub
		 * and `latest` as a local append, in file order.
		 */
		const ingest = ingestPermit.withPermits(1)(
			Effect.gen(function* () {
				// Captured BEFORE the stat. Appends raise `consumed` under the write
				// permit, which this does not hold, so one can finish while the stat is
				// in flight; comparing a size sampled before that append with the
				// `consumed` after it would report a truncation that did not happen.
				// Outside a resync `consumed` never decreases (appends only raise it),
				// and only this ingest — under `ingestPermit` — resyncs, so a size below
				// this floor is a real one.
				const floor = consumed;
				const stat = yield* statOrMissing;
				if (Option.isNone(stat)) {
					return;
				}
				const info = stat.value;
				const currentIdentity = identityOf(info);
				const size = logicalSize(info);
				const replaced =
					Option.isSome(identity) && Option.isSome(currentIdentity) && identity.value !== currentIdentity.value;
				if (replaced || size < floor) {
					// A contract breach: surfaced, never silently reconciled. Subscribers
					// end with it; the journal re-adopts the file as it now is — a node
					// watcher follows the inode, so without this the journal goes blind.
					const failure = new JournalResync({
						path,
						reason: replaced ? "replaced" : "truncated",
						expected: floor,
						actual: size,
					});
					// Re-seed under the permit, from a fresh stat: the seed must adopt the
					// file as it is with appends excluded. Its resume point is read from
					// the file itself, so an append that landed after the stat above is
					// not rewound past and published twice; the fresh stat keeps identity
					// current and turns a file removed meanwhile into a clean reset.
					yield* writePermit.withPermits(1)(
						Effect.flatMap(statOrMissing, (current) =>
							Option.match(current, {
								onSome: seed,
								onNone: () =>
									Effect.andThen(
										Effect.sync(() => {
											identity = Option.none();
											bomBytes = 0;
											consumed = 0;
										}),
										SubscriptionRef.set(latest, Option.none()),
									),
							}),
						),
					);
					yield* PubSub.publish(hub, Exit.fail(failure));
					return;
				}
				identity = currentIdentity;
				if (size <= consumed) {
					return;
				}
				const { items, link } = yield* writePermit.withPermits(1)(
					Effect.gen(function* () {
						// Re-read under the permit: an append may have taken the bytes.
						const { items, advanced } = yield* decodeRange(consumed, size);
						consumed = advanced;
						const last = lastEnvelope(items);
						if (Option.isSome(last)) yield* SubscriptionRef.set(latest, last);
						return { items, link: linkBaton() };
					}),
				);
				yield* publishAfter(link, items);
			}),
		);

		const journal: ErasedJournal = {
			append: (event, data, options) => appendWith(event, () => data, options?.scope),
			appendPatch: (event, patch, options) =>
				appendWith(
					event,
					(current) => {
						const base = Option.isSome(current) ? current.value.data : undefined;
						// Nothing inheritable — an empty journal, a void/scalar/array
						// payload, or a patch from a different class — means the patch IS
						// the data, and a partial one fails its schema naming what is
						// missing. A decoded `Schema.Class` base DOES merge.
						return canMerge(base, patch)
							? shallowMerge(base as Record<string, unknown>, patch as Record<string, unknown>)
							: patch;
					},
					options?.scope,
				),
			latest: SubscriptionRef.get(latest),
			latestChanges: SubscriptionRef.changes(latest),
			quiescent: isTerminalTail,
			query: (slice) => history(slice).pipe(Stream.flatMap((items) => admit(items, slice))),
			changes,
			projection: (initial, fold, slice) => changes(slice).pipe(Stream.scan(() => initial, fold)),
			// O_APPEND creates the file and writes nothing; an existing file is
			// untouched. Never "touch" with a zero-byte `writeAll` — that reports
			// `WriteZero` on a file it just created.
			create: Effect.scoped(fs.open(path, { flag: "a" })).pipe(Effect.asVoid, Effect.withSpan(`${id}.create`)),
			remove: fs.remove(path, { force: true }).pipe(Effect.withSpan(`${id}.remove`)),
		};

		// A missing file is legal: construction never fails on one, including one
		// that vanishes between the stat and the seed.
		const initial = yield* statOrMissing;
		if (Option.isSome(initial)) {
			yield* seed(initial.value).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));
		}

		/*
		 * Watch for the life of the layer scope — two watches, and the distinction
		 * matters:
		 *
		 * - **The journal itself**, once it exists: one event per append.
		 * - **The parent directory**, while the journal does not exist yet. Its
		 *   tags are NOT trustworthy (a node backend reports creation and append
		 *   alike as `Remove`, with a bare relative path), so any event whose
		 *   basename matches is an untyped poke: "re-stat the journal yourself".
		 *   It ends once the journal exists — a non-recursive directory watch
		 *   reports creation, not a child's appends.
		 *
		 * `event.path` is never opened or read: it can be a bare basename that
		 * resolves against the process CWD. No timer anywhere.
		 */
		const basename = basenameOf(path);
		const directory = config.directory ?? parentOf(path);

		const watchJournal = fs.watch(path).pipe(
			Stream.runForEach(() => ingest),
			Effect.ignore,
		);

		const watchForCreation = fs.watch(directory).pipe(
			Stream.filter((event) => basenameOf(event.path) === basename),
			// The element that ends the watch is still emitted, so the creation
			// event that ends it also catches the journal up.
			Stream.takeUntilEffect(() => fs.exists(path)),
			Stream.runForEach(() => ingest),
			Effect.ignore,
		);

		const supervise = Effect.gen(function* () {
			let immediateCompletions = 0;
			for (;;) {
				const startedAt = consumed;
				if (yield* fs.exists(path)) {
					// ARM FIRST, THEN CATCH UP. The reverse leaves a window in which the
					// file grows while nothing watches and nothing will re-read.
					const armed = yield* Effect.forkChild(watchJournal);
					for (let turn = 0; turn < ARM_YIELDS; turn++) {
						yield* Effect.yieldNow;
					}
					yield* ingest;
					yield* Fiber.join(armed);
					// The watch ended — the file was replaced or removed. Ingest, then
					// loop back and re-arm against whatever the path names now.
					yield* ingest;
				} else {
					yield* watchForCreation;
				}
				immediateCompletions = consumed === startedAt ? immediateCompletions + 1 : 0;
				if (immediateCompletions > MAX_IMMEDIATE_REARMS) {
					return;
				}
			}
		});

		// If the watch cannot be established, local appends keep working and only
		// external observation stops; failing the layer would break the
		// missing-journal contract.
		yield* Effect.forkScoped(supervise.pipe(Effect.ignore));

		// Graceful shutdown: refusal is the `closed` flag; drain is taking the
		// permit (the in-flight append finishes) and capturing the tail of the
		// publish chain under it, so the end of the stream cannot overtake an
		// envelope whose append already completed. Bounded, because a subscriber
		// that never consumes cannot observe completion and must not block close.
		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				closed = true;
				const pending = yield* writePermit.withPermits(1)(Effect.sync(() => publishBaton));
				yield* Effect.interruptible(Effect.andThen(Deferred.await(pending), PubSub.publish(hub, Exit.void))).pipe(
					Effect.timeout(config.shutdownPublishTimeout ?? SHUTDOWN_PUBLISH_TIMEOUT),
					Effect.ignore,
				);
			}),
		);

		return { journal, hub };
	});
