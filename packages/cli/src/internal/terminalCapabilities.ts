import { TerminalEnv } from "@effected/env";
import { Config, Effect, Layer, Option } from "effect";
import { TerminalCapabilities } from "effect/cli";

/**
 * Installs core's `TerminalCapabilities` from the ambient `TerminalEnv`, through `TerminalEnv.capabilities`, so core's
 * own colour decision follows the kit's rule. `TERM` is read through `Config`, and a read that fails counts as unset.
 *
 * @remarks
 * It lives here rather than in `@effected/env` because `effect/cli` exports the reference only through its barrel,
 * and a value import there would load that barrel for every env consumer. `CliInteractive.layer`, built over it,
 * then holds `canPrompt` at `true`.
 *
 * @internal
 */
export const capabilitiesLayer: Layer.Layer<never, never, TerminalEnv> = Layer.effect(
	TerminalCapabilities.TerminalCapabilities,
	Effect.gen(function* () {
		const terminal = yield* TerminalEnv;
		const term = yield* Config.option(Config.String("TERM")).pipe(Effect.orElseSucceed(() => Option.none<string>()));
		return TerminalEnv.capabilities(terminal, Option.getOrUndefined(term));
	}),
);
