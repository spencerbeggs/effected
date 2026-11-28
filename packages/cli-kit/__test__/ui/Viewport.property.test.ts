import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Schema } from "effect";
import type { ViewportState } from "../../src/ui.js";
import { Viewport } from "../../src/ui.js";

type Move = "up" | "down" | "home" | "end" | "pageup" | "pagedown";
const MOVES: ReadonlyArray<Move> = ["up", "down", "home", "end", "pageup", "pagedown"];

/** The reducer's invariants: the cursor is an item and is in view, and the window never runs past the end. */
const holds = (state: ViewportState): boolean => {
	if (state.count === 0) return state.cursor === 0 && state.offset === 0;
	return (
		state.cursor >= 0 &&
		state.cursor < state.count &&
		state.offset <= state.cursor &&
		state.cursor < state.offset + state.height &&
		state.offset >= 0 &&
		state.offset <= Math.max(0, state.count - state.height)
	);
};

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 300 }));
const Height = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 }));
const Moves = Schema.Array(Schema.Literals(MOVES));

describe("Viewport reducer properties", () => {
	it.prop(
		"every step keeps the cursor an item, in view, with the window inside the list",
		{ count: Count, height: Height, start: Count, moves: Moves },
		({ count, height, start, moves }) => {
			let state = Viewport.init(count, height, start);
			if (!holds(state)) return false;
			for (const move of moves) {
				state = Viewport.step(state, move);
				if (!holds(state)) return false;
			}
			return true;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 40, full: 400 }), size: 300 } },
	);

	it.prop(
		"resize keeps the cursor in view at the new height",
		{ count: Count, height: Height, next: Height, moves: Moves },
		({ count, height, next, moves }) => {
			const moved = moves.reduce((state, move) => Viewport.step(state, move), Viewport.init(count, height));
			const resized = Viewport.resize(moved, next);
			return holds(resized) && resized.cursor === moved.cursor && resized.height === next;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 40, full: 400 }), size: 300 } },
	);
});
