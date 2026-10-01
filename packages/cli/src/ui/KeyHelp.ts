import type { ReactElement } from "react";
import { inkModules } from "./internal/ink.js";
import { KeyTable } from "./KeyTable.js";
import { Styled, useGlyphs } from "./UiTheme.js";

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
 * rows with the same help share one entry (`↑/↓ move`). Painted with the `muted` token; labels follow the screen's
 * glyph set.
 *
 * @param props - the tables, and whether to append the root keys
 *
 * @public
 */
export const KeyHelp = (props: KeyHelpProps): ReactElement => {
	const glyphs = useGlyphs();
	const tables = props.root === false ? props.tables : [...props.tables, KeyTable.root];
	// Neighbouring rows that say the same thing share one entry: ↑ move, ↓ move reads ↑/↓ move.
	const rows: Array<{ label: string; help: string }> = [];
	for (const row of tables.flatMap((table) => table.help(glyphs))) {
		const previous = rows.at(-1);
		if (previous !== undefined && previous.help === row.help) previous.label = `${previous.label}/${row.label}`;
		else rows.push({ ...row });
	}
	const line = rows.map((row) => `${row.label} ${row.help}`).join(glyphs.kind === "unicode" ? " · " : " | ");
	return inkModules().react.createElement(Styled, { token: "muted" }, line);
};
