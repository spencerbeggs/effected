import type * as Cli from "@effected/cli";
import type { ColorLevel } from "@effected/env";
import type { ReactElement, ReactNode } from "react";
import { inkModules } from "./internal/ink.js";
import type { ScreenContextValue } from "./internal/ScreenContext.js";
import { screenContext } from "./internal/ScreenContext.js";

/**
 * The styling props of an Ink `Text` that a {@link Cli.Style} maps to.
 *
 * @public
 */
export interface InkTextProps {
	/** The foreground: a colour name or a `#rrggbb` hex. */
	readonly color?: string;
	/** Bold. */
	readonly bold?: boolean;
	/** Dim. */
	readonly dimColor?: boolean;
	/** Italic. */
	readonly italic?: boolean;
	/** Underline. */
	readonly underline?: boolean;
}

/**
 * Props of {@link Styled}.
 *
 * @public
 */
export interface StyledProps {
	/** A theme token, or an explicit style. */
	readonly token: Cli.TokenName | Cli.Style;
	/** The text. */
	readonly children?: ReactNode;
}

/**
 * The usable size of the terminal.
 *
 * @public
 */
export interface TerminalSize {
	/** The width, less one column, so a full-width line never wraps the cursor. */
	readonly columns: number;
	/** The height, less one row, so a full-height frame never scrolls. */
	readonly rows: number;
}

const OUTSIDE = "@effected/cli/ui: a theme hook was used outside a screen mounted by CliUi.run";

const useScreen = (): ScreenContextValue => {
	const screen = inkModules().react.useContext(screenContext());
	if (screen === undefined) throw new Error(OUTSIDE);
	return screen;
};

/**
 * The Ink `Text` props for `style` at `color`.
 *
 * @remarks
 * At `"none"` it gives no styling props at all, not even bold or dim, so a frame is escape-free by construction;
 * Ink's colour level held at 0 is the backstop. A flag set to `false` adds no prop.
 *
 * @param style - the resolved style
 * @param color - the stream's colour level
 *
 * @public
 */
export const inkProps = (style: Cli.Style, color: ColorLevel): InkTextProps =>
	color === "none"
		? {}
		: {
				...(style.fg === undefined ? {} : { color: style.fg }),
				...(style.bold === true ? { bold: true } : {}),
				...(style.dim === true ? { dimColor: true } : {}),
				...(style.italic === true ? { italic: true } : {}),
				...(style.underline === true ? { underline: true } : {}),
			};

/**
 * The theme of the stream the mounted screen draws on.
 *
 * @remarks
 * A React hook: call it from a component rendered inside a `CliUi.run` screen.
 *
 * @public
 */
export const useTheme = (): Cli.StreamTheme => useScreen().theme;

/**
 * The glyph set of the mounted screen, so a component draws Unicode or ASCII glyphs to match the rest of the output.
 *
 * @remarks
 * A React hook: call it from a component rendered inside a `CliUi.run` screen.
 *
 * @public
 */
export const useGlyphs = (): Cli.GlyphSet => useScreen().glyphs;

/**
 * Text painted with a theme token or style, through the mounted screen's theme.
 *
 * @param props - the token or style, and the text
 *
 * @public
 */
export const Styled = (props: StyledProps): ReactElement => {
	const theme = useTheme();
	const { ink, react } = inkModules();
	return react.createElement(ink.Text, inkProps(theme.style(props.token), theme.color), props.children);
};

/**
 * The usable terminal size: the stdout Ink draws on, less one column and one row, re-read on every render and when
 * the terminal resizes.
 *
 * @remarks
 * A React hook: call it from a component rendered inside a `CliUi.run` screen.
 *
 * @public
 */
export const useTerminalSize = (): TerminalSize => {
	const { ink, react } = inkModules();
	const { stdout } = ink.useStdout();
	const [, redraw] = react.useReducer((count: number) => count + 1, 0);
	react.useEffect(() => {
		stdout.on("resize", redraw);
		return () => {
			stdout.off("resize", redraw);
		};
	}, [stdout]);
	return { columns: Math.max(1, (stdout.columns ?? 80) - 1), rows: Math.max(1, (stdout.rows ?? 24) - 1) };
};
