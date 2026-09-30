import { Effect, Layer } from "effect";
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
	 * runs the already-answered `Prompt.succeed` it is handed.
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
			if ("otherwise" in options) return Prompt.succeed(options.otherwise as A);
			return yield* Effect.fail(
				"flag" in options
					? new CliError.MissingOption({ option: options.flag })
					: new CliError.MissingArgument({ argument: options.argument }),
			);
		});

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
