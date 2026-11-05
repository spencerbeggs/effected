import { TerminalEnv } from "@effected/env";
import { Console, Effect, Option } from "effect";
import { CliOutput } from "effect/cli";

/**
 * Core's presenter, with an invalid invocation's help written to stderr beside
 * its errors instead of stdout.
 *
 * @remarks
 * Core's `defaultPresenter` writes an invalid invocation's help with
 * `Console.log` and its errors with `Console.error`. Here it runs under a
 * `Console` whose `log` is the ambient one's `error`, so the help and errors
 * keep core's rendering, Formatter resolution included, and only the stream
 * moves. An explicit `--help`, a bare group invocation and `--version` are
 * other events, presented by core unchanged on stdout.
 */
interface HelpFlags {
	readonly inheritedFlags?: "full" | "summary" | "none" | undefined;
	readonly globalFlags?: "full" | "summary" | "none" | undefined;
}

const usageErrorsToStderr = (
	overrides: Partial<CliOutput.Formatter> | undefined,
	helpFlags: HelpFlags | undefined,
): CliOutput.Presenter => ({
	present: (event) =>
		event._tag !== "InvalidInvocation"
			? CliOutput.defaultPresenter.present(event)
			: Effect.gen(function* () {
					const sink = yield* Console.Console;
					const toStderr: Console.Console = Object.assign(Object.create(sink) as Console.Console, {
						log: (...args: ReadonlyArray<unknown>) => sink.error(...args),
					});
					// The installed formatter painted by stdout's check; this help goes to stderr, so it follows stderr's.
					// Only when the kit's TerminalEnv is present (under `env`) and the two streams disagree, and never over a
					// method the caller replaced through `env.formatter`.
					const terminal = yield* Effect.serviceOption(TerminalEnv);
					const current = yield* CliOutput.Formatter;
					const stderrColors = Option.isSome(terminal) && terminal.value.stderr.color !== "none";
					const stdoutColors = Option.isSome(terminal) && terminal.value.stdout.color !== "none";
					const formatter =
						Option.isNone(terminal) || stderrColors === stdoutColors
							? current
							: {
									...current,
									...CliOutput.defaultFormatter({ colors: stderrColors, ...helpFlags }),
									...overrides,
									formatVersion: current.formatVersion,
								};
					yield* CliOutput.defaultPresenter
						.present(event)
						.pipe(
							Effect.provideService(Console.Console, toStderr),
							Effect.provideService(CliOutput.Formatter, formatter),
						);
				}),
});

/**
 * Run `program` so a help document printed together with parse errors goes to
 * stderr, beside the errors, instead of stdout.
 *
 * @remarks
 * Provides core's `CliOutput.Presenter`, which `Command.runWith` hands each
 * help, invalid-invocation and version event to. A Presenter provided inside
 * `program` replaces this one.
 *
 * @internal
 */
export const routeHelpOnUsageError = <A, E, R>(
	program: Effect.Effect<A, E, R>,
	overrides?: Partial<CliOutput.Formatter>,
	helpFlags?: HelpFlags,
): Effect.Effect<A, E, R> =>
	Effect.provideService(program, CliOutput.Presenter, usageErrorsToStderr(overrides, helpFlags));
