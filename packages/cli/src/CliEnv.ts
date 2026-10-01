import { Audience, CurrentRuntimeEnv, TerminalEnv } from "@effected/env";
import type { Effect, Layer, Stdio, Terminal } from "effect";
import { Layer as LayerModule } from "effect";
import type { CliOutput } from "effect/cli";
import { CliInteractive } from "./CliInteractive.js";
import type { CliLinks, EditorLinks } from "./CliLinks.js";
import { ambientLinksLayer } from "./CliLinks.js";
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
	 * options as the program's logger, instead of the default `CliLogger.layer()`. The platform is built under
	 * that logger, so a line it logs while building goes to stderr.
	 *
	 * @remarks
	 * It may carry the `file` option, which also writes an async NDJSON file. The platform must then provide
	 * `FileSystem` and `Path`, and `main`'s type says so when it does not.
	 *
	 * A platform or program that installs its own `Logger.layer([...])` replaces this logger set, and the
	 * diagnostics go silent with no error: do not install one. See `CliLog.layer`.
	 */
	readonly log?: CliLogOptions | CliLogFileOptions | undefined;
	/**
	 * Methods of core's `CliOutput.Formatter` to replace in the one `CliRuntime.main` installs, for example
	 * `formatVersion` to name the carrier a bin runs through. Only `CliRuntime.main` reads this.
	 *
	 * @remarks
	 * `main` installs a coloured default formatter inside the platform, which shadows any formatter the platform
	 * sets; this is the way to keep a method of your own. Methods you omit keep the coloured defaults.
	 */
	readonly formatter?: Partial<CliOutput.Formatter> | undefined;
	/**
	 * Turns an absolute path into its display form, for example relative to the workspace: the stack frames of the
	 * default failure report are shown through it. Only `CliRuntime.main` reads this. The identity by default.
	 */
	readonly displayPath?: ((absolute: string) => string) | undefined;
	/** Whether file links open in an editor; `auto` by default. See {@link CliLinks}. */
	readonly editorLinks?: EditorLinks | undefined;
	/** The environment variable that overrides `editorLinks`, read through `Config`. Not read unless named. */
	readonly editorLinksEnvVar?: string | undefined;
}

/**
 * The services {@link CliEnv.layer} provides.
 *
 * @public
 */
export type CliEnvServices = CurrentRuntimeEnv | TerminalEnv | Audience | CliTheme | CliLinks | Terminal.Terminal;

/**
 * The environment services a CLI reads, built once and in the right order.
 *
 * @remarks
 * Builds `CurrentRuntimeEnv`, `TerminalEnv`, `Audience`, `CliTheme` and `CliLinks`, and sets `CliInteractive` from them, then
 * installs the two gates for the program: `CliPrompt.gateTerminal`, which replaces `Terminal` with a quiet one when
 * the run is not interactive so no prompt runner ever attaches to stdin, and `CliPrompt.gateWizard`, which drops
 * `--wizard` then. `TerminalEnv` is built from the real terminal first. The layer therefore also outputs
 * `Terminal`, the gated one, and consumers never compose the gates themselves. A
 * `Context.Reference`'s key type is `never`, so the layer's output type does not list `CliInteractive`: it sets
 * the reference rather than providing a service. Every read of the environment goes through `Config` and
 * degrades to "unset" when it fails, so building the layer does not fail on a bad provider; it fails only when
 * `Stdio` or `Terminal` do.
 *
 * `CliLinks` reads `FileSystem` and `Path` from the surrounding context if it has them, and does not require them: a
 * `.vscode/` directory is looked for, and a relative path resolved, only when the platform is provided OUTSIDE this
 * layer, as `CliRuntime.main` does. Without them `auto` is `vscode` on the terminal signal alone.
 *
 * Not interactive, the gated `Terminal`'s `readLine` fails as a quit, its input is already ended and its `display`
 * writes nothing. A program that reads piped data must read `Stdio.stdin`, and one that writes output must use
 * `Console` or `Stdio`, never `Terminal`. It also installs `CliTheme.promptTheme`, so core's prompts follow the
 * theme.
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
	): Layer.Layer<CliEnvServices, never, Stdio.Stdio | Terminal.Terminal> => {
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
		// `FileSystem` and `Path` are read from the environment if it has them, not required, so this layer and every
		// `CliRuntime.main` overload keep their requirements; without them `auto` is `vscode` on the terminal signal only.
		const withLinks = ambientLinksLayer({
			...(options.editorLinks === undefined ? {} : { editorLinks: options.editorLinks }),
			...(options.editorLinksEnvVar === undefined ? {} : { envVar: options.editorLinksEnvVar }),
		}).pipe(LayerModule.provideMerge(withTheme));
		// Sets the CliInteractive reference from the audience and terminal; it has no output type of its own.
		const withInteractive = CliInteractive.layer.pipe(LayerModule.provideMerge(withLinks));
		// The gates read CliInteractive when built, and the terminal gate wraps the REAL Terminal, which the
		// environment layers above have already read.
		// `promptTheme` bridges the theme to core's prompts, so they follow the terminal's colour too.
		return LayerModule.mergeAll(CliPrompt.gateTerminal, CliPrompt.gateWizard, CliTheme.promptTheme).pipe(
			LayerModule.provideMerge(withInteractive),
		);
	};
}
