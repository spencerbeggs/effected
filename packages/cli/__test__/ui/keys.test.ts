import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Text, useInput } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { Glyphs } from "../../src/index.js";
import type { KeyName, Screen, UiKey as UiKeyType } from "../../src/ui.js";
import { KeyHelp, KeyTable, UiKey, useKeys } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

/** A screen that records what `UiKey.fromInk` makes of every input Ink delivers. */
const recording = (seen: Array<UiKeyType | undefined>): Screen<never> => {
	const Recorder = (): ReactElement => {
		useInput((input, key) => {
			seen.push(UiKey.fromInk(input, key));
		});
		return createElement(Text, null, "recording");
	};
	return () => createElement(Recorder);
};

const named = (name: KeyName): UiKeyType => ({ _tag: "Named", name });

describe("UiKey.fromInk", () => {
	it.effect("names every key Ink reports, from the bytes a terminal sends", () =>
		Effect.gen(function* () {
			const keys: ReadonlyArray<KeyName> = [
				"up",
				"down",
				"left",
				"right",
				"enter",
				"space",
				"tab",
				"shift+tab",
				"backspace",
				"delete",
				"home",
				"end",
				"pageup",
				"pagedown",
			];
			const seen: Array<UiKeyType | undefined> = [];
			const handle = yield* CliUiTest.render(recording(seen));
			yield* handle.press(...keys);
			assert.deepStrictEqual(seen, keys.map(named));
		}).pipe(Effect.scoped),
	);

	it.effect("names Esc and Ctrl-C, which also end the screen", () =>
		Effect.gen(function* () {
			for (const key of ["escape", "ctrl+c"] as const) {
				const seen: Array<UiKeyType | undefined> = [];
				yield* Effect.scoped(
					Effect.gen(function* () {
						const handle = yield* CliUiTest.render(recording(seen));
						yield* handle.press(key);
						yield* Effect.flip(handle.result);
					}),
				);
				assert.deepStrictEqual(seen, [named(key)], key);
			}
		}),
	);

	it.effect("gives a printable character as Char, and space as Named, never Char", () =>
		Effect.gen(function* () {
			const seen: Array<UiKeyType | undefined> = [];
			const handle = yield* CliUiTest.render(recording(seen));
			yield* handle.type("q Z");
			assert.deepStrictEqual(seen, [{ _tag: "Char", char: "q" }, named("space"), { _tag: "Char", char: "Z" }]);
		}).pipe(Effect.scoped),
	);
});

type Action = "move-up" | "move-down" | "toggle" | "quit" | "secret";

const table = KeyTable.make<Action>([
	{ keys: ["up"], action: "move-up", help: "move" },
	{ keys: ["down"], action: "move-down", help: "move" },
	{ keys: ["space", { char: "x" }], action: "toggle", help: "toggle" },
	{ keys: ["space"], action: "quit", help: "never reached" },
	{ keys: [{ char: "q" }], action: "quit", help: "quit" },
	{ keys: ["tab"], action: "secret", help: "hidden", hidden: true },
]);

describe("KeyTable", () => {
	it("matches the first binding for a key, and nothing for an unbound one", () => {
		assert.deepStrictEqual(table.match(named("space")), Option.some("toggle"));
		assert.deepStrictEqual(table.match({ _tag: "Char", char: "x" }), Option.some("toggle"));
		assert.deepStrictEqual(table.match({ _tag: "Char", char: "q" }), Option.some("quit"));
		assert.deepStrictEqual(table.match(named("tab")), Option.some("secret"), "hidden bindings still match");
		assert.isTrue(Option.isNone(table.match(named("enter"))));
		assert.isTrue(Option.isNone(table.match({ _tag: "Char", char: "Q" })), "characters match exactly");
	});

	it("labels help from the glyph set: arrows under Unicode, words under ASCII, hidden bindings omitted", () => {
		const unicode = table.help(Glyphs.unicode);
		const ascii = table.help(Glyphs.ascii);
		assert.deepStrictEqual(
			unicode.map((row) => row.label),
			["↑", "↓", "space/x", "space", "q"],
		);
		assert.deepStrictEqual(
			ascii.map((row) => row.label),
			["up", "down", "space/x", "space", "q"],
		);
		assert.notInclude(
			unicode.map((row) => row.help),
			"hidden",
		);
	});

	it("the root table cancels with escape on Esc (help: cancel) and interrupt on Ctrl-C (hidden)", () => {
		assert.deepStrictEqual(KeyTable.root.match(named("escape")), Option.some("escape"));
		assert.deepStrictEqual(KeyTable.root.match(named("ctrl+c")), Option.some("interrupt"));
		assert.isTrue(Option.isNone(KeyTable.root.match({ _tag: "Char", char: "q" })), "q is never a root key");
		assert.deepStrictEqual(KeyTable.root.help(Glyphs.unicode), [{ label: "esc", help: "cancel" }]);
	});
});

describe("useKeys and KeyHelp", () => {
	it.effect("useKeys dispatches the matched action, and nothing for an unbound key", () =>
		Effect.gen(function* () {
			const dispatched: Array<Action> = [];
			const Keys = (): ReactElement => {
				useKeys(table, (action) => {
					dispatched.push(action);
				});
				return createElement(Text, null, "keys");
			};
			const handle = yield* CliUiTest.render(() => createElement(Keys));
			yield* handle.press("down", "space", "enter", "up");
			yield* handle.type("q");
			assert.deepStrictEqual(dispatched, ["move-down", "toggle", "move-up", "quit"]);
		}).pipe(Effect.scoped),
	);

	it.effect("useKeys dispatches nothing while inactive", () =>
		Effect.gen(function* () {
			const dispatched: Array<Action> = [];
			const Keys = (): ReactElement => {
				useKeys(table, (action) => dispatched.push(action), { isActive: false });
				return createElement(Text, null, "keys");
			};
			const handle = yield* CliUiTest.render(() => createElement(Keys));
			yield* handle.press("down", "space");
			assert.deepStrictEqual(dispatched, []);
		}).pipe(Effect.scoped),
	);

	it.effect("KeyHelp names every visible binding, then the root's esc cancel, and no hidden one", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(KeyHelp, { tables: [table] }));
			const line = (yield* handle.plainFrame).trim();
			for (const row of table.help(Glyphs.unicode)) {
				assert.include(line, `${row.label} ${row.help}`, row.label);
			}
			assert.notInclude(line, "hidden");
			assert.isTrue(line.endsWith("esc cancel"), line);
			assert.include(yield* handle.frame, "[muted]", "the help line is painted muted");
		}).pipe(Effect.scoped),
	);

	it.effect("KeyHelp under ASCII glyphs labels with words", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(KeyHelp, { tables: [table] }), { glyphs: "ascii" });
			const line = (yield* handle.plainFrame).trim();
			assert.include(line, "up move");
			assert.notInclude(line, "↑");
		}).pipe(Effect.scoped),
	);
});
