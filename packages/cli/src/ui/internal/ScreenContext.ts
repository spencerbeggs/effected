import type * as Cli from "@effected/cli";
import type { Context as ReactContext } from "react";
import { fromReact, inkModules } from "./ink.js";

/**
 * What every kit widget reads from its screen.
 *
 * @internal
 */
export interface ScreenContextValue {
	/** Cancel the screen. */
	readonly cancel: (reason: "escape" | "interrupt") => void;
	/** End the screen as a defect carrying `error`: what an input handler that throws comes to. */
	readonly die: (error: unknown) => void;
	/** The theme of the stream the screen draws on. */
	readonly theme: Cli.StreamTheme;
	/** The glyph set in use. */
	readonly glyphs: Cli.GlyphSet;
}

/**
 * The React context carrying {@link ScreenContextValue}, built on the loaded React.
 *
 * @internal
 */
export const screenContext: () => ReactContext<ScreenContextValue | undefined> = fromReact((react) =>
	react.createContext<ScreenContextValue | undefined>(undefined),
);

/**
 * The mounted screen's cancel, for a widget whose own key (such as Select's `q`) ends the screen.
 *
 * @remarks
 * A React hook; throws outside a screen mounted by `CliUi.run`.
 *
 * @internal
 */
export const useScreenCancel = (): ScreenContextValue["cancel"] => {
	const screen = inkModules().react.useContext(screenContext());
	if (screen === undefined)
		throw new Error("@effected/cli/ui: a widget was used outside a screen mounted by CliUi.run");
	return screen.cancel;
};

/**
 * Wrap an input handler so a throw ends the screen as a defect instead of escaping.
 *
 * @remarks
 * Ink calls `useInput` and `usePaste` handlers from its stdin listener, outside React's render, so an error boundary
 * never sees what they throw: unguarded, it is an uncaught exception (the process dies, Effect finalizers skipped)
 * or, where something keeps the process alive, a screen left waiting. Guarded, the screen dies with the error and
 * `CliUi.run` unmounts it like any other defect. Outside a screen mounted by `CliUi.run` a handler is called as is.
 *
 * A React hook.
 *
 * @internal
 */
export const useScreenGuard = (): (<Args extends ReadonlyArray<unknown>>(
	handler: (...args: Args) => void,
) => (...args: Args) => void) => {
	const screen = inkModules().react.useContext(screenContext());
	return (handler) =>
		(...args) => {
			if (screen === undefined) return handler(...args);
			try {
				handler(...args);
			} catch (error) {
				screen.die(error);
			}
		};
};
