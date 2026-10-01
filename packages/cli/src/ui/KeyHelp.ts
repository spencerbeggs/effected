import type { ReactElement } from "react";
import { Fmt } from "../Fmt.js";
import { inkModules } from "./internal/ink.js";
import { KeyTable } from "./KeyTable.js";
import { Styled, useGlyphs, useTerminalSize } from "./UiTheme.js";

/** The fewest cells worth giving the widget's own keys when the line is cut; below it they are left out. */
const MIN_OWN = 4;

/**
 * Props of {@link KeyHelp}.
 *
 * @public
 */
export interface KeyHelpProps {
	/** The tables to describe, in order. */
	readonly tables: ReadonlyArray<KeyTable<unknown>>;
	/** Whether to end with the root keys (`esc cancel`); `true` by default. */
	readonly root?: boolean;
}

/**
 * A one-line footer naming every visible binding of the given tables, then the root keys:
 * `↑/↓ move · space toggle · enter continue · esc cancel`.
 *
 * @remarks
 * Drawn from the same tables that dispatch the keys, so the help cannot name a key the screen ignores. Neighbouring
 * rows with the same help share one entry (`↑/↓ move`). It stays one line, cut to the terminal width with the glyph
 * set's ellipsis; when it must be cut, the widget's own keys give way and the root hint (`esc cancel`) stays whole at
 * the end. Painted with the `muted` token; labels follow the screen's glyph set.
 *
 * @param props - the tables, and whether to append the root keys
 *
 * @public
 */
export const KeyHelp = (props: KeyHelpProps): ReactElement => {
	const glyphs = useGlyphs();
	const { columns } = useTerminalSize();
	const separator = glyphs.kind === "unicode" ? " · " : " | ";
	const describe = (tables: ReadonlyArray<KeyTable<unknown>>): string => {
		// Neighbouring rows that say the same thing share one entry: ↑ move, ↓ move reads ↑/↓ move.
		const rows: Array<{ label: string; help: string }> = [];
		for (const row of tables.flatMap((table) => table.help(glyphs))) {
			const previous = rows.at(-1);
			if (previous !== undefined && previous.help === row.help) previous.label = `${previous.label}/${row.label}`;
			else rows.push({ ...row });
		}
		return rows.map((row) => `${row.label} ${row.help}`).join(separator);
	};
	const own = describe(props.tables);
	const root = props.root === false ? "" : describe([KeyTable.root]);
	const whole = [own, root].filter((part) => part !== "").join(separator);
	// One line, cut to the terminal width with the theme's ellipsis, so the footer never wraps into a second row.
	// When it must be cut, the widget's own keys give way and the root hint (esc cancel) stays whole at the end;
	// when the keys would get fewer than MIN_OWN cells they are dropped, along with the separator, rather than shown
	// as an ellipsis; and when even the separator does not fit, the hint stands alone.
	const ellipsis = { ellipsis: glyphs.ellipsis };
	const room = columns - Fmt.width(separator) - Fmt.width(root);
	const line =
		Fmt.width(whole) <= columns || root === "" || own === ""
			? Fmt.truncate(whole, columns, ellipsis)
			: room >= MIN_OWN
				? `${Fmt.truncate(own, room, ellipsis)}${separator}${root}`
				: Fmt.truncate(root, columns, ellipsis);
	return inkModules().react.createElement(Styled, { token: "muted" }, line);
};
