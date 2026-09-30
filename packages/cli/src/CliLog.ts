import { Audience, TerminalEnv } from "@effected/env";
import type { Context, FileSystem } from "effect";
import {
	Cause,
	Config,
	Console,
	Effect,
	Layer,
	LogLevel,
	Logger,
	Option,
	Path as PathModule,
	References,
} from "effect";
import { paintStyle } from "./internal/ansi.js";
import { Level, passes } from "./internal/diagnostics.js";
import { makeFileSink } from "./internal/fileSink.js";
import type { Style } from "./Token.js";

/**
 * Options for {@link CliLog.layer}.
 *
 * @public
 */
export interface CliLogOptions {
	/**
	 * The environment variable that sets the diagnostics level, for example `MYTOOL_LOG_LEVEL`. Read through
	 * `Config`, never `process`. Unset or empty means `None`.
	 */
	readonly envVar?: string | undefined;
	/**
	 * `json` is NDJSON, `pretty` a human line, `auto` (the default) is pretty for a human audience with a
	 * terminal on stderr and NDJSON otherwise.
	 */
	readonly format?: "auto" | "json" | "pretty" | undefined;
}

/** The accepted spellings of a level, lower-cased, to the level they mean. */
const LEVELS: Readonly<Record<string, LogLevel.LogLevel>> = {
	all: "All",
	trace: "Trace",
	debug: "Debug",
	info: "Info",
	warn: "Warn",
	warning: "Warn",
	error: "Error",
	fatal: "Fatal",
	none: "None",
};

const LEVEL_STYLES: Readonly<Record<string, Style>> = {
	FATAL: { fg: "red", bold: true },
	ERROR: { fg: "red" },
	WARN: { fg: "yellow" },
	INFO: { fg: "cyan" },
	DEBUG: { fg: "blue" },
	TRACE: { dim: true },
};

/** Read the diagnostics level from the env var; an invalid value warns once through the existing loggers. */
const readLevel = (envVar: string | undefined): Effect.Effect<LogLevel.LogLevel> =>
	Effect.gen(function* () {
		if (envVar === undefined) return "None";
		const raw = yield* Config.option(Config.String(envVar)).pipe(Effect.orElseSucceed(() => Option.none<string>()));
		if (Option.isNone(raw) || raw.value === "") return "None";
		const level = LEVELS[raw.value.toLowerCase()];
		if (level !== undefined) return level;
		yield* Effect.logWarning(
			`${envVar}=${raw.value} is not a log level (${Object.keys(LEVELS).join("|")}); ignoring it`,
		);
		return "None";
	});

/**
 * Diagnostics kept apart from a program's output: a level, a format and a place to write.
 *
 * @remarks
 * Two kinds of line must never be silenced by a diagnostics default: the failure report
 * `CliRuntime.reportFailures` writes through `CliLogger`, and the `CliMessage` lines. This package therefore
 * never makes the diagnostics level a global switch. The diagnostics logger filters on its **own** threshold,
 * {@link CliLog.Level}, and writes to stderr only.
 *
 * Effect drops a record below `MinimumLogLevel` before any logger runs, so to let a debug record reach the
 * diagnostics logger `MinimumLogLevel` has to be lowered. {@link CliLog.layer} does that only when the
 * diagnostics level is below the ambient minimum, and in the same step wraps every logger already installed so
 * each keeps filtering at the minimum it had. A failure report is written outside the scope core's
 * `--log-level` flag sets, so `--log-level none` does not silence it either.
 *
 * Core's `--log-level` flag sets `MinimumLogLevel` inside the command. While it is set to something other than
 * the value this layer installed, the diagnostics logger follows the flag instead of its own level: it writes
 * every record that reaches it. An existing logger that prints plain text, such as `CliLogger`, prints the same
 * record too, so a record at or above the ambient minimum is written twice, once plain and once to the
 * diagnostics sink.
 *
 * @public
 */
export class CliLog {
	private constructor() {}

	/**
	 * The diagnostics threshold. Defaults to `None`, silent.
	 *
	 * @remarks
	 * {@link CliLog.layer} sets it from the environment variable. A scope may raise it to narrow the output; it
	 * cannot lower it below the level the layer installed, because Effect has already dropped those records.
	 */
	static readonly Level: Context.Reference<LogLevel.LogLevel> = Level;

	/**
	 * A diagnostics logger composed onto the loggers already installed.
	 *
	 * @remarks
	 * Build it over the logger layer it should merge with, for example
	 * `CliLog.layer({ envVar }).pipe(Layer.provide(CliLogger.layer()))`; it reads the installed set when it is
	 * built, so order matters. Bind it to a constant.
	 *
	 * Level parsing is case-insensitive and accepts `warn`, `warning`, `error`, `info`, `debug`, `trace`,
	 * `fatal`, `all` and `none`. An invalid value warns once, through the loggers already installed, and leaves
	 * diagnostics off.
	 *
	 * @param options - the env var and the format
	 */
	static readonly layer = (options: CliLogOptions = {}): Layer.Layer<never, never, Audience | TerminalEnv> =>
		Layer.unwrap(
			Effect.gen(function* () {
				const audience = yield* Audience;
				const terminal = yield* TerminalEnv;
				const level = yield* readLevel(options.envVar);
				const ambient = yield* References.MinimumLogLevel;

				const format = options.format ?? "auto";
				const pretty =
					format === "pretty" || (format === "auto" && audience.kind === "human" && terminal.stderr.isTerminal);
				const color = terminal.stderr.color;

				// Effect filters on MinimumLogLevel before any logger runs: lower it just far enough for the sink.
				const lowered = LogLevel.isLessThan(level, ambient) ? level : ambient;
				const isLowered = lowered !== ambient;

				const render = (record: Logger.Options<unknown>): string => {
					if (!pretty) return Logger.formatJson.log(record);
					const annotations = record.fiber.getRef(References.CurrentLogAnnotations);
					const component = annotations.component === undefined ? "" : ` [${String(annotations.component)}]`;
					const message = Array.isArray(record.message) ? record.message.map(String).join(" ") : String(record.message);
					const name = record.logLevel.toUpperCase();
					const levelText = paintStyle(LEVEL_STYLES[name] ?? {}, color, name);
					const cause = record.cause.reasons.length > 0 ? `\n${Cause.pretty(record.cause)}` : "";
					return `${record.date.toISOString().slice(11, 23)} ${levelText}${component} ${message}${cause}`;
				};

				const sink = Logger.make<unknown, void>((record) => {
					// While core's --log-level flag is in force the sink follows it: an explicit request for that level.
					if (!passes(record, lowered)) return;
					record.fiber.getRef(Console.Console).error(render(record));
				});

				const loggers = Layer.effect(
					Logger.CurrentLoggers,
					Effect.gen(function* () {
						const existing = yield* Logger.CurrentLoggers;
						const kept = isLowered
							? Array.from(existing, (inner) =>
									Logger.make<unknown, void>((record) => {
										const current = record.fiber.getRef(References.MinimumLogLevel);
										const threshold = current === lowered ? ambient : current;
										if (LogLevel.isGreaterThanOrEqualTo(record.logLevel, threshold)) inner.log(record);
									}),
								)
							: Array.from(existing);
						return new Set<Logger.Logger<unknown, unknown>>([...kept, sink]);
					}),
				);

				return Layer.mergeAll(
					Layer.succeed(CliLog.Level, level),
					isLowered ? Layer.succeed(References.MinimumLogLevel, lowered) : Layer.empty,
					loggers,
				);
			}),
		);

	/**
	 * An asynchronous NDJSON file sink, composed onto the loggers already installed.
	 *
	 * @remarks
	 * Each record is written as the same NDJSON line the stderr sink writes, filtered by the same
	 * {@link CliLog.Level}. Lines are queued and appended by a fiber scoped to the layer, so logging never waits
	 * on the disk. The first write error prints exactly one stderr line,
	 * `diagnostics log file <path> failed: <message>; further file logging disabled`, and the program keeps
	 * running with its normal exit code: from then on lines, including any still queued, are discarded silently.
	 * Closing the layer's scope flushes the lines queued before it, unless the sink had disabled itself.
	 *
	 * `{ envVar }` names the variable that holds the file path; unset or empty, no file is written. The parent
	 * directory is created. Build it over {@link CliLog.layer}, which sets the threshold and the minimum log
	 * level the sink relies on, and keep that layer's outputs with `Layer.provideMerge`:
	 * `CliLog.file(o).pipe(Layer.provideMerge(CliLog.layer(p)))`.
	 *
	 * @param options - the path, or the env var that holds it
	 */
	static readonly file = (
		options: { readonly envVar: string } | { readonly path: string },
	): Layer.Layer<never, never, FileSystem.FileSystem | PathModule.Path> =>
		Layer.effect(
			Logger.CurrentLoggers,
			Effect.gen(function* () {
				const existing = yield* Logger.CurrentLoggers;
				const target =
					"path" in options
						? Option.some(options.path)
						: yield* Config.option(Config.String(options.envVar)).pipe(
								Effect.orElseSucceed(() => Option.none<string>()),
							);
				if (Option.isNone(target) || target.value === "") return existing;
				const location = yield* PathModule.Path;
				const installed = yield* References.MinimumLogLevel;
				const sink = yield* makeFileSink(location.resolve(target.value), installed);
				return new Set<Logger.Logger<unknown, unknown>>([...existing, sink]);
			}),
		);

	/**
	 * Mark the log records an effect emits as coming from `name`.
	 *
	 * @remarks
	 * Shown as `[name]` in pretty output and as `annotations.component` in NDJSON.
	 *
	 * @param name - the component
	 */
	static readonly component =
		(name: string) =>
		<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
			Effect.annotateLogs(self, "component", name);
}
