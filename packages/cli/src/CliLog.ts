import { Audience, TerminalEnv } from "@effected/env";
import type { FileSystem } from "effect";
import {
	Cause,
	Config,
	Console,
	Context,
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
	 * The diagnostics level, for a host that has already decided it.
	 *
	 * @remarks
	 * Beats `envVar`, which is then not read at all (so a bad value there neither warns nor overrides this), and
	 * loses to core's `--log-level` flag like every diagnostics level: the sink follows the flag while it is set.
	 */
	readonly level?: LogLevel.LogLevel | undefined;
	/**
	 * The environment variable that sets the diagnostics level, for example `MYTOOL_LOG_LEVEL`. Read through
	 * `Config`, never `process`. Unset or empty means `None`. Ignored when `level` is given.
	 */
	readonly envVar?: string | undefined;
	/**
	 * Whether to install the plain `CliLogger` for ordinary lines. `true` by default.
	 *
	 * @remarks
	 * `false` is the diagnostics-only mode for a library host (an MCP server, a test reporter): the layer installs
	 * only the diagnostics sink, the file sink if any, and `extraLoggers`. With no level set as well, stderr gets
	 * no output. An invalid level in `envVar` still prints its one warning line, through a private `CliLogger`,
	 * since that is a configuration error the host should see.
	 */
	readonly plainLogger?: boolean | undefined;
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

/** The diagnostics level: the option when given, else the env var, and the raw text when that is not a level. */
const readLevel = (
	explicit: LogLevel.LogLevel | undefined,
	envVar: string | undefined,
): Effect.Effect<{ readonly level: LogLevel.LogLevel; readonly invalid: string | undefined }> =>
	Effect.gen(function* () {
		if (explicit !== undefined) return { level: explicit, invalid: undefined };
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
 * One edge: a `--log-level` value that EQUALS the level this layer installed cannot be told from no flag, so the
 * sink keeps filtering on its own level rather than following the flag. The plain `CliLogger` prints those records
 * regardless.
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
	 * The requirements follow the format. `format: "json"` reads neither the audience nor the terminal, so it
	 * requires neither; `"pretty"` requires `TerminalEnv` alone, for the stderr colour; `"auto"` and an omitted
	 * format require both. A long-lived host that never builds a platform `Terminal` can provide
	 * `TerminalEnv.layerStdio()` for the pretty case.
	 *
	 * A platform or program that installs its own `Logger.layer([...])` replaces this set: do not. The diagnostics
	 * then go silent with no error.
	 *
	 * The NDJSON line is core's `Logger.formatJson`, unchanged so it stays interoperable with Effect tooling: the
	 * `message` field is a string for one log argument and an array for several.
	 *
	 * Level parsing is case-insensitive and accepts `warn`, `warning`, `error`, `info`, `debug`, `trace`,
	 * `fatal`, `all` and `none`. An invalid value warns once, through the `CliLogger`, and leaves diagnostics
	 * off.
	 *
	 * With a `file` option ({@link CliLogFileOptions}) the layer also writes an async NDJSON file, and only then
	 * does it require `FileSystem` and `Path`, and it leaves them in `R` unprovided: the platform supplies them, or
	 * a test supplies a memory filesystem, so a host never provides Node inside its own layer.
	 *
	 * @param options - the level, the env var, the format, the `CliLogger` options and the optional file sink
	 */
	static layer(
		options: CliLogOptions & { readonly format: "json"; readonly file?: undefined },
	): Layer.Layer<never, never, never>;
	static layer(
		options: CliLogFileOptions & { readonly format: "json" },
	): Layer.Layer<never, never, FileSystem.FileSystem | PathModule.Path>;
	static layer(
		options: CliLogOptions & { readonly format: "pretty"; readonly file?: undefined },
	): Layer.Layer<never, never, TerminalEnv>;
	static layer(
		options: CliLogFileOptions & { readonly format: "pretty" },
	): Layer.Layer<never, never, TerminalEnv | FileSystem.FileSystem | PathModule.Path>;
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
		const format = options.format ?? "auto";
		return Layer.unwrap(
			Effect.gen(function* () {
				// Read only what the format needs, so a fixed format never requires the rest (the overloads say so).
				const audience = format === "auto" ? yield* Audience : undefined;
				const terminal = format === "json" ? undefined : yield* TerminalEnv;
				const { level, invalid } = yield* readLevel(options.level, options.envVar);
				const ambient = yield* References.MinimumLogLevel;

				const color = terminal?.stderr.color ?? "none";
				// Decided per record, not once at build: the logger is built outermost, before an audience flag is read,
				// so the format follows the `Audience` in force in the fiber that logs (`CliAudience.run` provides it
				// around the whole run; `Fiber.context` is `Fiber.ts:77`), falling back to the one the layer was built with.
				const isPretty = (record: Logger.Options<unknown>): boolean => {
					if (format !== "auto") return format === "pretty";
					const inForce = Context.getOption(record.fiber.context, Audience);
					const kind = Option.isSome(inForce) ? inForce.value.kind : audience?.kind;
					return kind === "human" && terminal?.stderr.isTerminal === true;
				};

				// Effect filters on MinimumLogLevel before any logger runs: lower it just far enough for the sink.
				const lowered = LogLevel.isLessThan(level, ambient) ? level : ambient;
				const isLowered = lowered !== ambient;

				const render = (record: Logger.Options<unknown>): string => {
					if (!isPretty(record)) return Logger.formatJson.log(record);
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
							const loggers: Array<Logger.Logger<unknown, unknown>> = [
								...(options.plainLogger === false ? [] : [cliLogger]),
								sink,
								...extras,
							];
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
