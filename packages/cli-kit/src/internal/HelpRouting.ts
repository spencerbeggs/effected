import { Console, Effect } from "effect";
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
const usageErrorsToStderr: CliOutput.Presenter = {
	present: (event) =>
		event._tag !== "InvalidInvocation"
			? CliOutput.defaultPresenter.present(event)
			: Effect.gen(function* () {
					const sink = yield* Console.Console;
					const toStderr: Console.Console = Object.assign(Object.create(sink) as Console.Console, {
						log: (...args: ReadonlyArray<unknown>) => sink.error(...args),
					});
					yield* CliOutput.defaultPresenter.present(event).pipe(Effect.provideService(Console.Console, toStderr));
				}),
};

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
export const routeHelpOnUsageError = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	Effect.provideService(program, CliOutput.Presenter, usageErrorsToStderr);
