import { Audience, CurrentRuntimeEnv, TerminalEnv } from "@effected/env";
import type { Effect, Layer, Stdio, Terminal } from "effect";
import { Layer as LayerModule } from "effect";
import { CliInteractive } from "./CliInteractive.js";
import type { CliLogFileOptions, CliLogOptions } from "./CliLog.js";
import { CliPrompt } from "./CliPrompt.js";
import type { CliThemeOptions } from "./CliTheme.js";
import { CliTheme } from "./CliTheme.js";

/**
 * Options for {@link CliEnv.layer} and for `CliRuntime.main`'s `env` option.
 *
 * @public
 */
export interface CliEnvOptions {
	/** The environment variable that overrides the audience, read through `Config`; see `Audience.layer`. */
	readonly audienceEnvVar?: string | undefined;
	/** Overrides the stderr terminal check; `Stdio` reports only stdout, so stderr mirrors it otherwise. */
	readonly stderrIsTerminal?: Effect.Effect<boolean> | undefined;
	/** Options for the theme; see {@link CliThemeOptions}. */
	readonly theme?: CliThemeOptions | undefined;
	/**
	 * Diagnostics options. Only `CliRuntime.main` reads this: when given, `main` uses `CliLog.layer` with these
	 * options as the program's logger, instead of the default `CliLogger.layer()`.
	 *
	 * @remarks
	 * It may carry the `file` option, which also writes an async NDJSON file. The platform must then provide
	 * `FileSystem` and `Path`, and `main`'s type says so when it does not.
	 */
	readonly log?: CliLogOptions | CliLogFileOptions | undefined;
}

/**
 * The services {@link CliEnv.layer} provides.
 *
 * @public
 */
export type CliEnvServices = CurrentRuntimeEnv | TerminalEnv | Audience | CliTheme;

/**
 * The environment services a CLI reads, built once and in the right order.
 *
 * @remarks
 * Builds `CurrentRuntimeEnv`, `TerminalEnv`, `Audience`, `CliTheme` and sets `CliInteractive` from them, then
 * installs the two gates for the program: `CliPrompt.gateTerminal`, which replaces `Terminal` with a quiet one when
 * the run is not interactive so no prompt runner ever attaches to stdin, and `CliPrompt.gateWizard`, which drops
 * `--wizard` then. `TerminalEnv` is built from the real terminal first. The layer therefore also outputs
 * `Terminal`, the gated one, and consumers never compose the gates themselves. A
 * `Context.Reference`'s key type is `never`, so the layer's output type does not list `CliInteractive`: it sets
 * the reference rather than providing a service. Every read of the environment goes through `Config` and
 * degrades to "unset" when it fails, so building the layer does not fail on a bad provider; it fails only when
 * `Stdio` or `Terminal` do.
 *
 * Not interactive, the gated `Terminal`'s `readLine` fails as a quit and its input is already ended. A program that
 * reads piped data must read `Stdio.stdin`, never `Terminal`.
 *
 * @public
 */
export class CliEnv {
	private constructor() {}

	/**
	 * The environment services for the terminal `Stdio` and `Terminal` describe.
	 *
	 * @remarks
	 * A layer-returning function mints a fresh layer per call: call it once and bind the result to a constant.
	 *
	 * @param options - the audience env var, the stderr check and the theme options
	 */
	static readonly layer = (
		options: CliEnvOptions = {},
	): Layer.Layer<CliEnvServices | Terminal.Terminal, never, Stdio.Stdio | Terminal.Terminal> => {
		const base = LayerModule.mergeAll(
			CurrentRuntimeEnv.layer,
			TerminalEnv.layer(
				options.stderrIsTerminal === undefined ? undefined : { stderrIsTerminal: options.stderrIsTerminal },
			),
		);
		const withAudience = Audience.layer(
			options.audienceEnvVar === undefined ? undefined : { envVar: options.audienceEnvVar },
		).pipe(LayerModule.provideMerge(base));
		const withTheme = CliTheme.layer(options.theme).pipe(LayerModule.provideMerge(withAudience));
		// Sets the CliInteractive reference from the audience and terminal; it has no output type of its own.
		const withInteractive = CliInteractive.layer.pipe(LayerModule.provideMerge(withTheme));
		// The gates read CliInteractive when built, and the terminal gate wraps the REAL Terminal, which the
		// environment layers above have already read.
		return LayerModule.mergeAll(CliPrompt.gateTerminal, CliPrompt.gateWizard).pipe(
			LayerModule.provideMerge(withInteractive),
		);
	};
}
