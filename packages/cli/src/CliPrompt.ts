import type { Cause } from "effect";
import { Effect, Layer, Queue, Terminal } from "effect";
import type { Param } from "effect/cli";
import { CliConfig, CliError, GlobalFlag, Prompt } from "effect/cli";
import { Cancelled } from "./Cancelled.js";
import { CliInteractive } from "./CliInteractive.js";

/**
 * Which missing parameter a fallback stands in for, so a non-interactive run can fail with core's own error.
 *
 * @public
 */
export type CliPromptTarget = { readonly flag: string } | { readonly argument: string };

/**
 * Options for {@link CliPrompt.fallback}.
 *
 * @public
 */
export type CliPromptFallbackOptions<A> = CliPromptTarget & {
	/** The value to use when the run is not interactive. Without it a non-interactive run fails as missing. */
	readonly otherwise?: A;
};

/**
 * Prompts that know whether there is a person to ask.
 *
 * @public
 */
export class CliPrompt {
	private constructor() {}

	/**
	 * A fallback for `Flag.withFallbackPrompt` or `Argument.withFallbackPrompt` that only prompts when the run is
	 * interactive.
	 *
	 * @remarks
	 * Interactive (`CliInteractive`): the prompt runs and its answer is used. Not interactive: `otherwise` is used
	 * when given, and the terminal is never read; without it the parameter fails as missing, exactly as it would
	 * with no fallback, so core renders its own message and `CliRuntime.main` exits `64`. Name the parameter with
	 * `flag` (the name without dashes, as given to `Flag.String`) or `argument` so that error can be built.
	 *
	 * Why the prompt runs inside this function rather than being handed back to core: core's
	 * `withFallbackPrompt` turns a quit, such as Ctrl-C, into the original missing-parameter error, which would
	 * exit `64` as if the flag had been forgotten. Here a quit is `Cancelled` with reason `interrupt`, exit `130`.
	 * It is raised as a defect because core's parse step turns every typed failure into a usage error. Core then
	 * runs the already-answered `Prompt.succeed` it is handed. Because it travels as a defect, a handler's
	 * `Effect.catchTag("Cancelled", ...)` cannot see it, and only `CliRuntime.main` (or
	 * `CliRuntime.reportFailures`) renders it as one line with exit `130`; under a bare `runMain` it prints a
	 * stack.
	 *
	 * Pair it with `CliPrompt.gateTerminal`, which `CliEnv.layer` installs: core still runs `Prompt.run` on the
	 * answered prompt it is handed, and `Prompt.run` subscribes the terminal's input, which on a real terminal
	 * attaches a reader to stdin and drops piped input. The gate makes that subscription harmless when the run is
	 * not interactive.
	 *
	 * @param prompt - the prompt to show
	 * @param options - the parameter it stands in for, and the non-interactive default
	 */
	static readonly fallback = <A>(
		prompt: Prompt.Prompt<A>,
		options: CliPromptFallbackOptions<A>,
	): Param.FallbackPrompt<A> =>
		Effect.gen(function* () {
			if (yield* CliInteractive) {
				const answer = yield* Prompt.run(prompt).pipe(
					Effect.catchTag("QuitError", () => Effect.die(new Cancelled({ reason: "interrupt" }))),
				);
				return Prompt.succeed(answer);
			}
			// `{ otherwise: undefined }` counts as not given.
			if ("otherwise" in options && options.otherwise !== undefined) return Prompt.succeed(options.otherwise);
			return yield* Effect.fail(
				"flag" in options
					? new CliError.MissingOption({ option: options.flag })
					: new CliError.MissingArgument({ argument: options.argument }),
			);
		});

	/**
	 * Swaps core's `Terminal` for a quiet one when the run is not interactive, so nothing touches the real one.
	 *
	 * @remarks
	 * Core's prompt runner subscribes the terminal's input even for a prompt that is already answered, and the
	 * real Node terminal then attaches a readline to stdin, which drops piped input and puts a TTY stdin into raw
	 * mode. Not interactive, this layer provides a terminal whose input is an already-ended queue, whose
	 * `readLine` fails as quit and whose `display` writes nothing, so any prompt, the wizard included, is quit at
	 * once and the real terminal is never read. Its `columns` and `rows` still come from the real one, so layout
	 * keeps working. Interactive, the real terminal passes through.
	 *
	 * It requires the real `Terminal` and reads `CliInteractive` when it is built. `CliEnv.layer` installs it,
	 * after `TerminalEnv` is built from the real terminal, so consumers do not compose it.
	 */
	static readonly gateTerminal: Layer.Layer<Terminal.Terminal, never, Terminal.Terminal> = Layer.effect(
		Terminal.Terminal,
		Effect.gen(function* () {
			const real = yield* Terminal.Terminal;
			if (yield* CliInteractive) return real;
			return Terminal.make({
				columns: real.columns,
				rows: real.rows,
				readInput: Effect.map(Queue.unbounded<Terminal.UserInput, Cause.Done>(), (queue) => {
					Queue.endUnsafe(queue);
					return queue;
				}),
				readLine: Effect.fail(new Terminal.QuitError({})),
				display: () => Effect.void,
			});
		}),
	);

	/**
	 * Drops core's `--wizard` built-in flag when the run is not interactive.
	 *
	 * @remarks
	 * The wizard prompts, so offering it without a terminal only leads to a dead end. With the flag gone, core
	 * treats `--wizard` as an unknown flag, a usage error that exits `64`, and lists it nowhere in `--help`.
	 * The layer reads `CliInteractive` when it is built, so provide that first, for example
	 * `CliPrompt.gateWizard.pipe(Layer.provide(CliInteractive.layer))`.
	 */
	static readonly gateWizard: Layer.Layer<never> = Layer.effect(
		CliConfig.CliConfig,
		Effect.gen(function* () {
			const interactive = yield* CliInteractive;
			return CliConfig.make({
				builtIns: interactive ? GlobalFlag.BuiltIns : GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard),
			});
		}),
	);
}
