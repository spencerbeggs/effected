import type { Layer } from "effect";
import { Console, LogLevel, Logger, References } from "effect";

/**
 * How a log record is turned into a line.
 *
 * @public
 */
export interface CliLoggerOptions {
	/**
	 * Render one message. Defaults to joining an array with spaces and
	 * `String`-ing anything else.
	 *
	 * @remarks
	 * An array arrives because `Effect.log("synced", 3, "repos")` is variadic.
	 */
	readonly render?: ((message: unknown) => string) | undefined;
	/**
	 * The level at and above which output goes to stderr. Defaults to `"Error"`,
	 * so `Error` and `Fatal` are diagnostics and everything else is output.
	 */
	readonly stderrFrom?: LogLevel.LogLevel | undefined;
}

const defaultRender = (message: unknown): string =>
	Array.isArray(message) ? message.map(String).join(" ") : String(message);

/**
 * A `Logger` that renders CLI output rather than service logs.
 *
 * @remarks
 * Effect's default logger emits `[00:33:56.619] INFO (#2): message`. That is
 * the right shape for a long-running service being scraped and the wrong one
 * for a tool a person is watching: the timestamp, level and fiber id are noise
 * in front of output a human is reading, and they make a formatted block — a
 * permissions table, a summary — unreadable.
 *
 * **This is not a preference, and it is not visible from the call site.** A
 * program that never installs a CLI logger looks correct in review and ships
 * timestamps to its users; the consumer this package was extracted from had it
 * missing for a day while its own docs claimed it existed.
 *
 * ## Why the `Console` reference, and not `Stdio`
 *
 * The obvious design — write through `Stdio`'s `stdout()` / `stderr()` sinks —
 * does not fit. `Logger.make` takes a **synchronous** callback and a `Sink`
 * write is an `Effect`: a logger cannot `yield*`.
 *
 * Writing to `process.stdout` would fit, and is what the consumer did first,
 * but it drags a platform assumption into a library and — the part that
 * actually matters — makes the stream split **untestable**, because asserting
 * it means monkey-patching a global inside a runner that is itself writing to
 * those streams.
 *
 * So this takes the path core's own `defaultLogger` takes: read the `Console`
 * off the fiber, synchronously. `Console.Console` is a public
 * `Context.Reference`, so it carries a default and never appears in `R`, and a
 * test swaps the reference instead of stubbing a global.
 *
 * @example
 * ```ts
 * import { CliLogger } from "@effected/cli"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function* () {
 *   yield* Effect.log("synced 3 repos")   // stdout, no timestamp
 *   yield* Effect.logError("one failed")  // stderr
 * })
 *
 * program.pipe(Effect.provide(CliLogger.layer()))
 * ```
 *
 * @public
 */
export class CliLogger {
	private constructor() {}

	/**
	 * The logger itself, for composing into an existing `Logger.layer` set.
	 *
	 * @remarks
	 * Prefer {@link CliLogger.layer}. Reach for this only when you are building
	 * the logger set yourself and want this one among several.
	 */
	static readonly make = (options: CliLoggerOptions = {}): Logger.Logger<unknown, void> => {
		const render = options.render ?? defaultRender;
		const stderrFrom = options.stderrFrom ?? "Error";

		return Logger.make<unknown, void>(({ fiber, logLevel, message }) => {
			const console = fiber.getRef(Console.Console);

			// `LogToStderr` is core's own reference and its own loggers honour it, so
			// ignoring it here would make this logger surprising in a way nothing
			// signals. It is an override in ONE direction: a consumer who sets it
			// meant "this program's output is diagnostic". It must never be able to
			// move an error back onto stdout — that is the one guarantee this logger
			// exists to make, and a reference should not be able to revoke it.
			const forced = fiber.getRef(References.LogToStderr);

			// The level ordinal rises with severity, so this catches the named level
			// and everything above it — including any level added later, which a
			// `logLevel === "Error" || logLevel === "Fatal"` test would miss.
			const diagnostic = forced || LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom);

			// `console.log`/`console.error` supply their own newline, which is why
			// nothing here appends one.
			const write = diagnostic ? console.error : console.log;
			write(render(message));
		});
	};

	/**
	 * Replace the default logger with this one.
	 *
	 * @remarks
	 * `Logger.layer` **replaces** rather than merges, so nothing is emitted twice.
	 *
	 * Merge this into the layer you provide to the whole program rather than
	 * providing it beneath: merged, it also covers lines emitted during layer
	 * construction, which is exactly where a startup failure prints.
	 */
	static readonly layer = (options: CliLoggerOptions = {}): Layer.Layer<never> =>
		Logger.layer([CliLogger.make(options)]);
}
