import type * as Cli from "@effected/cli";
import type { Context as ReactContext } from "react";
import { fromReact } from "./ink.js";

/**
 * What every kit widget reads from its screen.
 *
 * @internal
 */
export interface ScreenContextValue {
	/** Cancel the screen. */
	readonly cancel: (reason: "escape" | "interrupt") => void;
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
