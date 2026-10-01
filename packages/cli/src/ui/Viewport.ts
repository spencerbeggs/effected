import type { ReactElement } from "react";
import { inkModules } from "./internal/ink.js";
import { KeyTable } from "./KeyTable.js";
import { useTerminalSize } from "./UiTheme.js";

/**
 * Where a viewport is: the selected item, the first item in view, how many items fit, and how many there are.
 *
 * @remarks
 * Every number counts items, never section headers. The reducer keeps `0 <= cursor < count` (or both 0 when there
 * are no items) and `offset <= cursor < offset + height`, and never lets the window run past the last item.
 *
 * @public
 */
export interface ViewportState {
	/** The selected item. */
	readonly cursor: number;
	/** The first item in view. */
	readonly offset: number;
	/** How many items the window holds. */
	readonly height: number;
	/** How many items there are. */
	readonly count: number;
}

/**
 * A row a viewport shows: a section header, or an item. Only items are selectable.
 *
 * @public
 */
export type ViewportRow =
	| { readonly _tag: "Header"; readonly label: string }
	| { readonly _tag: "Item"; readonly key: string };

/**
 * A move through a viewport.
 *
 * @public
 */
export type ViewportMove = "up" | "down" | "home" | "end" | "pageup" | "pagedown";

/**
 * Props of {@link Viewport.View}.
 *
 * @public
 */
export interface ViewportViewProps {
	/** The rows, headers and items, in order; the items are what `state` counts. */
	readonly rows: ReadonlyArray<ViewportRow>;
	/** Where the viewport is. */
	readonly state: ViewportState;
	/** Draws one row; `highlighted` is true for the selected item. Each row is clipped to one line. */
	readonly renderRow: (row: ViewportRow, highlighted: boolean) => ReactElement;
	/** Lines the rest of the screen uses (a title, a help line), taken off the terminal height; 0 by default. */
	readonly reserved?: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/** The offset that keeps `cursor` in view, moving as little as possible, never past the last full window. */
const follow = (cursor: number, offset: number, height: number, count: number): number => {
	if (count === 0) return 0;
	let next = offset;
	if (cursor < next) next = cursor;
	if (cursor >= next + height) next = cursor - height + 1;
	return clamp(next, 0, Math.max(0, count - height));
};

const init = (count: number, height: number, cursor = 0): ViewportState => {
	const items = Math.max(0, Math.floor(count));
	const window = Math.max(1, Math.floor(height));
	const selected = items === 0 ? 0 : clamp(Math.floor(cursor), 0, items - 1);
	return { cursor: selected, offset: follow(selected, 0, window, items), height: window, count: items };
};

const step = (state: ViewportState, move: ViewportMove): ViewportState => {
	if (state.count === 0) return state;
	const last = state.count - 1;
	const target =
		move === "up"
			? state.cursor - 1
			: move === "down"
				? state.cursor + 1
				: move === "home"
					? 0
					: move === "end"
						? last
						: move === "pageup"
							? state.cursor - state.height
							: state.cursor + state.height;
	const cursor = clamp(target, 0, last);
	return { ...state, cursor, offset: follow(cursor, state.offset, state.height, state.count) };
};

const resize = (state: ViewportState, height: number): ViewportState => {
	const window = Math.max(1, Math.floor(height));
	return { ...state, height: window, offset: follow(state.cursor, state.offset, window, state.count) };
};

/**
 * The rows to draw, as indexes into `rows`, for a window of `budget` lines starting at item `start`: the section
 * header of the first item first (re-emitted when it has scrolled off), then rows in order until the budget is spent.
 */
const linesFrom = (rows: ReadonlyArray<ViewportRow>, items: ReadonlyArray<number>, start: number, budget: number) => {
	const first = items[start] ?? 0;
	const lines: Array<number> = [];
	if (budget > 1) {
		for (let index = first - 1; index >= 0; index--) {
			if (rows[index]?._tag === "Header") {
				lines.push(index);
				break;
			}
		}
	}
	for (let index = first; index < rows.length && lines.length < budget; index++) lines.push(index);
	return lines;
};

/**
 * The visible slice: from the state's offset, moved on as far as needed so the selected item is drawn when headers
 * take lines the item window did not count.
 */
const slice = (rows: ReadonlyArray<ViewportRow>, state: ViewportState, budget: number): ReadonlyArray<number> => {
	const items = rows.flatMap((row, index) => (row._tag === "Item" ? [index] : []));
	if (items.length === 0) return rows.slice(0, budget).map((_, index) => index);
	const cursor = clamp(state.cursor, 0, items.length - 1);
	const selected = items[cursor] ?? 0;
	let start = clamp(state.offset, 0, cursor);
	let lines = linesFrom(rows, items, start, budget);
	while (!lines.includes(selected) && start < cursor) {
		start++;
		lines = linesFrom(rows, items, start, budget);
	}
	return lines;
};

/**
 * A scrolling list: a pure reducer over a window of items, its key table, and a view that draws the window.
 *
 * @remarks
 * The view never draws more lines than fit: its height is `min(state.height, terminal rows - 1 - reserved)`, and
 * every row is clipped to one line of `columns - 1` cells, so a frame never fills the terminal and Ink never clears
 * the screen and scrollback to redraw it. A section header stays visible: when the header of the first visible item
 * has scrolled off, it is drawn again atop the slice.
 *
 * @public
 */
export class Viewport {
	private constructor() {}

	/**
	 * A viewport over `count` items, `height` of them in view, with `cursor` selected (clamped; 0 by default).
	 *
	 * @param count - how many items
	 * @param height - how many fit (at least 1)
	 * @param cursor - the item to select
	 */
	static readonly init: (count: number, height: number, cursor?: number) => ViewportState = init;

	/**
	 * Move the cursor, clamped at both ends with no wrap, keeping it in view. A page is the window height.
	 *
	 * @param state - where the viewport is
	 * @param move - the move
	 */
	static readonly step: (state: ViewportState, move: ViewportMove) => ViewportState = step;

	/**
	 * Change the window height, keeping the cursor where it is and in view.
	 *
	 * @param state - where the viewport is
	 * @param height - the new height (at least 1)
	 */
	static readonly resize: (state: ViewportState, height: number) => ViewportState = resize;

	/** The keys: ↑/↓ move, pgup/pgdn page, home top, end bottom. */
	static readonly keys: KeyTable<ViewportMove> = KeyTable.make<ViewportMove>([
		{ keys: ["up"], action: "up", help: "move" },
		{ keys: ["down"], action: "down", help: "move" },
		{ keys: ["pageup"], action: "pageup", help: "page" },
		{ keys: ["pagedown"], action: "pagedown", help: "page" },
		{ keys: ["home"], action: "home", help: "top" },
		{ keys: ["end"], action: "end", help: "bottom" },
	]);

	/**
	 * Draw the window: the visible rows, each clipped to one line.
	 *
	 * @param props - the rows, the state, how to draw a row, and the lines reserved for the rest of the screen
	 */
	static readonly View = (props: ViewportViewProps): ReactElement => {
		const { ink, react } = inkModules();
		const size = useTerminalSize();
		const budget = Math.max(1, Math.min(props.state.height, size.rows - (props.reserved ?? 0)));
		const selected = props.rows.flatMap((row, index) => (row._tag === "Item" ? [index] : []))[props.state.cursor];
		return react.createElement(
			ink.Box,
			{ flexDirection: "column", width: size.columns },
			...slice(props.rows, props.state, budget).map((index) => {
				const row = props.rows[index] as ViewportRow;
				return react.createElement(
					ink.Box,
					{ key: index, height: 1, width: size.columns, overflow: "hidden" },
					props.renderRow(row, index === selected),
				);
			}),
		);
	};
}
