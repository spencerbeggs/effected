import { Cause, Effect, Runtime } from "effect";

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
	 * fallback, and it defaults to `1`.
	 */
	readonly exitCode?: number | undefined;
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
	 * Mark an error as already reported, carrying an exit code.
	 *
	 * @remarks
	 * Exported because a program that reports a failure itself — a validation
	 * command that prints its own diagnostics, say — needs the same two marks
	 * and should not have to rediscover the inverted polarity.
	 */
	static readonly reported = (error: unknown, exitCode = 1): Error => {
		const marked = error instanceof Error ? error : new Error(String(error));
		return Object.assign(marked, {
			[Runtime.errorReported]: false,
			[Runtime.errorExitCode]: exitCode,
		});
	};
}
