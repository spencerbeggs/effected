import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Cancelled } from "../../src/index.js";
import type { UiKey } from "../../src/ui.js";
import { TextInput } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

const char = (c: string): UiKey => ({ _tag: "Char", char: c });
const named = (name: "left" | "right" | "home" | "end" | "backspace" | "delete" | "space" | "enter"): UiKey => ({
	_tag: "Named",
	name,
});
const run = (keys: ReadonlyArray<UiKey>, initial?: string) =>
	keys.reduce((state, key) => TextInput.step(state, key), TextInput.init(initial === undefined ? {} : { initial }));

describe("TextInput reducer", () => {
	it("inserts characters at the cursor, q included", () => {
		const state = run([char("q"), char("u"), char("i"), char("t")]);
		assert.strictEqual(state.value, "quit");
		assert.strictEqual(state.cursor, 4);
	});

	it("starts at the end of the initial value", () => {
		assert.deepStrictEqual(TextInput.init({ initial: "abc" }), { value: "abc", cursor: 3, submitted: false });
	});

	it("moves the cursor and edits at it", () => {
		assert.strictEqual(run([named("left"), char("X")], "abc").value, "abXc");
		assert.strictEqual(run([named("home"), char("X")], "abc").value, "Xabc");
		assert.strictEqual(run([named("home"), named("end"), char("X")], "abc").value, "abcX");
		assert.strictEqual(run([named("left"), named("backspace")], "abc").value, "ac");
		assert.strictEqual(run([named("left"), named("left"), named("delete")], "abc").value, "ac");
		assert.strictEqual(run([named("space")], "a").value, "a ");
		assert.strictEqual(run([named("home"), named("left"), named("backspace")], "ab").value, "ab", "clamped");
		assert.strictEqual(run([named("right"), named("delete")], "ab").value, "ab", "clamped");
	});

	it("enter marks it submitted", () => {
		assert.isTrue(run([char("x"), named("enter")]).submitted);
	});
});

describe("TextInput.screen under CliUiTest", () => {
	it.effect('typing "quit" then enter returns "quit": q is text, not a cancel', () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(TextInput.screen({ message: "Name" }));
			yield* handle.type("quit");
			assert.include(yield* handle.plainFrame, "quit");
			yield* handle.press("enter");
			assert.strictEqual(yield* handle.result, "quit");
		}).pipe(Effect.scoped),
	);

	it.effect("Esc cancels with escape", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(TextInput.screen({ message: "Name" }));
			yield* handle.type("ab");
			yield* handle.press("escape");
			const error = yield* Effect.flip(handle.result);
			assert.strictEqual(error instanceof Cancelled ? error.reason : undefined, "escape");
		}).pipe(Effect.scoped),
	);

	it.effect("Ctrl-C cancels with interrupt", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(TextInput.screen({ message: "Name" }));
			yield* handle.press("ctrl+c");
			const error = yield* Effect.flip(handle.result);
			assert.strictEqual(error instanceof Cancelled ? error.reason : undefined, "interrupt");
		}).pipe(Effect.scoped),
	);

	it.effect("a failing validator blocks enter and shows its message as an error", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(
				TextInput.screen({
					message: "Port",
					validate: (value) => (/^\d+$/.test(value) ? undefined : "digits only"),
				}),
			);
			yield* handle.type("8x");
			yield* handle.press("enter");
			assert.include(yield* handle.frame, "[error]digits only[/error]");
			yield* handle.press("backspace");
			assert.notInclude(yield* handle.frame, "digits only", "editing clears the message");
			yield* handle.press("enter");
			assert.strictEqual(yield* handle.result, "8");
		}).pipe(Effect.scoped),
	);

	it.effect("shows the cursor with a glyph, so it stays visible at colour none", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(TextInput.screen({ message: "Name", initial: "ab" }), { color: "none" });
			assert.include(yield* handle.rawFrame, "ab▏");
			yield* handle.press("left");
			assert.include(yield* handle.rawFrame, "a▏b");
		}).pipe(Effect.scoped),
	);

	it.effect("shows the placeholder, muted, while the value is empty", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(TextInput.screen({ message: "Name", placeholder: "your name" }));
			assert.include(yield* handle.frame, "[muted]your name[/muted]");
			yield* handle.type("x");
			assert.notInclude(yield* handle.frame, "your name");
		}).pipe(Effect.scoped),
	);
});
