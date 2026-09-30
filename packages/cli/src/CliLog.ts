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
import type { CliLoggerOptions } from "./CliLogger.js";
import { CliLogger } from "./CliLogger.js";
import { paintStyle } from "./internal/ansi.js";
import { Level, passes } from "./internal/diagnostics.js";
import { makeFileSink } from "./internal/fileSink.js";
import type { Style } from "./Token.js";

/**
 * Options for `CliLog.layer`.
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
	/** Options for the `CliLogger` this layer builds for ordinary log lines; see {@link CliLoggerOptions}. */
	readonly logger?: CliLoggerOptions | undefined;
	/**
	 * Loggers to keep beside the `CliLogger` and the sink, for example a telemetry logger: the layer owns the
	 * whole set, so anything not listed here is dropped.
	 *
	 * @remarks
	 * Each is floored at the `MinimumLogLevel` it had, like the `CliLogger`, so lowering the level for the
	 * diagnostics sink never makes it see records it would not have seen otherwise.
	 */
	readonly extraLoggers?: ReadonlyArray<Logger.Logger<unknown, unknown>> | undefined;
}

/**
 * Where the file sink writes: a literal path, or the environment variable that holds it.
 *
 * @public
 */
export type CliLogFile = { readonly envVar: string } | { readonly path: string };

/**
 * {@link CliLogOptions} with a file sink, which is what makes the layer require `FileSystem` and `Path`.
 *
 * @public
 */
export interface CliLogFileOptions extends CliLogOptions {
	/**
	 * Also write every record the sink accepts to a file as NDJSON, asynchronously.
	 *
	 * @remarks
	 * The line is identical to the stderr NDJSON line for the same log call and is filtered by the same
	 * {@link CliLog.Level}. Lines are queued and appended by a fiber scoped to the layer, so logging never waits
	 * on the disk, and the parent directory is created. The first write error prints exactly one stderr line,
	 * `diagnostics log file <path> failed: <message>; further file logging disabled`, and the program keeps
	 * running with its normal exit code: from then on lines, including any still queued, are discarded silently.
	 * Closing the layer's scope flushes the lines queued before it, unless the sink had already disabled itself.
	 * `{ envVar }` names the variable that holds the path; unset or empty, no file is written.
	 */
	readonly file: CliLogFile;
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

/** The diagnostics level from the env var, and the raw text when it is not a level. */
const readLevel = (
	envVar: string | undefined,
): Effect.Effect<{ readonly level: LogLevel.LogLevel; readonly invalid: string | undefined }> =>
	Effect.gen(function* () {
		if (envVar === undefined) return { level: "None", invalid: undefined };
		const raw = yield* Config.option(Config.String(envVar)).pipe(Effect.orElseSucceed(() => Option.none<string>()));
		if (Option.isNone(raw) || raw.value === "") return { level: "None", invalid: undefined };
		const level = LEVELS[raw.value.toLowerCase()];
		if (level !== undefined) return { level, invalid: undefined };
		return {
			level: "None",
			invalid: `${envVar}=${raw.value} is not a log level (${Object.keys(LEVELS).join("|")}); ignoring it`,
		};
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
 * `CliLog.layer` **owns the whole logger set**. It builds a `CliLogger` for ordinary log lines and the
 * diagnostics sink itself and replaces whatever was installed, without reading it, so there is no order to get
 * wrong. Use it instead of `CliLogger.layer`, not with it: `CliLogger.layer` alone is the no-diagnostics path,
 * and a `CliLogger.layer` layered on top would replace this layer's set.
 *
 * Effect drops a record below `MinimumLogLevel` before any logger runs, so to let a debug record reach the
 * diagnostics logger `MinimumLogLevel` has to be lowered. `CliLog.layer` does that only when the
 * diagnostics level is below the ambient minimum, and in the same step floors the `CliLogger` it built at the
 * minimum it had, so it never prints a record the diagnostics level alone let through. A failure report is
 * written outside the scope core's `--log-level` flag sets, so `--log-level none` does not silence it either.
 *
 * Core's `--log-level` flag sets `MinimumLogLevel` inside the command. While it is set to something other than
 * the value this layer installed, the diagnostics logger follows the flag instead of its own level: it writes
 * every record that reaches it. The `CliLogger` prints the same record too, so a record at or above the ambient
 * minimum is written twice, once plain and once to the diagnostics sink. Stderr is therefore not pure NDJSON while
 * diagnostics are on: a parser reads the lines that start with `{`.
 *
 * @public
 */
export class CliLog {
	private constructor() {}

	/**
	 * The diagnostics threshold. Defaults to `None`, silent.
	 *
	 * @remarks
	 * `CliLog.layer` sets it from the environment variable. A scope may raise it to narrow the output; it
	 * cannot lower it below the level the layer installed, because Effect has already dropped those records.
	 */
	static readonly Level: Context.Reference<LogLevel.LogLevel> = Level;

	/**
	 * The whole logger set of a program: a `CliLogger` for ordinary lines plus the diagnostics sink.
	 *
	 * @remarks
	 * Replaces the installed loggers without reading them. Provide it on the program you pass to
	 * `CliRuntime.main`, or use `main`'s `env.log` option; never wrap it around `main`, whose own logger would
	 * replace this one. Bind it to a constant.
	 *
	 * Level parsing is case-insensitive and accepts `warn`, `warning`, `error`, `info`, `debug`, `trace`,
	 * `fatal`, `all` and `none`. An invalid value warns once, through the `CliLogger`, and leaves diagnostics
	 * off.
	 *
	 * With a `file` option ({@link CliLogFileOptions}) the layer also writes an async NDJSON file, and only then
	 * does it require `FileSystem` and `Path`: the two overloads keep a file-less program free of them.
	 *
	 * @param options - the env var, the format, the `CliLogger` options and the optional file sink
	 */
	static layer(
		options?: CliLogOptions & { readonly file?: undefined },
	): Layer.Layer<never, never, Audience | TerminalEnv>;
	static layer(
		options: CliLogFileOptions,
	): Layer.Layer<never, never, Audience | TerminalEnv | FileSystem.FileSystem | PathModule.Path>;
	static layer(
		options: CliLogOptions | CliLogFileOptions = {},
	): Layer.Layer<never, never, Audience | TerminalEnv | FileSystem.FileSystem | PathModule.Path> {
		const file = "file" in options ? options.file : undefined;
		return Layer.unwrap(
			Effect.gen(function* () {
				const audience = yield* Audience;
				const terminal = yield* TerminalEnv;
				const { level, invalid } = yield* readLevel(options.envVar);
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

				// Every ordinary logger keeps filtering at the minimum it had, however far MinimumLogLevel was lowered.
				const floor = (inner: Logger.Logger<unknown, unknown>): Logger.Logger<unknown, unknown> =>
					isLowered
						? Logger.make<unknown, unknown>((record) => {
								const current = record.fiber.getRef(References.MinimumLogLevel);
								const threshold = current === lowered ? ambient : current;
								if (LogLevel.isGreaterThanOrEqualTo(record.logLevel, threshold)) inner.log(record);
							})
						: inner;
				const cliLogger = floor(CliLogger.make(options.logger));
				const extras = (options.extraLoggers ?? []).map(floor);

				// An invalid level warns through the CliLogger only, never through the sink.
				if (invalid !== undefined) {
					yield* Effect.logWarning(invalid).pipe(
						Effect.provideService(Logger.CurrentLoggers, new Set<Logger.Logger<unknown, unknown>>([cliLogger])),
					);
				}

				return Layer.mergeAll(
					Layer.succeed(CliLog.Level, level),
					isLowered ? Layer.succeed(References.MinimumLogLevel, lowered) : Layer.empty,
					Layer.effect(
						Logger.CurrentLoggers,
						Effect.gen(function* () {
							const loggers: Array<Logger.Logger<unknown, unknown>> = [cliLogger, sink, ...extras];
							if (file !== undefined) {
								const target =
									"path" in file
										? Option.some(file.path)
										: yield* Config.option(Config.String(file.envVar)).pipe(
												Effect.orElseSucceed(() => Option.none<string>()),
											);
								if (Option.isSome(target) && target.value !== "") {
									const location = yield* PathModule.Path;
									loggers.push(yield* makeFileSink(location.resolve(target.value), lowered));
								}
							}
							return new Set(loggers);
						}),
					),
				);
			}),
		);
	}

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
