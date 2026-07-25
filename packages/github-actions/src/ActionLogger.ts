import { Console, Context, Effect, Inspectable, Layer, LogLevel, Logger, References } from "effect";
import { ActionEnvironment } from "./ActionEnvironment.js";
import type { AnnotationProperties } from "./WorkflowCommand.js";
import { WorkflowCommand } from "./WorkflowCommand.js";

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

/** The inverse: annotation fields as a record `Effect.annotateLogs` accepts. */
const annotationRecord = (properties: AnnotationProperties): Record<string, unknown> => ({
	...(properties.title === undefined ? {} : { title: properties.title }),
	...(properties.file === undefined ? {} : { file: properties.file }),
	...(properties.startLine === undefined ? {} : { startLine: properties.startLine }),
	...(properties.endLine === undefined ? {} : { endLine: properties.endLine }),
	...(properties.startColumn === undefined ? {} : { startColumn: properties.startColumn }),
	...(properties.endColumn === undefined ? {} : { endColumn: properties.endColumn }),
});

/**
 * Map one log entry onto the line the runner should see.
 *
 * @remarks
 * `Info` is deliberately plain text with no command prefix — it is ordinary
 * step output, and prefixing it would make every informational line an
 * annotation in the workflow summary.
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
	return LogLevel.isGreaterThanOrEqualTo(level, "Info") ? text : WorkflowCommand.debug(text);
};

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
		return Effect.forEach(body, (line) => Console.log(line), { discard: true });
	});

/**
 * The {@link ActionLogger} service shape.
 *
 * @public
 */
export interface ActionLoggerShape {
	/** Run an effect inside a collapsible log group. */
	readonly group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	/**
	 * Run an effect with its verbose output captured and replayed on exit.
	 *
	 * @remarks
	 * Warnings and errors are **not** buffered — they go out as they happen, so a
	 * long step still reports trouble while it is running. Everything at `Info`
	 * and below is held and flushed on every exit path, including a defect or an
	 * interruption, so a clean run still prints its transcript.
	 *
	 * Buffering is skipped entirely when the runner has step debugging enabled or
	 * the ambient minimum log level is already `Debug` or lower — someone asking
	 * for verbose output wants it live.
	 */
	readonly withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
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
	 * as {@link AnnotationProperties} and come out as `file=`/`line=` on the
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

	return {
		group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
			Effect.acquireUseRelease(
				Console.log(WorkflowCommand.group(name)),
				() =>
					// Flush the enclosing buffer before the group closes, so a failed
					// step's transcript lands inside the collapsed section it belongs to
					// rather than after it.
					Effect.tapCause(effect, () => flushActive),
				() => Console.log(WorkflowCommand.endGroup()),
			),

		withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const minimum = yield* References.MinimumLogLevel;
				const stepDebug = yield* env.isDebug;
				if (stepDebug || LogLevel.isLessThanOrEqualTo(minimum, "Debug")) {
					return yield* effect;
				}

				const state: BufferState = { label, entries: [] };
				const buffering = Logger.make<unknown, void>((options) => {
					if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, "Warn")) {
						const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
						options.fiber.getRef(Console.Console).log(renderEntry(options.logLevel, options.message, annotations));
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
					Effect.onExit(() => flush(state)),
				);
			}),

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
	static readonly logger: Logger.Logger<unknown, void> = Logger.make((options) => {
		const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
		options.fiber.getRef(Console.Console).log(renderEntry(options.logLevel, options.message, annotations));
	});

	/** {@link ActionLogger.logger} installed as the only logger. */
	static readonly layerLogger: Layer.Layer<never> = Logger.layer([ActionLogger.logger]);

	/**
	 * A silent double.
	 *
	 * @remarks
	 * **A recorded exception to the die-on-unstubbed rule**, alongside
	 * {@link ActionEnvironment.makeTest}. A logger that dies when a suite logs
	 * would make every double unusable, and silence is the honest default for a
	 * service whose whole job is output. Group and buffer wrappers pass their
	 * effect through unchanged.
	 */
	static readonly makeTest = (overrides: Partial<ActionLoggerShape> = {}): ActionLoggerShape => ({
		group: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		withBuffer: <A, E, R>(_label: string, effect: Effect.Effect<A, E, R>) => effect,
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
	 * This one layer replaces the bare `Effect.provide(Logger.layer([]))` that
	 * appeared thirteen times in one consuming action and twenty-three in
	 * another, purely to keep test output quiet. Bound to a constant rather than
	 * exposed as a factory, so composing it twice is free.
	 */
	static readonly layerSilent: Layer.Layer<ActionLogger> = Layer.mergeAll(ActionLogger.layerTest(), Logger.layer([]));
}
