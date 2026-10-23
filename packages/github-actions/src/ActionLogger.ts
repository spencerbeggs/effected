import type { AnnotationProperties } from "@effected/github-commands";
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import { Console, Context, Effect, Exit, Inspectable, Layer, LogLevel, Logger, References } from "effect";
import { ActionEnvironment } from "./ActionEnvironment.js";

/**
 * Render a log message, which arrives as an array of the values passed to
 * `Effect.log*`.
 *
 * @remarks
 * `toStringUnknown` is called with zero indentation on purpose: a pretty-printed
 * object would span lines, and a workflow command escapes every newline, so the
 * indented form buys nothing and costs readability.
 */
const formatMessage = (message: unknown): string => {
	const parts = Array.isArray(message) ? message : [message];
	return parts.map((part) => Inspectable.toStringUnknown(part, 0)).join(" ");
};

/** A log annotation read as text, when it is text. */
const textAnnotation = (record: Readonly<Record<string, unknown>>, key: string): string | undefined => {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
};

/** A log annotation read as a number, accepting the string form the runner produces. */
const numericAnnotation = (record: Readonly<Record<string, unknown>>, key: string): number | undefined => {
	const value = record[key];
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string" && value !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
};

/**
 * Project log annotations onto the annotation vocabulary.
 *
 * @remarks
 * The keys are the readable ones from {@link AnnotationProperties}, not GitHub's
 * abbreviated wire names — one vocabulary per package, with the abbreviation
 * confined to {@link WorkflowCommand}. Undefined fields are omitted rather than
 * set, so a caller that annotated nothing renders a bare command.
 */
const readAnnotations = (record: Readonly<Record<string, unknown>>): AnnotationProperties => {
	const title = textAnnotation(record, "title");
	const file = textAnnotation(record, "file");
	const startLine = numericAnnotation(record, "startLine");
	const endLine = numericAnnotation(record, "endLine");
	const startColumn = numericAnnotation(record, "startColumn");
	const endColumn = numericAnnotation(record, "endColumn");
	return {
		...(title === undefined ? {} : { title }),
		...(file === undefined ? {} : { file }),
		...(startLine === undefined ? {} : { startLine }),
		...(endLine === undefined ? {} : { endLine }),
		...(startColumn === undefined ? {} : { startColumn }),
		...(endColumn === undefined ? {} : { endColumn }),
	};
};

/**
 * The inverse: annotation fields as a record `Effect.annotateLogs` accepts.
 * A plain copy: `exactOptionalPropertyTypes` keeps an absent field absent
 * rather than present-and-`undefined`, and {@link readAnnotations} drops
 * anything that is not a string or number on the way back out.
 */
const annotationRecord = (properties: AnnotationProperties): Record<string, unknown> => ({ ...properties });

/**
 * Map one log entry onto the line the runner should see.
 *
 * @remarks
 * `Info` is deliberately plain text with no command prefix — it is ordinary
 * step output, and prefixing it would make every informational line an
 * annotation in the workflow summary. It is neutralized, though: the text is
 * whatever the program logged, and the runner reads every line of stdout, so a
 * message carrying `::add-mask::` or a `##[` would be a command. The levels that
 * render AS a command escape their data instead, and a line that starts `::` is
 * read by the runner as that command alone.
 */
const renderEntry = (
	level: LogLevel.LogLevel,
	message: unknown,
	annotations: Readonly<Record<string, unknown>>,
): string => {
	const text = formatMessage(message);
	if (LogLevel.isGreaterThanOrEqualTo(level, "Warn")) {
		const properties = readAnnotations(annotations);
		return LogLevel.isGreaterThanOrEqualTo(level, "Error")
			? WorkflowCommand.error(text, properties)
			: WorkflowCommand.warning(text, properties);
	}
	return LogLevel.isGreaterThanOrEqualTo(level, "Info") ? CommandNeutralizer.text(text) : WorkflowCommand.debug(text);
};

/** The line the runner should see for one log event, with the fiber's annotations. */
const renderLogger: Logger.Logger<unknown, string> = Logger.make((options) =>
	renderEntry(options.logLevel, options.message, options.fiber.getRef(References.CurrentLogAnnotations)),
);

/** {@link renderLogger} written through core `Console`. */
const commandLogger: Logger.Logger<unknown, void> = Logger.withConsoleLog(renderLogger);

/** A step's captured transcript. Mutable by design — a logger callback is synchronous. */
interface BufferState {
	readonly label: string;
	readonly entries: Array<string>;
}

/**
 * The buffer the current fiber is writing into, or `null` when not buffering.
 *
 * @remarks
 * A `Context.Reference` rather than a module-level "current buffer": two steps
 * running concurrently each keep their own transcript, and neither has to
 * restore anything. A save/restore global is LIFO-correct only while the two
 * buffers nest, which concurrent steps do not.
 *
 * @internal
 */
const ActiveBuffer = Context.Reference<BufferState | null>("@effected/github-actions/ActiveBuffer", {
	defaultValue: () => null,
});

/**
 * How many {@link ActionLoggerShape.group} calls the current fiber is inside.
 *
 * @remarks
 * The runner does not nest groups: a second `::group::` implicitly ends the
 * first, leaving an empty outer header and a stray `::endgroup::`. So only
 * depth 0 writes the group commands, and a nested call writes a plain header
 * line instead. Fiber-scoped for the same reason as {@link ActiveBuffer}: a
 * `Context.Reference` is provided around the body, so it unwinds on every
 * exit path with nothing to restore.
 *
 * @internal
 */
const GroupDepth = Context.Reference<number>("@effected/github-actions/GroupDepth", {
	defaultValue: () => 0,
});

/**
 * The line a nested group writes in place of a second `::group::`.
 *
 * @remarks
 * Line breaks collapse to spaces so the header stays one line — the
 * top-level form escapes them into one command — and the result is
 * neutralized, because a group name is caller text and a `::` or `##[` in it
 * would otherwise be a command.
 */
const nestedHeader = (name: string): string => CommandNeutralizer.text(`▸ ${name.replace(/\r\n|\r|\n/g, " ")}`);

/** Drop a transcript without writing it, so a green step stays quiet. */
const discard = (state: BufferState): Effect.Effect<void> =>
	Effect.sync(() => {
		state.entries.length = 0;
	});

/** Write a transcript out and clear it, so a second flush is a no-op. */
const flush = (state: BufferState): Effect.Effect<void> =>
	Effect.suspend(() => {
		if (state.entries.length === 0) {
			return Effect.void;
		}
		const body = [
			`--- Buffered output for "${state.label}" ---`,
			...state.entries,
			`--- End buffered output for "${state.label}" ---`,
		];
		state.entries.length = 0;
		// The transcript is the program's own log text and the label a step name: neutralized, as the live lines were.
		return Effect.forEach(body, (line) => Console.log(CommandNeutralizer.text(line)), { discard: true });
	});

/**
 * Options for {@link ActionLoggerShape.withBuffer}.
 *
 * @public
 */
export interface WithBufferOptions {
	/**
	 * What happens to the captured transcript when the step **succeeds**.
	 *
	 * @remarks
	 * `"flush"` — the default — replays it, so a clean run still prints what it
	 * did. `"discard"` drops it, which is what keeps a green release log to one
	 * line per step: the transcript exists only as the failure report. A failure,
	 * a defect or an interruption flushes under either setting — the choice is
	 * only about what a success is worth in the log.
	 */
	readonly onSuccess?: "flush" | "discard";
}

/**
 * Options for {@link ActionLoggerShape.withStep}.
 *
 * @public
 */
export interface WithStepOptions {
	/**
	 * The info line emitted when the step **succeeds**.
	 *
	 * @remarks
	 * Defaults to `✅ <name>`. This is the line the buffered transcript is traded
	 * for: a green step reports that it happened and nothing else.
	 */
	readonly summary?: string;
}

/**
 * The members of the {@link ActionLogger} service: log groups, buffered steps,
 * notices and source annotations.
 *
 * @public
 */
export interface ActionLoggerShape {
	/**
	 * Run an effect inside a collapsible log group.
	 *
	 * @remarks
	 * The runner cannot nest groups — a second `::group::` implicitly closes the
	 * first — so this is nesting-aware: the outermost call writes the
	 * `::group::` / `::endgroup::` pair, and a call made inside it writes one
	 * `▸ <name>` header line inside the open group instead (line breaks
	 * collapsed to spaces, the text neutralized so it cannot be a command). The
	 * header goes out through `Console` like the group command it replaces, so
	 * it is never captured into, or discarded with, an enclosing `withBuffer`
	 * or `withStep` transcript. A failure at any depth flushes the active
	 * buffer before the group closes. That ordering is visible in a failed
	 * run's log: the replayed transcript lands BELOW every nested header that
	 * was written live, including lines that were logged before the header.
	 *
	 * The depth is fiber-scoped, which leaves four edges:
	 *
	 * 1. **Concurrent sibling groups interleave.** Two top-level groups on
	 *    separate fibers each write a `::group::`, and their output shares one
	 *    log stream; that is the runner's limitation, not one a depth can fix.
	 * 2. **A fiber forked inside a group keeps the depth it was forked at.** A
	 *    `forkChild` joined inside the group nests correctly; a detached fiber
	 *    that outlives the group still writes headers rather than a group.
	 * 3. **Only groups opened here are counted.** A raw
	 *    `WorkflowCommand.group(...)`, a document rendered by `@effected/cli`'s
	 *    `Render.githubLog` with a top-level collapsible, or a consumer's own
	 *    wrapper opens a group this member cannot see, and a group opened
	 *    inside one still nests at the runner.
	 * 4. **The test doubles do not model nesting.** `makeTest`, `layerTest` and
	 *    `layerSilent` pass the effect through unchanged.
	 */
	readonly group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	/**
	 * Run an effect with its verbose output captured and replayed on exit.
	 *
	 * @remarks
	 * Warnings and errors are **not** buffered — they go out as they happen, so a
	 * long step still reports trouble while it is running. Everything at `Info`
	 * and below is held and flushed on every exit path, including a defect or an
	 * interruption, so a clean run still prints its transcript. A step that
	 * should be **quiet** when it succeeds passes
	 * `{ onSuccess: "discard" }` ({@link WithBufferOptions}); failure still
	 * spills the transcript either way.
	 *
	 * Buffering is skipped entirely when the runner has step debugging enabled or
	 * the ambient minimum log level is already `Debug` or lower — someone asking
	 * for verbose output wants it live, and that overrides
	 * `onSuccess: "discard"` too: asking for debug output means wanting to see
	 * what a green step did. Under `Action.run` the two conditions coincide,
	 * because step debugging is what lowers the ambient level to `Debug`; the
	 * step-debug check still stands on its own for a program that opted out
	 * with `stepDebugLogLevel: false` or runs outside `Action.run`.
	 */
	readonly withBuffer: <A, E, R>(
		label: string,
		effect: Effect.Effect<A, E, R>,
		options?: WithBufferOptions,
	) => Effect.Effect<A, E, R>;
	/**
	 * Run a named step: quiet when it succeeds, its full transcript when it does
	 * not.
	 *
	 * @remarks
	 * The composition a release log actually wants, and the one
	 * {@link ActionLoggerShape.withBuffer} alone does not reach. Buffering with
	 * `{ onSuccess: "discard" }` gets a green step to *zero* lines; this trades
	 * that transcript for exactly one:
	 *
	 * 1. verbose output is captured rather than printed live,
	 * 2. on success the transcript is dropped and a single info line — `summary`,
	 *    default `✅ <name>` ({@link WithStepOptions}) — goes out in its place,
	 * 3. on failure a `❌ <name>` header lands **first**, then the transcript
	 *    spills beneath it.
	 *
	 * The ordering in (3) is a property of the **buffered** path. With step
	 * debugging on, nothing is buffered — verbose output has already gone out
	 * live by the time the failure fires — so the header lands *after* the
	 * transcript it would otherwise introduce. That is the honest trade of
	 * asking for live output, not a defect, and both orderings are pinned by
	 * test.
	 *
	 * The header and the summary are the whole difference from `withBuffer`, and
	 * they are why this is a member rather than a documented recipe: `group` +
	 * `withBuffer` looks like complete parity until you notice nothing emits the
	 * success line.
	 *
	 * The summary survives step debugging. Buffering is skipped when the runner
	 * asks for verbose output, but the line naming what succeeded is still the
	 * cheapest thing in the log.
	 */
	readonly withStep: <A, E, R>(
		name: string,
		effect: Effect.Effect<A, E, R>,
		options?: WithStepOptions,
	) => Effect.Effect<A, E, R>;
	/**
	 * Emit a `::notice::` annotation.
	 *
	 * @remarks
	 * A dedicated member rather than a log level, because Effect has no level
	 * between `Info` and `Warn` to map onto notices.
	 */
	readonly notice: (message: string, properties?: AnnotationProperties) => Effect.Effect<void>;
	/**
	 * Attach source annotations to every `Effect.log*` inside an effect.
	 *
	 * @remarks
	 * The point is that a caller never spells an annotation key: the fields go in
	 * as `AnnotationProperties` (from `@effected/github-commands`) and come out as `file=`/`line=` on the
	 * rendered command.
	 */
	readonly annotated: <A, E, R>(
		properties: AnnotationProperties,
		effect: Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E, R>;
}

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;

	const flushActive = Effect.flatMap(ActiveBuffer, (state) => (state === null ? Effect.void : flush(state)));

	const withBuffer = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, options?: WithBufferOptions) =>
		Effect.gen(function* () {
			const minimum = yield* References.MinimumLogLevel;
			const stepDebug = yield* env.isDebug;
			if (stepDebug || LogLevel.isLessThanOrEqualTo(minimum, "Debug")) {
				return yield* effect;
			}

			const state: BufferState = { label, entries: [] };
			const buffering = Logger.make<unknown, void>((options) => {
				if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, "Warn")) {
					commandLogger.log(options);
					return;
				}
				state.entries.push(formatMessage(options.message));
			});

			return yield* effect.pipe(
				// `All` so debug output is captured rather than dropped: the whole
				// point of a buffer is that the verbose transcript exists if the step
				// fails.
				Effect.provideService(References.MinimumLogLevel, "All"),
				Effect.provideService(Logger.CurrentLoggers, new Set([buffering])),
				Effect.provideService(ActiveBuffer, state),
				Effect.onExit((exit) =>
					// Only a SUCCESS is ever discarded: a failure, a defect or an
					// interruption is exactly the moment the transcript was kept for.
					Exit.isSuccess(exit) && options?.onSuccess === "discard" ? discard(state) : flush(state),
				),
			);
		});

	return {
		group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
			Effect.flatMap(GroupDepth, (depth) => {
				// Flush the enclosing buffer before the group closes, so a failed
				// step's transcript lands inside the collapsed section it belongs to
				// rather than after it. At every depth: a flush clears what it wrote,
				// so the outer group's flush after an inner one is a no-op.
				const body = Effect.tapCause(Effect.provideService(effect, GroupDepth, depth + 1), () => flushActive);
				return depth === 0
					? Effect.acquireUseRelease(
							Console.log(WorkflowCommand.group(name)),
							() => body,
							() => Console.log(WorkflowCommand.endGroup()),
						)
					: Effect.andThen(Console.log(nestedHeader(name)), body);
			}),

		withBuffer,

		withStep: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, options?: WithStepOptions) =>
			withBuffer(
				name,
				// Written through `Console` rather than `Effect.logError`, so it lands
				// ahead of the flush instead of into the buffer it is announcing — and
				// so a failed step does not mint a second `::error::` beside the one
				// `Action.run` already renders for the failure itself.
				Effect.tapCause(effect, () => Console.log(CommandNeutralizer.text(`❌ ${name}`))),
				{ onSuccess: "discard" },
			).pipe(
				// Outside the buffered region on purpose: a line emitted inside it is
				// discarded with the transcript it was meant to replace.
				Effect.tap(() => Effect.logInfo(options?.summary ?? `✅ ${name}`)),
			),

		notice: (message: string, properties: AnnotationProperties = {}) =>
			Console.log(WorkflowCommand.notice(message, properties)),

		annotated: <A, E, R>(properties: AnnotationProperties, effect: Effect.Effect<A, E, R>) =>
			Effect.annotateLogs(effect, annotationRecord(properties)),
	} satisfies ActionLoggerShape;
});

/**
 * Groups, buffered step transcripts, notices — and the `Logger` that renders
 * every `Effect.log*` in the kit as a workflow command.
 *
 * @remarks
 * The `Logger` is the seam that lets every other `@effected` package stay
 * telemetry-agnostic: libraries call `Effect.logWarning`, and exactly one
 * logger — installed at the edge by an action — turns those into `::warning::`
 * annotations. No library needs to know it is running inside Actions.
 *
 * @example
 * ```ts
 * import { ActionLogger } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const logger = yield* ActionLogger;
 *   yield* logger.group("install", logger.withBuffer("pnpm", Effect.logInfo("resolving")));
 * });
 * ```
 *
 * @public
 */
export class ActionLogger extends Context.Service<ActionLogger, ActionLoggerShape>()(
	"@effected/github-actions/ActionLogger",
) {
	/**
	 * The service: groups, the buffered step renderer, notices and annotations.
	 *
	 * @remarks
	 * This installs no `Logger`. Without {@link ActionLogger.layerLogger} (or `Action.run`, which installs it) Effect's
	 * default logger writes `Effect.log*` text raw, so a message carrying `::add-mask::` or `##[` is a workflow command
	 * to the runner. Install both: the service for its structure, the logger for its neutralizing of every log line.
	 */
	static readonly layer: Layer.Layer<ActionLogger, never, ActionEnvironment> = Layer.effect(this, make);

	/**
	 * The `Logger` that maps Effect log levels onto workflow commands.
	 *
	 * @remarks
	 * `Error` and `Fatal` render `::error::`, `Warn` renders `::warning::`,
	 * `Debug` and `Trace` render `::debug::`, and `Info` renders as plain text.
	 * Annotations set by `annotated` travel with the entry.
	 *
	 * It writes through core `Console`, which is what makes its output
	 * observable in a test without a runner.
	 */
	static readonly logger: Logger.Logger<unknown, void> = commandLogger;

	/**
	 * {@link ActionLogger.logger} installed as the only logger.
	 *
	 * @remarks
	 * Bound to a constant so every composition site shares one layer;
	 * `ActionRuntime.layer` already includes it.
	 */
	static readonly layerLogger: Layer.Layer<never> = Logger.layer([ActionLogger.logger]);

	/**
	 * A silent double.
	 *
	 * @remarks
	 * **A recorded exception to the die-on-unstubbed rule**, alongside
	 * {@link ActionEnvironment.makeTest}. A logger that dies when a suite logs
	 * would make every double unusable, and silence is the honest default for a
	 * service whose whole job is output. Group and buffer wrappers pass their
	 * effect through unchanged, so the double does not model group nesting:
	 * a test of nested-group output needs the live {@link ActionLogger.layer}.
	 */
	static readonly makeTest = (overrides: Partial<ActionLoggerShape> = {}): ActionLoggerShape => ({
		group: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		withBuffer: <A, E, R>(_label: string, effect: Effect.Effect<A, E, R>) => effect,
		withStep: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		notice: () => Effect.void,
		annotated: <A, E, R>(_properties: AnnotationProperties, effect: Effect.Effect<A, E, R>) => effect,
		...overrides,
	});

	/** {@link ActionLogger.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<ActionLoggerShape> = {}): Layer.Layer<ActionLogger> =>
		Layer.succeed(ActionLogger, ActionLogger.makeTest(overrides));

	/**
	 * A silent service **and** a silent `Effect.log*`.
	 *
	 * @remarks
	 * This one layer stands in for a bare `Effect.provide(Logger.layer([]))`
	 * repeated in every suite just to keep test output quiet. Bound to a
	 * constant rather than exposed as a factory, so composing it twice is free.
	 */
	static readonly layerSilent: Layer.Layer<ActionLogger> = Layer.mergeAll(ActionLogger.layerTest(), Logger.layer([]));
}
