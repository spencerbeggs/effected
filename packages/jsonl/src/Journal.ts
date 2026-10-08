// The `Journal` service: one append-only, schema-validated JSONL file.

import type { FileSystem, Option, PlatformError, Scope, Stream } from "effect";
import { Context, Effect, Layer } from "effect";
import type { EnvelopeUnion, EnvelopeWithTag } from "./Envelope.js";
import type { AppendError, AppendOptions, ChangesError, JournalConfig, QueryError } from "./internal/engine.js";
import { makeEngine } from "./internal/engine.js";
import type { JournalWatcher } from "./JournalWatcher.js";
import type { JsonlEvent } from "./JsonlEvent.js";
import type { Slice } from "./Slice.js";

/**
 * The shape of a `Journal`, typed by its registry.
 *
 * @public
 */
export interface JournalShape<R extends JsonlEvent.Registry> {
	/**
	 * Validate, encode and append one envelope.
	 *
	 * `at` is stamped here from the Effect `Clock` — never by the caller — so
	 * ordering does not depend on two writers agreeing about the time, and
	 * `TestClock` controls it exactly in tests.
	 */
	readonly append: <T extends JsonlEvent.Tag<R>>(
		event: T,
		data: JsonlEvent.Data<R, T>,
		options?: AppendOptions | undefined,
	) => Effect.Effect<EnvelopeWithTag<R, T>, AppendError>;

	/**
	 * Inherit-and-patch: shallow-merge `patch` over the current state's `data`,
	 * validate the result and append it — read and write under one lock.
	 *
	 * The snapshot-journal primitive: each line is a complete state and most
	 * transitions change one field. The merge is **shallow**: a nested object in
	 * the patch replaces the one beneath it.
	 */
	readonly appendPatch: <T extends JsonlEvent.Tag<R>>(
		event: T,
		patch: Partial<JsonlEvent.Data<R, T>>,
		options?: AppendOptions | undefined,
	) => Effect.Effect<EnvelopeWithTag<R, T>, AppendError>;

	/**
	 * The journal's current state: its last valid **envelope**.
	 *
	 * "Last valid" means the last valid envelope, never merely the last valid
	 * JSON. Kept current by local appends and by the watcher.
	 */
	readonly latest: Effect.Effect<Option.Option<EnvelopeUnion<R>>>;

	/** {@link JournalShape.latest} as a stream: the current value, then every change. */
	readonly latestChanges: Stream.Stream<Option.Option<EnvelopeUnion<R>>>;

	/**
	 * Whether the journal is quiescent — its tail is an event marked `terminal`.
	 * Derived from {@link JournalShape.latest}, so the two cannot disagree.
	 */
	readonly quiescent: Effect.Effect<boolean>;

	/**
	 * Historical read: a finite `Stream` of the envelopes matching `slice`.
	 *
	 * Resumable across restarts: persist a processed envelope's `position.end`
	 * and pass it back as `cursor`. Filtering happens on the envelope frame
	 * before the payload schema runs, so a non-matching line's `data` is never
	 * decoded.
	 *
	 * @remarks
	 * The read is paged: the region from `cursor` to the end of the file as of
	 * the call is read a bounded page at a time, each page's matches emitted
	 * before the next is read. Memory is a page plus the longest line, and a
	 * consumer that stops early stops the reading. A line is read once its `\n`
	 * lands: an unterminated tail may be a writer mid-append, so it is left out
	 * rather than rejected.
	 */
	readonly query: <T extends JsonlEvent.Tag<R> = JsonlEvent.Tag<R>>(
		slice?: Slice<R, T> | undefined,
	) => Stream.Stream<EnvelopeWithTag<R, T>, QueryError>;

	/**
	 * Live read: matching envelopes as they are appended, by this process or any
	 * other writer.
	 *
	 * With a `cursor`, replay and live tail are **one seam**: no gap and no
	 * duplicate at the join. The stream **ends** — it never hangs — when the
	 * journal becomes quiescent or its scope closes, and fails with
	 * `JournalResync` if the file is truncated or replaced beneath it.
	 *
	 * @remarks
	 * Every append that completed is delivered before the stream ends, provided
	 * the subscriber keeps taking; shutdown will not wait past its bound for one
	 * that does not.
	 */
	readonly changes: <T extends JsonlEvent.Tag<R> = JsonlEvent.Tag<R>>(
		slice?: Slice<R, T> | undefined,
	) => Stream.Stream<EnvelopeWithTag<R, T>, ChangesError>;

	/**
	 * A running fold over {@link JournalShape.changes}, emitted as it advances.
	 * The fold only sees its own slice, so a per-scope state machine is
	 * exhaustively checkable against that scope's events alone.
	 */
	readonly projection: <S, T extends JsonlEvent.Tag<R> = JsonlEvent.Tag<R>>(
		initial: S,
		fold: (state: S, envelope: EnvelopeWithTag<R, T>) => S,
		slice?: Slice<R, T> | undefined,
	) => Stream.Stream<S, ChangesError>;

	/** Create the journal file if it does not exist. Creation is always explicit. */
	readonly create: Effect.Effect<void, PlatformError.PlatformError>;

	/** Remove the journal file. */
	readonly remove: Effect.Effect<void, PlatformError.PlatformError>;
}

/**
 * A per-registry `Journal` service class.
 *
 * @public
 */
export interface JournalClass<Self, Id extends string, R extends JsonlEvent.Registry, E, RC>
	extends Context.ServiceClass<Self, Id, JournalShape<R>> {
	/** The registry this journal was defined over. */
	readonly events: R;
	/**
	 * The layer for this journal, built from the definition's `config`.
	 *
	 * One value per class, so providing it twice provides one journal twice —
	 * never two unsynchronized journals over the same file.
	 *
	 * @remarks
	 * A journal file that does not exist yet is legal and constructs cleanly; one
	 * that exists and cannot be read fails with `PlatformError`.
	 */
	readonly layer: Layer.Layer<Self, PlatformError.PlatformError | E, FileSystem.FileSystem | JournalWatcher | RC>;
	/**
	 * Build a journal over an explicit config, for a path only known at run
	 * time. Wrap it in `Layer.effect(Class, Class.make(config))` and bind that
	 * layer once: every build is an independent journal.
	 */
	readonly make: (
		config: JournalConfig,
	) => Effect.Effect<
		JournalShape<R>,
		PlatformError.PlatformError,
		FileSystem.FileSystem | JournalWatcher | Scope.Scope
	>;
}

/**
 * Defines journal services.
 *
 * @public
 */
export class Journal {
	private constructor() {}

	/**
	 * Define a `Journal` service class over a registry.
	 *
	 * Each registry gets its own uniquely-keyed class, so several journals
	 * coexist in one layer graph, each typed by its own registry. `config` is a
	 * plain record or an `Effect` producing one — so a path can come from
	 * `Config` or another service, resolved when the layer builds.
	 *
	 * @example
	 * ```ts
	 * import { Journal, JsonlEvent } from "@effected/jsonl";
	 * import { NodeJournalWatcher } from "@effected/jsonl/node";
	 * import { NodeFileSystem } from "@effect/platform-node";
	 * import { Effect, Schema } from "effect";
	 *
	 * const events = [JsonlEvent.make("mail", { data: Schema.Struct({ round: Schema.Number }) })] as const;
	 *
	 * class Mail extends Journal.Service<Mail>()("app/Mail", {
	 *   events,
	 *   config: { path: ".app/mail.jsonl" },
	 * }) {}
	 *
	 * const program = Effect.gen(function* () {
	 *   const mail = yield* Mail;
	 *   yield* mail.append("mail", { round: 1 });
	 * }).pipe(
	 *   Effect.provide(Mail.layer),
	 *   Effect.provide([NodeFileSystem.layer, NodeJournalWatcher.layer]),
	 * );
	 * ```
	 */
	static Service<Self>() {
		return <const Id extends string, const R extends JsonlEvent.Registry, E = never, RC = never>(
			id: Id,
			options: {
				readonly events: R;
				readonly config: JournalConfig | Effect.Effect<JournalConfig, E, RC>;
			},
		): JournalClass<Self, Id, R, E, RC> => {
			const make = (config: JournalConfig) =>
				// The one cast: the engine is registry-erased and typed here, once.
				Effect.map(makeEngine(id, options.events, config), (engine) => engine.journal as unknown as JournalShape<R>);
			const config = Effect.isEffect(options.config) ? options.config : Effect.succeed(options.config);
			class JournalService extends Context.Service<Self, JournalShape<R>>()(id) {
				static readonly events = options.events;
				static readonly make = make;
				static readonly layer = Layer.effect(JournalService, Effect.flatMap(config, make));
			}
			return JournalService as unknown as JournalClass<Self, Id, R, E, RC>;
		};
	}
}
