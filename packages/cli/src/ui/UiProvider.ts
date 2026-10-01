import type * as Cli from "@effected/cli";
import type { ReactElement, ReactNode } from "react";
import { inkModules } from "./internal/ink.js";
import { uiProviders } from "./internal/UiProviders.js";

/**
 * What the kit's hooks read in a tree the kit did not mount: the theme, the glyph set, and optionally the size.
 *
 * @public
 */
export interface UiContextValue {
	/** The theme of the stream the tree draws on. */
	readonly theme: Cli.StreamTheme;
	/** The glyph set in use. */
	readonly glyphs: Cli.GlyphSet;
	/** The terminal size the tree is laid out at, which `useTerminalSize` reads in place of the stdout's. */
	readonly size?: { readonly columns: number; readonly rows: number };
}

/**
 * Provide the kit's context to an Ink tree the kit did not mount, so `useTheme`, `useGlyphs`, `Styled` and
 * `useTerminalSize` work in it.
 *
 * @remarks
 * Take the value from `CliUi.context`, which also loads Ink and React: the provider and the kit's hooks render with
 * the modules the kit loaded, so a tree rendered before that load is a defect saying so. A screen mounted by
 * `CliUi.run` already has this context.
 *
 * With `size`, `useTerminalSize` reads it instead of the stdout Ink draws on, less one column and one row as ever.
 * Give it to Ink's `renderToString`, whose terminal hooks see the process's own stdout rather than the width it lays
 * out at: `renderToString(tree, { columns })` with `size: { columns, rows }` keeps the kit's widgets cut to that
 * width.
 *
 * There is no screen here to end: `useScreenCancel` does nothing (a widget's own quit key, such as `Select`'s `q`,
 * is inert), and an input handler a kit widget registers is called as is, so what it throws escapes as Ink leaves
 * it. Ink's colour level is the host's: `Styled` passes the theme's props, none at colour `none`.
 *
 * @param props - the context, and the tree
 *
 * @public
 */
export const UiProvider = (props: { readonly value: UiContextValue; readonly children?: ReactNode }): ReactElement => {
	const { theme, glyphs, size } = props.value;
	const columns = size?.columns;
	const rows = size?.rows;
	// Only the three fields: a value carrying more (a screen's cancel) is not taken for a screen.
	const value = inkModules().react.useMemo(
		() => ({
			theme,
			glyphs,
			...(columns === undefined || rows === undefined ? {} : { size: { columns, rows } }),
		}),
		[theme, glyphs, columns, rows],
	);
	return uiProviders(value, props.children);
};
