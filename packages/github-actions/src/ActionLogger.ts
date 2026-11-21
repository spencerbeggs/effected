import type { AnnotationProperties } from "@effected/github-commands";
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { Cause, PlatformError } from "effect";
import {
	Cause as CauseModule,
	Clock,
	Console,
	Context,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Inspectable,
	Layer,
	LogLevel,
	Logger,
	References,
	Stream,
} from "effect";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner, CommandLine } from "effect/process";
import { ActionEnvironment } from "./ActionEnvironment.js";
import type { StepFrame, StepOutcome } from "./internal/stepLog.js";
import * as StepLog from "./internal/stepLog.js";

/** How long `command` keeps reading after the child exits. */
const COMMAND_DRAIN = Duration.seconds(10);

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

/**
 * How many log groups are open around the current fiber.
 *
 * @remarks
 * The runner does not nest groups: a second `::group::` implicitly ends the
 * first, leaving an empty outer header and a stray `::endgroup::`. So only
 * depth 0 writes the group commands, and a nested call writes a plain header
 * line instead. Fiber-scoped so that a
 * `Context.Reference` is provided around the body, so it unwinds on every
 * exit path with nothing to restore.
 *
 * Keyed by `WorkflowCommand.groupDepthKey`, the kit-wide key for this count,
 * rather than a key of this package's own: Effect looks a reference up by its
 * key, so `@effected/cli-kit`'s `Render.context`, which builds its own reference
 * from the same key, sees the depth this member provides, and a document it
 * renders inside a group opens no second one.
 *
 * @internal
 */
const GroupDepth = Context.Reference<number>(WorkflowCommand.groupDepthKey, {
	defaultValue: () => 0,
});

const singleLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

/** The `▸ <name>` line a nested group writes in place of a second `::group::`, neutralized because a name is caller text. */
const nestedHeader = (name: string): string => CommandNeutralizer.text(`▸ ${singleLine(name)}`);

/**
 * Options for {@link ActionLoggerShape.step}.
 *
 * @public
 */
export interface StepOptions<A> {
	/**
	 * How long the step may run before its detail streams live instead of folding.
	 *
	 * @remarks
	 * Only the outermost open step's window counts; a step nested inside another ignores its own.
	 */
	readonly window?: Duration.Input;
	/**
	 * The result line's text when the step succeeds, computed from its result.
	 *
	 * @remarks
	 * Defaults to the step's name, which is also the text when the function throws.
	 */
	readonly summary?: (result: A) => string;
	/**
	 * The result line's text when the step fails, computed from its failure.
	 *
	 * @remarks
	 * Replaces both the name and the message. Defaults to `<name> · <message>`, the message being the first line of the
	 * squashed failure's message, which is also the text when the function throws. An interruption always reads
	 * `<name> · interrupted`.
	 */
	readonly failure?: (cause: Cause.Cause<unknown>) => string;
}

/** The first line of a failure's message, for the result line. */
const failureMessage = (cause: Cause.Cause<unknown>): string => {
	const squashed = CauseModule.squash(cause);
	const message =
		squashed instanceof Error
			? squashed.message
			: typeof squashed === "string"
				? squashed
				: Inspectable.toStringUnknown(squashed, 0);
	return message.split(/\r\n|\r|\n/)[0] ?? "";
};

/** A caller's formatter, total: a throw falls back to the default text rather than skipping the step's close. */
const format = <T>(formatter: ((value: T) => string) | undefined, value: T, fallback: () => string): string => {
	if (formatter === undefined) return fallback();
	try {
		return formatter(value);
	} catch {
		return fallback();
	}
};

/**
 * How a step's exit reads on its result line. Total: it runs inside the step's exit handler, where a throw would skip
 * the close and leave a live run streaming.
 */
const stepOutcome = <A, E>(name: string, exit: Exit.Exit<A, E>, options: StepOptions<A> | undefined): StepOutcome => {
	if (Exit.isSuccess(exit)) {
		return { _tag: "Success", text: format(options?.summary, exit.value, () => name) };
	}
	if (CauseModule.hasInterruptsOnly(exit.cause)) {
		return { _tag: "Interrupted" };
	}
	return {
		_tag: "Failure",
		text: format(options?.failure, exit.cause, () => `${name} · ${failureMessage(exit.cause)}`),
	};
};

/**
 * The logger a step runs under: warnings and errors go out live and count against the step and every step around it;
 * everything below `Warn` is the step's detail.
 *
 * @remarks
 * A warning is written through the run's console, the one the step opened under, not the fiber's: inside the step the
 * fiber's console is the capturing one, which would count the annotation a second time.
 */
const stepLogger = (frame: StepFrame): Logger.Logger<unknown, void> =>
	Logger.make((options) => {
		if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, "Warn")) {
			StepLog.countAnnotation(frame, LogLevel.isGreaterThanOrEqualTo(options.logLevel, "Error") ? "error" : "warning");
			frame.run.console.log(renderLogger.log(options));
			return;
		}
		StepLog.detail(frame, formatMessage(options.message));
	});

/**
 * The members of the {@link ActionLogger} service: log groups, phases, steps,
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
	 * header is a line of that step's detail when written inside a
	 * {@link ActionLoggerShape.step}, where the depth is already at least 1, and
	 * goes out through `Console` otherwise.
	 *
	 * The depth is fiber-scoped, which leaves four edges:
	 *
	 * 1. **Concurrent sibling groups interleave.** Two top-level groups on
	 *    separate fibers each write a `::group::`, and their output shares one
	 *    log stream; that is the runner's limitation, not one a depth can fix.
	 * 2. **A fiber forked inside a group keeps the depth it was forked at.** A
	 *    `forkChild` joined inside the group nests correctly; a detached fiber
	 *    that outlives the group still writes headers rather than a group.
	 * 3. **Only a writer that reads the shared depth is counted.** The depth
	 *    lives in the fiber-local keyed by `WorkflowCommand.groupDepthKey`
	 *    (from `@effected/github-commands`), which `@effected/cli-kit` reads too:
	 *    `Render.context` built inside a group carries it as
	 *    `RenderContext.groupDepth`, so `Doc.print` and `Render.githubLog`
	 *    render a top-level collapsible as plain text there rather than as a
	 *    second group. A raw `WorkflowCommand.group(...)`, or a consumer's
	 *    own wrapper that does not read the key, opens a group this member
	 *    cannot see, and a group opened inside one still nests at the runner.
	 * 4. **The test doubles do not model nesting.** `makeTest`, `layerTest` and
	 *    `layerSilent` pass the effect through unchanged.
	 */
	readonly group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	/**
	 * Run an effect under a phase heading: one bold line, never folded.
	 *
	 * @remarks
	 * What a reader scans for. Nothing is written when the phase ends, and the group depth is unchanged, so the steps
	 * inside it fold as top-level steps. Inside a step the heading is a line of that step's detail.
	 */
	readonly phase: <A, E, R>(title: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	/**
	 * Run an effect as a step: its detail held, one result line when it ends.
	 *
	 * @remarks
	 * The detail is every log line below `Warn`, `Debug` and `Trace` included whatever the ambient minimum level, every
	 * line a nested {@link ActionLoggerShape.group} or step writes, and every line written straight to `Console`'s
	 * `log`, `info`, `debug`, `trace`, `warn`, `error` or `dirxml` inside the step (`@effected/cli-kit`'s renderers, a
	 * raw `Console.log`). `Console.table`, `dir`, `count`, the `time*` and the `group*` members are not captured: they
	 * print through at once. A workflow command written to `Console` is not
	 * detail: it goes out at once, so an `::add-mask::` reaches the runner before the secret can appear in any line,
	 * except a group command, which becomes a `▸ <title>` header line. Warnings and errors are never held: they go out
	 * as annotations the moment they happen, and the result line counts them.
	 *
	 * The step's window ({@link StepOptions.window}, 30 seconds by default) is how long the detail is held. A step that
	 * runs past it goes live: it writes `… <name> is taking longer than <window>, showing live output`, everything held
	 * so far, then each detail line as it happens, indented, and finally its result line, unfolded, with the same marks.
	 * A window of zero streams from the start, with the opening line `… <name>`; runner debug (`RUNNER_DEBUG=1`) or an
	 * ambient minimum log level of `Debug` or lower makes every window zero. Only the outermost open step has a window:
	 * an inner step's own is ignored, and when the outer step is live the inner result lines print as they finish.
	 * While two or more steps stream at once, each live detail line is prefixed `[<name>]  ` with its outermost step's
	 * name.
	 *
	 * The result line is `<mark> <summary or name> · <duration>`, the mark `✓` for a success, `⚠` for a success that
	 * logged a warning or an error, or in which a nested step failed and was recovered from (here or in any step
	 * inside it, each counted on the line), and `✗` for a failure ({@link StepOptions}):
	 *
	 * 1. a success with detail is one folded `::group::` titled by the result line, the detail inside it, unless a
	 *    nested step failed, which is never folded away;
	 * 2. a success without detail is the result line alone;
	 * 3. a failure is never folded: the result line, then the detail indented beneath it, then the failure itself
	 *    propagates unchanged. An interruption is written the same way, as `✗ <name> · interrupted`.
	 *
	 * A step inside a step opens no group: its result line, and its detail indented above it, are lines of the
	 * enclosing step's detail. Inside the step the group depth is at least 1, so `group` and `@effected/cli-kit`'s
	 * renderers write plain lines rather than a group the runner cannot nest. A step opened inside a `group` cannot fold
	 * either, and writes its result line with the detail indented beneath it.
	 *
	 * Every line passes through `CommandNeutralizer.text`, so no detail line can be a workflow command. A fiber forked
	 * inside a step that logs after the step has ended is not dropped: its lines print as ordinary log lines, unindented
	 * and unprefixed, and a step it opens is a new outermost step.
	 */
	readonly step: <A, E, R>(
		name: string,
		effect: Effect.Effect<A, E, R>,
		options?: StepOptions<A>,
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

/**
 * One entry of the log {@link ActionLogger.recording} captured: a phase heading, or a step with its detail, outcome and
 * the steps and phases opened inside it.
 *
 * @public
 */
export type StepLogEntry =
	| { readonly kind: "phase"; readonly title: string }
	| {
			readonly kind: "step";
			readonly name: string;
			/** `"warning"` is a success that logged a warning or an error, or in which a nested step failed. */
			readonly outcome: "success" | "warning" | "failure" | "interrupted";
			/** The result line's text, without its mark, counts or duration. */
			readonly summary: string;
			/** The lines logged below `Warn` inside the step, not those of nested steps. */
			readonly detail: ReadonlyArray<string>;
			readonly steps: ReadonlyArray<StepLogEntry>;
	  };

/** A recorded step while it runs: the public shape, mutable. */
interface RecordedStep {
	kind: "step";
	name: string;
	outcome: "success" | "warning" | "failure" | "interrupted";
	summary: string;
	detail: Array<string>;
	steps: Array<StepLogEntry>;
	noisy: boolean;
	parent: RecordedStep | null;
}

/** The recorded step the current fiber is inside, or `null`. */
const RecordingParent = Context.Reference<RecordedStep | null>("@effected/github-actions/RecordingParent", {
	defaultValue: () => null,
});

/** A recorded entry as the public shape, without the bookkeeping, copied so later steps cannot change it. */
const snapshot = (entry: StepLogEntry): StepLogEntry =>
	entry.kind === "phase"
		? { kind: "phase", title: entry.title }
		: {
				kind: "step",
				name: entry.name,
				outcome: entry.outcome,
				summary: entry.summary,
				detail: [...entry.detail],
				steps: entry.steps.map(snapshot),
			};

/** The recording double's members: they record the structure and write nothing. */
const recordingShape = (roots: Array<StepLogEntry>): Pick<ActionLoggerShape, "phase" | "step"> => ({
	phase: <A, E, R>(title: string, effect: Effect.Effect<A, E, R>) =>
		Effect.andThen(
			Effect.flatMap(RecordingParent, (parent) =>
				Effect.sync(() => void (parent === null ? roots : parent.steps).push({ kind: "phase", title })),
			),
			effect,
		),
	step: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, options?: StepOptions<A>) =>
		Effect.flatMap(RecordingParent, (parent) => {
			const node: RecordedStep = {
				kind: "step",
				name,
				outcome: "success",
				summary: name,
				detail: [],
				steps: [],
				noisy: false,
				parent,
			};
			(parent === null ? roots : parent.steps).push(node);
			const logger = Logger.make<unknown, void>((entry) => {
				if (LogLevel.isGreaterThanOrEqualTo(entry.logLevel, "Warn")) {
					for (let current: RecordedStep | null = node; current !== null; current = current.parent) {
						current.noisy = true;
					}
					return;
				}
				node.detail.push(...formatMessage(entry.message).split(/\r\n|\r|\n/));
			});
			return effect.pipe(
				Effect.provideService(References.MinimumLogLevel, "All"),
				Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
				Effect.provideService(RecordingParent, node),
				Effect.onExit((exit) =>
					Effect.sync(() => {
						const outcome = stepOutcome(name, exit, options);
						if (outcome._tag === "Interrupted") {
							node.outcome = "interrupted";
							node.summary = `${name} · interrupted`;
						} else {
							node.summary = outcome.text;
							node.outcome = outcome._tag === "Failure" ? "failure" : node.noisy ? "warning" : "success";
						}
						if (outcome._tag !== "Success") {
							for (let current = parent; current !== null; current = current.parent) {
								current.noisy = true;
							}
						}
					}),
				),
			);
		}),
});

/** A command as one displayable line, secrets redacted. */
const commandLine = (command: ChildProcess.Command): string =>
	command._tag === "StandardCommand"
		? CommandLine.display([command.command, ...command.args])
		: `${commandLine(command.left)} | ${commandLine(command.right)}`;

/** The window a step declares by default. */
const DEFAULT_WINDOW = "30 seconds";

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	/** The runs streaming live, shared by every step this logger opens, for the `[<name>]` prefix. */
	const streaming = new Set<StepLog.StepRun>();

	/** An outermost step's window: zero under runner debug or an ambient `Debug` minimum, else the declared one. */
	const windowFor = (declared: Duration.Input | undefined, minimum: LogLevel.LogLevel) =>
		Effect.gen(function* () {
			const debug = yield* env.isDebug;
			return debug || LogLevel.isLessThanOrEqualTo(minimum, "Debug")
				? Duration.zero
				: Duration.fromInputUnsafe(declared ?? DEFAULT_WINDOW);
		});

	/**
	 * Start an outermost step's window: live at once for a zero window, else a timer that switches it live when the
	 * window passes. The timer is interrupted when the step ends; a timer that fires as the step closes finds the run
	 * closed and does nothing.
	 */
	const armWindow = (frame: StepFrame, declared: Duration.Input | undefined) =>
		Effect.flatMap(windowFor(declared, frame.run.minimum), (window) =>
			Duration.isZero(window)
				? Effect.as(
						Effect.sync(() => StepLog.goLive(frame.run, StepLog.opening(frame.name, undefined))),
						undefined,
					)
				: Effect.forkChild(
						Effect.andThen(
							Effect.sleep(window),
							Effect.sync(() => StepLog.goLive(frame.run, StepLog.opening(frame.name, Duration.format(window)))),
						),
					),
		);

	/** A `▸ <name>` header: a line of the open step's detail, or written out when no step is open. */
	const writeHeader = (name: string) =>
		Effect.flatMap(StepLog.ActiveStep, (frame) =>
			frame === null
				? Console.log(nestedHeader(name))
				: Effect.sync(() => StepLog.detail(frame, `▸ ${singleLine(name)}`)),
		);

	const phase = <A, E, R>(title: string, effect: Effect.Effect<A, E, R>) =>
		Effect.andThen(
			Effect.flatMap(StepLog.ActiveStep, (frame) =>
				frame === null
					? Console.log(CommandNeutralizer.text(StepLog.heading(title)))
					: Effect.sync(() => StepLog.detail(frame, StepLog.heading(title))),
			),
			effect,
		);

	// Uninterruptible from opening the run to installing its close, with only the body restored: an interruption in
	// between would leave a zero-window run streaming with no result line, prefixing every later live step.
	const step = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>, options?: StepOptions<A>) =>
		Effect.uninterruptibleMask((restore) =>
			Effect.gen(function* () {
				const active = yield* StepLog.ActiveStep;
				// A step whose run has closed is no parent: a fiber forked inside it outlived it, and opens a fresh step.
				const parent = active !== null && active.run.mode !== "closed" ? active : null;
				const depth = yield* GroupDepth;
				// The real console: inside a step the fiber's console is the capturing one.
				const console = active === null ? yield* Console.Console : active.run.console;
				const canFold = active === null ? depth === 0 : active.run.canFold;
				const minimum = active === null ? yield* References.MinimumLogLevel : active.run.minimum;
				// Monotonic, so a wall clock stepping back never prints a negative duration.
				const started = yield* Clock.monotonicTimeNanos;
				const frame = StepLog.open(name, parent, console, canFold, streaming, minimum);
				const timer = parent === null ? yield* armWindow(frame, options?.window) : undefined;
				return yield* restore(effect).pipe(
					// `All` so Debug and Trace are detail whatever the ambient level: the git transcript is Debug.
					Effect.provideService(References.MinimumLogLevel, "All"),
					Effect.provideService(Logger.CurrentLoggers, new Set([stepLogger(frame)])),
					Effect.provideService(StepLog.ActiveStep, frame),
					Effect.provideService(GroupDepth, depth + 1),
					Effect.provideService(Console.Console, StepLog.capture(frame)),
					Effect.onExit((exit) =>
						Effect.andThen(
							timer === undefined ? Effect.void : Fiber.interrupt(timer),
							Effect.flatMap(Clock.monotonicTimeNanos, (ended) =>
								Effect.sync(() =>
									StepLog.close(frame, stepOutcome(name, exit, options), Number(ended - started) / 1_000_000),
								),
							),
						),
					),
				);
			}),
		);

	return {
		group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
			Effect.flatMap(GroupDepth, (depth) => {
				const body = Effect.provideService(effect, GroupDepth, depth + 1);
				return depth === 0
					? Effect.acquireUseRelease(
							Console.log(WorkflowCommand.group(name)),
							() => body,
							() => Console.log(WorkflowCommand.endGroup()),
						)
					: Effect.andThen(writeHeader(name), body);
			}),

		phase,

		step,

		notice: (message: string, properties: AnnotationProperties = {}) =>
			Console.log(WorkflowCommand.notice(message, properties)),

		annotated: <A, E, R>(properties: AnnotationProperties, effect: Effect.Effect<A, E, R>) =>
			Effect.annotateLogs(effect, annotationRecord(properties)),
	} satisfies ActionLoggerShape;
});

/**
 * Groups, phases, steps, notices — and the `Logger` that renders
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
 *   yield* logger.phase("Install", logger.step("pnpm", Effect.logInfo("resolving")));
 * });
 * ```
 *
 * @public
 */
export class ActionLogger extends Context.Service<ActionLogger, ActionLoggerShape>()(
	"@effected/github-actions/ActionLogger",
) {
	/**
	 * The service: groups, phases, steps, notices and annotations.
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
	 * service whose whole job is output. Group, phase and step wrappers pass their
	 * effect through unchanged, so the double does not model group nesting or
	 * the step log: a test of that output needs the live {@link ActionLogger.layer}
	 * or {@link ActionLogger.recording}.
	 */
	static readonly makeTest = (overrides: Partial<ActionLoggerShape> = {}): ActionLoggerShape => ({
		group: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		phase: <A, E, R>(_title: string, effect: Effect.Effect<A, E, R>) => effect,
		step: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
		notice: () => Effect.void,
		annotated: <A, E, R>(_properties: AnnotationProperties, effect: Effect.Effect<A, E, R>) => effect,
		...overrides,
	});

	/**
	 * A double that records the step log's structure so a test can assert it.
	 *
	 * @remarks
	 * `entries()` returns the phases and steps opened so far, each step with its detail (every line below `Warn`),
	 * outcome, result text and nested steps. The step log itself writes nothing to the console. A raw `Console` write
	 * inside a recorded step is not detail and still prints, so test `Console` or `@effected/cli-kit` output against
	 * the live layer with `TestConsole`. The other members behave as in {@link ActionLogger.makeTest}.
	 */
	static readonly recording = (): {
		readonly layer: Layer.Layer<ActionLogger>;
		readonly entries: () => ReadonlyArray<StepLogEntry>;
	} => {
		const roots: Array<StepLogEntry> = [];
		return {
			layer: Layer.succeed(ActionLogger, ActionLogger.makeTest(recordingShape(roots))),
			entries: () => roots.map(snapshot),
		};
	};

	/**
	 * Run a child process, writing its command line, its output and its exit code as the current step's detail.
	 *
	 * @remarks
	 * Writes `$ <display>` (the command line, secrets redacted, unless `display` is given), then each stdout and stderr
	 * line as it arrives, then `exit <code>`. Both streams are read concurrently, so a child that fills one pipe cannot
	 * deadlock the other. Every line is detail, so the step's held, live and prefix rules apply; stderr lines are
	 * detail too, not warnings. Outside any step the lines print live. Resolves with the exit code, whatever it is, and
	 * the collected stdout.
	 *
	 * Reading stops 10 seconds after the child exits, as `@actions/exec` does: a background grandchild that inherited
	 * the child's stdout or stderr would otherwise hold the pipe open, and the call with it, for as long as it lives.
	 * What it wrote after that is not read.
	 *
	 * Stdout is decoded as UTF-8 text and logged line by line, so this suits a child whose stdout is text; a binary
	 * stdout needs the raw `ChildProcessSpawner` handle.
	 *
	 * Fails with `PlatformError` when the spawn fails, or when reading the child's output or its exit status fails after
	 * it started. A non-zero exit is never an error.
	 */
	static readonly command = (
		command: ChildProcess.Command,
		options?: { readonly display?: string },
	): Effect.Effect<
		{ readonly exitCode: number; readonly stdout: string },
		PlatformError.PlatformError,
		ChildProcessSpawner.ChildProcessSpawner
	> =>
		Effect.scoped(
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				yield* Effect.logInfo(`$ ${options?.display ?? commandLine(command)}`);
				const handle = yield* spawner.spawn(command);
				let stdout = "";
				const logLines = (stream: Stream.Stream<string, PlatformError.PlatformError>) =>
					stream.pipe(
						Stream.splitLines,
						Stream.runForEach((line) => Effect.logInfo(line)),
					);
				const exited = yield* Deferred.make<void>();
				const readers = Effect.all(
					[
						logLines(
							Stream.decodeText(handle.stdout).pipe(
								Stream.tap((chunk) =>
									Effect.sync(() => {
										stdout += chunk;
									}),
								),
							),
						),
						logLines(Stream.decodeText(handle.stderr)),
					],
					{ concurrency: "unbounded" },
				);
				// A grandchild that inherited the pipes can hold them open after the child exits: stop reading once the
				// drain bound passes after the exit, as `@actions/exec` does.
				const [, code] = yield* Effect.all(
					[
						Effect.raceFirst(readers, Effect.andThen(Deferred.await(exited), Effect.sleep(COMMAND_DRAIN))),
						Effect.tap(handle.exitCode, () => Deferred.succeed(exited, undefined)),
					],
					{ concurrency: "unbounded" },
				);
				const exitCode = Number(code);
				yield* Effect.logInfo(`exit ${exitCode}`);
				return { exitCode, stdout };
			}),
		);

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
