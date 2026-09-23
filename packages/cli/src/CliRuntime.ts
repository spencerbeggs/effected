import type { Layer } from "effect";
import { Cause, Effect, MutableRef, Runtime } from "effect";
import { CliError } from "effect/unstable/cli";
import { CliExit } from "./CliExit.js";
import { CliLogger } from "./CliLogger.js";
import { ExitRequested } from "./internal/ExitRequested.js";
import { isExitCode } from "./internal/isExitCode.js";

const isShowHelp = (u: unknown): u is CliError.ShowHelp => CliError.isCliError(u) && u._tag === "ShowHelp";

/** A `UserError` `Command.runWith` already printed: it sets the mark to `false` after rendering. */
const isRenderedUserError = (u: unknown): u is CliError.UserError =>
	CliError.isCliError(u) && u._tag === "UserError" && Runtime.getErrorReported(u) === false;

/**
 * How a failure is turned into output and an exit code.
 *
 * @public
 */
export interface ReportFailuresOptions {
	/**
	 * Render the failure. Defaults to `String(error)`, one line.
	 *
	 * @remarks
	 * Return several lines to print several: a config error's own message
	 * followed by the rendered issue lines, say.
	 */
	readonly render?: ((error: unknown) => string | ReadonlyArray<string>) | undefined;
	/**
	 * The exit code to use when the error does not carry one.
	 *
	 * @remarks
	 * An error carrying `Runtime.errorExitCode` keeps its own; this is only the
	 * fallback, and it defaults to `1`. Pass an integer in `0..255`, the range a
	 * POSIX exit status can carry — `256` wraps to `0` and passes a failed run.
	 */
	readonly exitCode?: number | undefined;
	/**
	 * The exit code for a usage error: a `ShowHelp` carrying parse errors, or a
	 * `CliError.UserError` `Command.runWith` already printed.
	 *
	 * @remarks
	 * Defaults to `64` (BSD `EX_USAGE`); pass an integer in `0..255`. A
	 * `ShowHelp` with no errors — a bare root invocation, or `--help` — always
	 * exits `0`.
	 *
	 * Keep `Command.runWith`'s default `renderErrors`: with `renderErrors: false`
	 * runWith prints no parse errors and `reportFailures` never renders a
	 * `ShowHelp`, so a parse error would exit with this code having printed
	 * nothing on stderr.
	 */
	readonly usageExitCode?: number | undefined;
}

/**
 * Options for {@link CliRuntime.main}.
 *
 * @public
 */
export interface MainOptions<RP, EP> extends ReportFailuresOptions {
	/**
	 * The platform layer, usually `NodeServices.layer` or an app platform built
	 * on it. Passed in so this package never imports a platform.
	 */
	readonly platform: Layer.Layer<RP, EP>;
	/** The logger, provided outermost. Defaults to `CliLogger.layer()`. */
	readonly logger?: Layer.Layer<never> | undefined;
}

const toLines = (rendered: string | ReadonlyArray<string>): ReadonlyArray<string> =>
	typeof rendered === "string" ? [rendered] : rendered;

/**
 * The error's own exit code when it carries one, otherwise the fallback.
 *
 * @remarks
 * `Runtime.getErrorExitCode` cannot serve alone here: it answers `1` both for
 * an error marked `1` and for an unmarked one, so an `exitCode` option would
 * silently override a deliberate `1`. Testing for the marker keeps "the error
 * chose its code" distinct from "nothing chose".
 */
const chooseExitCode = (error: unknown, fallback: number | undefined): number =>
	typeof error === "object" && error !== null && Runtime.errorExitCode in error
		? Runtime.getErrorExitCode(error)
		: (fallback ?? 1);

/**
 * Report a CLI program's failures through the program's own logger.
 *
 * @remarks
 * ## The bug this exists to prevent
 *
 * A platform `runMain` reports an unhandled failure using Effect's **default**
 * logger. That logger sits **outside** the layers the program was provided —
 * `makeRunMain` composes its reporting `tapCause` around the already-provided
 * effect — so a program that carefully installs {@link CliLogger} still prints
 * its failures in the structured format that logger exists to replace, and
 * prints them on **stdout**, the one stream errors must not use.
 *
 * Nothing about the call site suggests this. The program looks correct, the
 * logger is installed, every success path is right, and only a failure reveals
 * it.
 *
 * ## Why a combinator, and not a `runMain`
 *
 * The fix has to happen **inside** the effect, before any `runMain` sees it. So
 * this is a combinator you apply to your program, and you still call your own
 * platform's runner:
 *
 * @example
 * ```ts
 * import { CliRuntime } from "@effected/cli"
 * import { NodeRuntime } from "@effect/platform-node"
 * import { Effect } from "effect"
 *
 * NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)))
 * ```
 *
 * Wrapping `runMain` itself would drag a platform choice into a library that
 * has no business making one, and would make this package unusable from Bun or
 * Deno for no gain.
 *
 * ## What it does with the failure
 *
 * Renders it through the ambient logger, then **re-fails with a marked error**
 * so the runtime still sees a failure — the exit code is the runtime's to set,
 * and swallowing the failure would make a broken run exit `0`.
 *
 * The marks are core's own, and they are what make this work without a platform
 * import:
 *
 * - `Runtime.errorExitCode` — `defaultTeardown` takes the squashed error's
 *   value as the process exit code. An error that already carries one **keeps
 *   it**: that was a deliberate choice by whatever raised it, and flattening
 *   every failure to a single code would discard it.
 * - `Runtime.errorReported` — set to `false`, which suppresses the runtime's own
 *   duplicate report. **The polarity is inverted relative to the name**: the
 *   marker means "should this be reported", so the intuitive
 *   `errorReported: true` — "I have reported it, stay quiet" — produces exactly
 *   the double report it was meant to prevent.
 *
 * An **interrupt is left alone**: it is not a failure to report, and the
 * default teardown already maps an interrupt-only cause to `130`.
 *
 * A `CliError.ShowHelp` is never rendered: `Command.runWith` already printed
 * the help text (and any parse errors) before re-failing with it, so
 * rendering it again would print nothing but a stray "Help requested" line.
 * A `ShowHelp` carrying errors is remapped to `usageExitCode` (default `64`,
 * BSD `EX_USAGE`); a bare `--help` or root invocation — `errors` empty —
 * keeps exit `0`. A `CliError.UserError` is likewise skipped when
 * `Command.runWith` already rendered it through its `CliOutput` formatter
 * (runWith flips its `Runtime.errorReported` mark to `false` after printing)
 * and exits with `usageExitCode`; under runWith's `renderErrors: false` the
 * mark stays set, and it renders here like any other failure. Every other
 * error renders even when it already carries the reported mark — a gate
 * failure marked with `CliRuntime.reported` still prints its line. The
 * private `ExitRequested` sentinel `CliRuntime.main`
 * raises is likewise never rendered; it only carries the exit code a
 * successful program recorded through `CliExit`.
 *
 * @public
 */
export class CliRuntime {
	private constructor() {}

	/**
	 * Catch, render through the ambient logger, and re-fail with the exit code
	 * and the no-double-report mark.
	 */
	static readonly reportFailures =
		(options: ReportFailuresOptions = {}) =>
		<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Error, R> =>
			effect.pipe(
				Effect.catchCause((cause: Cause.Cause<E>): Effect.Effect<A, Error> => {
					// An interrupt is not a failure anyone wants rendered, and the default
					// teardown already maps an interrupt-only cause to 130.
					if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause as Cause.Cause<never>);

					const error = Cause.squash(cause);

					// Already marked by CliRuntime.main; there is nothing to render.
					if (error instanceof ExitRequested) return Effect.fail(error);

					// Command.runWith printed help (stdout) and any parse errors (stderr)
					// BEFORE re-failing with ShowHelp. Rendering it again prints a stray
					// "Help requested" line.
					if (isShowHelp(error)) {
						const code = error.errors.length > 0 ? (options.usageExitCode ?? 64) : 0;
						return Effect.fail(CliRuntime.reported(error, code));
					}

					// Command.runWith rendered a UserError through the CliOutput formatter
					// and flipped its mark to false before re-failing. Rendering it again
					// prints the same complaint twice. A UserError is a usage error, so it
					// exits like a ShowHelp carrying errors. With runWith's
					// `renderErrors: false` the mark stays true and it renders below.
					if (isRenderedUserError(error)) {
						return Effect.fail(CliRuntime.reported(error, options.usageExitCode ?? 64));
					}

					const render = options.render ?? ((value: unknown) => String(value));

					return Effect.gen(function* () {
						for (const line of toLines(render(error))) {
							yield* Effect.logError(line);
						}

						return yield* Effect.fail(CliRuntime.reported(error, chooseExitCode(error, options.exitCode)));
					});
				}),
			);

	/**
	 * Assemble a CLI program in the one order that reports every failure well.
	 *
	 * @remarks
	 * - `CliExit` is provided fresh, and a non-zero code after success becomes a
	 *   marked failure the teardown honours.
	 * - The platform layer is provided **inside** failure reporting, so a
	 *   layer-build failure (`HOME` unset, say) renders as one line with the
	 *   fallback code rather than escaping to the runtime's stack trace.
	 * - The logger is provided **outermost**, so it is present whichever branch
	 *   fails.
	 *
	 * You still call your platform's runner:
	 *
	 * @example
	 * ```ts
	 * NodeRuntime.runMain(
	 *   CliRuntime.main(Command.run(root, { version }), { platform: NodeServices.layer, exitCode: 3 }),
	 * )
	 * ```
	 */
	static readonly main = <A, E, R, RP, EP>(
		program: Effect.Effect<A, E, R>,
		options: MainOptions<RP, EP>,
	): Effect.Effect<void, Error, Exclude<Exclude<R, CliExit>, RP>> =>
		Effect.gen(function* () {
			yield* program;
			const exit = yield* CliExit;
			const code = MutableRef.get(exit.code);
			// CliExit.set validates, but the cell is a public MutableRef a program
			// can write directly; 256 would wrap to exit 0, 1.5 would throw in
			// process.exit.
			if (!isExitCode(code)) {
				return yield* Effect.die(
					new Error(`CliRuntime.main: CliExit code must be an integer 0..255, received ${code}`),
				);
			}
			if (code !== 0) return yield* Effect.fail(new ExitRequested(code));
		}).pipe(
			Effect.provide(CliExit.layer),
			Effect.provide(options.platform),
			CliRuntime.reportFailures(options),
			Effect.provide(options.logger ?? CliLogger.layer()),
		);

	/**
	 * Mark an error as already reported, carrying an exit code.
	 *
	 * @remarks
	 * Exported because a program that reports a failure itself — a validation
	 * command that prints its own diagnostics, say — needs the same two marks
	 * and should not have to rediscover the inverted polarity.
	 *
	 * Under {@link CliRuntime.main} or {@link CliRuntime.reportFailures}, do NOT
	 * print the failure yourself before failing with it: `reportFailures`
	 * renders every error but a `ShowHelp` and a runWith-printed `UserError`,
	 * marked or not, so it would print twice. Fail with the marked error and put
	 * any multi-line rendering in the `render` option instead. The mark matters
	 * for a program run WITHOUT `reportFailures`, where it keeps the runtime
	 * from reporting a failure the program already printed.
	 *
	 * The marks are added in place, so a typed error comes back as its own
	 * type: the `E` overload returns the very instance it was given, and a
	 * program failing with it keeps `catchTags` narrowing downstream without a
	 * cast. Any other value takes the `unknown` fallback and is wrapped in a
	 * plain `Error`.
	 *
	 * The `E extends Error` constraint is structural, not nominal — TypeScript
	 * cannot express "is really an `Error`", so the guarantee holds only when
	 * the argument passes `instanceof Error` at runtime. A value that merely
	 * satisfies `Error`'s shape (an object `implements Error`, or an error
	 * revived from JSON) still takes the wrapping branch and comes back as a
	 * fresh, stripped `Error` typed as `E`.
	 */
	static reported<E extends Error>(error: E, exitCode?: number): E;
	static reported(error: unknown, exitCode?: number): Error;
	static reported(error: unknown, exitCode = 1): Error {
		const marked = error instanceof Error ? error : new Error(String(error));
		return Object.assign(marked, {
			[Runtime.errorReported]: false,
			[Runtime.errorExitCode]: exitCode,
		});
	}
}
