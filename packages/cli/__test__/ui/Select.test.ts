import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Cancelled, Fmt } from "../../src/index.js";
import type { SelectChoice } from "../../src/ui.js";
import { Select } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

const choices: ReadonlyArray<SelectChoice<string>> = [
	{ label: "alpha", value: "a", detail: "the first" },
	{ label: "beta", value: "b", disabled: true },
	{ label: "gamma", value: "c", detail: "the third" },
	{ label: "delta", value: "d" },
];

describe("Select reducer", () => {
	it("starts on the first enabled choice, or the initial one when it is enabled", () => {
		assert.strictEqual(Select.init(choices).viewport.cursor, 0);
		assert.strictEqual(Select.init(choices, { initial: 2 }).viewport.cursor, 2);
		assert.strictEqual(Select.init(choices, { initial: 1 }).viewport.cursor, 2, "a disabled initial moves on");
		assert.strictEqual(Select.init([{ label: "x", value: "x", disabled: true }, ...choices]).viewport.cursor, 1);
	});

	it("moves skip disabled choices, and stop at the ends", () => {
		const start = Select.init(choices);
		const down = Select.step(start, "down");
		assert.strictEqual(down.viewport.cursor, 2, "beta is skipped");
		assert.strictEqual(Select.step(down, "up").viewport.cursor, 0, "and skipped going back");
		assert.strictEqual(Select.step(start, "up").viewport.cursor, 0, "no wrap at the top");
		const end = Select.step(start, "end");
		assert.strictEqual(end.viewport.cursor, 3);
		assert.strictEqual(Select.step(end, "down").viewport.cursor, 3, "no wrap at the bottom");
		assert.strictEqual(Select.step(end, "home").viewport.cursor, 0);
	});

	it("submit marks the highlighted value chosen", () => {
		const state = Select.step(Select.step(Select.init(choices), "down"), "submit");
		assert.deepStrictEqual(Select.chosen(state), Option.some("c"));
		assert.isTrue(Option.isNone(Select.chosen(Select.init(choices))), "nothing is chosen before submit");
	});

	it("binds q to cancel, enter to submit, and the viewport's moves", () => {
		assert.deepStrictEqual(Select.keys.match({ _tag: "Char", char: "q" }), Option.some("cancel"));
		assert.deepStrictEqual(Select.keys.match({ _tag: "Named", name: "enter" }), Option.some("submit"));
		assert.deepStrictEqual(Select.keys.match({ _tag: "Named", name: "pagedown" }), Option.some("pagedown"));
	});
});

describe("Select.screen under CliUiTest", () => {
	it.effect("down, down, enter returns the value two enabled choices down", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(Select.screen({ message: "Pick one", choices }));
			yield* handle.press("down", "down", "enter");
			assert.strictEqual(yield* handle.result, "d");
		}).pipe(Effect.scoped),
	);

	it.effect("draws the message, the highlighted row in accent with the arrow, and its detail muted below", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(Select.screen({ message: "Pick one", choices }));
			const frame = yield* handle.frame;
			assert.include(frame, "Pick one");
			assert.include(frame, "[accent]→ alpha[/accent]");
			assert.include(frame, "[muted]the first[/muted]");
			assert.include(frame, "[muted]  beta[/muted]", "a disabled choice is muted");
			yield* handle.press("down");
			assert.include(yield* handle.frame, "[accent]→ gamma[/accent]");
			assert.include(yield* handle.frame, "[muted]the third[/muted]");
		}).pipe(Effect.scoped),
	);

	it.effect("q cancels with escape", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(Select.screen({ message: "Pick one", choices }));
			yield* handle.type("q");
			const error = yield* Effect.flip(handle.result);
			assert.instanceOf(error, Cancelled);
			assert.strictEqual(error instanceof Cancelled ? error.reason : undefined, "escape");
		}).pipe(Effect.scoped),
	);

	it.effect("on an 8-column terminal rows are cut with the ellipsis to 7 cells", () =>
		Effect.gen(function* () {
			const long: ReadonlyArray<SelectChoice<number>> = [
				{ label: "a very long choice", value: 1 },
				{ label: "another long one", value: 2 },
			];
			const handle = yield* CliUiTest.render(Select.screen({ message: "Pick", choices: long }), {
				columns: 8,
				color: "none",
			});
			const lines = (yield* handle.plainFrame).split("\n");
			assert.isTrue(
				lines.some((line) => line.includes("…") && line.includes("a ve")),
				lines.join(" / "),
			);
			for (const line of lines) assert.isAtMost(Fmt.width(line), 7, line);
		}).pipe(Effect.scoped),
	);
});
