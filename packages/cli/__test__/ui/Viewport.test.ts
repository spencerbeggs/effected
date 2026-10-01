import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Schedule, Schema } from "effect";
import { Text } from "ink";
import type { ReactElement } from "react";
import { createElement, useState } from "react";
import { CliInteractive, CliTheme, Fmt } from "../../src/index.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { Screen, ViewportRow, ViewportState } from "../../src/ui.js";
import { CliUi, KeyHelp, UiStreams, Viewport, useKeys } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

const ESC = String.fromCharCode(0x1b);
const CLEAR_SCROLLBACK = `${ESC}[3J`;

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

describe("Viewport reducer", () => {
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
		{ arbitrary: { runs: 400, size: 300 } },
	);

	it.prop(
		"resize keeps the cursor in view at the new height",
		{ count: Count, height: Height, next: Height, moves: Moves },
		({ count, height, next, moves }) => {
			const moved = moves.reduce((state, move) => Viewport.step(state, move), Viewport.init(count, height));
			const resized = Viewport.resize(moved, next);
			return holds(resized) && resized.cursor === moved.cursor && resized.height === next;
		},
		{ arbitrary: { runs: 400, size: 300 } },
	);

	it("never moves past either end", () => {
		const top = Viewport.init(10, 4);
		assert.strictEqual(Viewport.step(top, "up").cursor, 0);
		assert.strictEqual(Viewport.step(top, "pageup").cursor, 0);
		const bottom = Viewport.step(top, "end");
		assert.strictEqual(bottom.cursor, 9);
		assert.strictEqual(Viewport.step(bottom, "down").cursor, 9, "no wrap to the top");
		assert.strictEqual(Viewport.step(bottom, "pagedown").cursor, 9);
		assert.strictEqual(Viewport.step(bottom, "home").cursor, 0);
		assert.strictEqual(Viewport.step(top, "pagedown").cursor, 4, "a page is the height");
	});

	it("binds every move, and its help reads ↑/↓ move", () => {
		for (const move of MOVES) assert.isTrue(Viewport.keys.match({ _tag: "Named", name: move })._tag === "Some", move);
	});
});

const items = (count: number, prefix = "item", width = 0): ReadonlyArray<ViewportRow> =>
	Array.from({ length: count }, (_, index) => ({
		_tag: "Item" as const,
		key: `${prefix}${index}`.padEnd(width, "-"),
	}));

const renderRow = (row: ViewportRow, highlighted: boolean): ReactElement =>
	createElement(Text, null, row._tag === "Header" ? `# ${row.label}` : `${highlighted ? ">" : " "} ${row.key}`);

/** A screen scrolling `rows` with the viewport's own keys, at `height` lines unless the terminal is smaller. */
const scrolling =
	(rows: ReadonlyArray<ViewportRow>, height: number, reserved = 0): Screen<never> =>
	() => {
		const count = rows.filter((row) => row._tag === "Item").length;
		const Scroller = (): ReactElement => {
			const [state, setState] = useState(() => Viewport.init(count, height));
			useKeys(Viewport.keys, (move) => setState((current) => Viewport.step(current, move)));
			return createElement(Viewport.View, { rows, state, renderRow, reserved });
		};
		return createElement(Scroller);
	};

const lineCount = (frame: string): number =>
	frame.split("\n").filter((line, index, all) => !(index === all.length - 1 && line === "")).length;

describe("Viewport.View under CliUiTest", () => {
	it.effect("re-emits a section header scrolled off the top", () =>
		Effect.gen(function* () {
			const rows: ReadonlyArray<ViewportRow> = [
				{ _tag: "Header", label: "A" },
				...items(10, "a"),
				{ _tag: "Header", label: "B" },
				...items(20, "b"),
			];
			const handle = yield* CliUiTest.render(scrolling(rows, 6));
			assert.strictEqual((yield* handle.plainFrame).split("\n")[0], "# A");
			yield* handle.press("pagedown", "pagedown", "pagedown");
			const lines = (yield* handle.plainFrame).split("\n");
			assert.strictEqual(lines[0], "# B", "the header of the first visible item is shown first");
			assert.isTrue(
				lines.some((line) => line.startsWith(">")),
				"the cursor row is visible",
			);
		}).pipe(Effect.scoped),
	);

	it.effect("on a 10-row terminal, a 200-row viewport never draws a frame taller than 9 lines", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(scrolling(items(200), 50), { rows: 10 });
			yield* handle.press("down", "pagedown", "pagedown", "end", "up", "home");
			const frames = yield* handle.frames;
			assert.isAbove(frames.length, 3);
			for (const frame of frames) assert.isAtMost(lineCount(frame), 9, frame);
			assert.notInclude(yield* handle.rawFrame, CLEAR_SCROLLBACK);
			assert.include(yield* handle.plainFrame, "item0", "home brings the first row back");
		}).pipe(Effect.scoped),
	);

	it.effect("reserved lines come off the height", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(scrolling(items(200), 50, 3), { rows: 10 });
			assert.strictEqual(lineCount(yield* handle.plainFrame), 6);
		}).pipe(Effect.scoped),
	);

	it.effect("on a 20-column terminal no line is wider than 19 cells", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(scrolling(items(30, "a-very-long-row-name-", 60), 5), {
				columns: 20,
				rows: 10,
			});
			yield* handle.press("down", "pagedown");
			assert.include(yield* handle.plainFrame, "a-very", "the long rows were drawn");
			assert.strictEqual(lineCount(yield* handle.plainFrame), 5, "each long row is clipped to one line, not wrapped");
			for (const frame of yield* handle.frames) {
				for (const line of frame.split("\n")) assert.isAtMost(Fmt.width(CliUiTest.styled(line)), 19, line);
			}
			for (const line of (yield* handle.plainFrame).split("\n")) assert.isAtMost(Fmt.width(line), 19, line);
		}).pipe(Effect.scoped),
	);

	it.effect("KeyHelp for the viewport's keys reads ↑/↓ move", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(KeyHelp, { tables: [Viewport.keys] }));
			assert.include(yield* handle.plainFrame, "↑/↓ move");
		}).pipe(Effect.scoped),
	);
});

/** Run `screen` on the production render path: fake TTY streams, interactive, Ink's ordinary (non-debug) output. */
const production = (screen: Screen<never>, keys: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const fake = makeFakeStreams({ columns: 40, rows: 10 });
		const fiber = yield* Effect.forkChild(
			CliUi.run(screen).pipe(
				Effect.provideService(UiStreams, fake.streams),
				Effect.provideService(CliInteractive, true),
				Effect.provide(CliTheme.layerTest()),
			),
		);
		yield* Effect.suspend(() => (fake.rawModes.includes(true) ? Effect.void : Effect.fail("not yet"))).pipe(
			Effect.retry(Schedule.spaced("5 millis")),
			Effect.timeout("2 seconds"),
			Effect.orDie,
		);
		for (const key of keys) {
			fake.input(key);
			yield* Effect.sleep("40 millis");
		}
		yield* Fiber.interrupt(fiber);
		return fake.stdout();
	});

describe("the production render path (Ink's own output, not debug frames)", () => {
	it.live("control: an unclamped 200-line Text on a 10-row terminal does clear the scrollback", () =>
		Effect.gen(function* () {
			const tall = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
			const stdout = yield* production(() => createElement(Text, null, tall), []);
			assert.include(stdout, CLEAR_SCROLLBACK);
		}),
	);

	it.live("a 200-row viewport on a 10-row terminal never clears the scrollback, through scrolling and unmount", () =>
		Effect.gen(function* () {
			const stdout = yield* production(scrolling(items(200), 50), ["\u001b[B", "\u001b[6~", "\u001b[6~", "\u001b[F"]);
			assert.include(stdout, "item", "the viewport drew");
			assert.notInclude(stdout, CLEAR_SCROLLBACK);
			assert.notInclude(stdout, `${ESC}[2J`);
		}),
	);
});
