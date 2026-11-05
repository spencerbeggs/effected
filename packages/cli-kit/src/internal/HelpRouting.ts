import { TerminalEnv } from "@effected/env";
import { Console, Effect, Option } from "effect";
import { CliOutput } from "effect/cli";
import type { CliHelpFlags } from "../CliColor.js";

/**
 * The installed formatter with its colour-bearing methods (`formatHelpDoc`, `formatError`, `formatErrors`) rebuilt
 * from core's default under `colors`, then `overrides` applied so they still win. Every other method of `current`,
 * `formatVersion` included, is kept.
 *
 * @internal
 */
export const stderrFormatter = (
	current: CliOutput.Formatter,
	colors: boolean,
	overrides: Partial<CliOutput.Formatter> | undefined,
	helpFlags: CliHelpFlags | undefined,
): CliOutput.Formatter => {
	const { formatHelpDoc, formatError, formatErrors } = CliOutput.defaultFormatter({ colors, ...helpFlags });
	return { ...current, formatHelpDoc, formatError, formatErrors, ...overrides };
};

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
const usageErrorsToStderr = (
	overrides: Partial<CliOutput.Formatter> | undefined,
	helpFlags: CliHelpFlags | undefined,
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
					// Only when the kit's TerminalEnv is present (under `env`) and the two streams disagree, and then only the
					// colour-bearing methods (`formatHelpDoc`, `formatError`, `formatErrors`) are rebuilt; the rest of the installed formatter
					// stays, and `env.formatter` overrides are applied last so they still win.
					const terminal = yield* Effect.serviceOption(TerminalEnv);
					const current = yield* CliOutput.Formatter;
					const colors = Option.map(terminal, (t) => ({
						stdout: t.stdout.color !== "none",
						stderr: t.stderr.color !== "none",
					}));
					const formatter =
						Option.isNone(colors) || colors.value.stderr === colors.value.stdout
							? current
							: stderrFormatter(current, colors.value.stderr, overrides, helpFlags);
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
	helpFlags?: CliHelpFlags,
): Effect.Effect<A, E, R> =>
	Effect.provideService(program, CliOutput.Presenter, usageErrorsToStderr(overrides, helpFlags));
