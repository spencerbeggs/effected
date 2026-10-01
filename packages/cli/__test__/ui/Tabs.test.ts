import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Option, Schedule } from "effect";
import { Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { CliInteractive, CliTheme, Fmt } from "../../src/index.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { Screen, TabsProps } from "../../src/ui.js";
import { CliUi, Tabs, UiStreams } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

type Name = "alpha" | "beta" | "gamma";
const three: TabsProps<Name>["tabs"] = [
	{ name: "alpha", label: "Alpha" },
	{ name: "beta", label: "Beta" },
	{ name: "gamma", label: "Gamma" },
];

/** A screen hosting Tabs with `props`, recording every onChange. */
const hosting =
	<N extends string>(props: TabsProps<N>, calls: Array<readonly [N, number]>): Screen<never> =>
	() =>
		createElement(Tabs.View<N>, { ...props, onChange: (name: N, index: number) => calls.push([name, index]) });

/** The label drawn as the active tab: the one in the accent token. */
const active = (frame: string): string | undefined => /\[accent\](?:\[b\]|\[u\])*([^[]+)/.exec(frame)?.[1]?.trim();

describe("Tabs reducer and keys", () => {
	it("wraps at both ends, jumps in range, and ignores an out-of-range jump", () => {
		assert.strictEqual(Tabs.step(2, 3, "next"), 0);
		assert.strictEqual(Tabs.step(0, 3, "prev"), 2);
		assert.strictEqual(Tabs.step(0, 3, { jump: 2 }), 2);
		assert.strictEqual(Tabs.step(1, 3, { jump: 3 }), 1, "no fourth tab");
		assert.strictEqual(Tabs.step(1, 3, { jump: -1 }), 1);
		assert.strictEqual(Tabs.step(0, 0, "next"), 0, "no tabs, nothing moves");
	});

	it("binds the arrows, tab and shift+tab, and plain digits with 0 as the tenth", () => {
		const match = (key: Parameters<typeof Tabs.keys.match>[0]) => Tabs.keys.match(key);
		assert.deepStrictEqual(match({ _tag: "Named", name: "right" }), Option.some("next"));
		assert.deepStrictEqual(match({ _tag: "Named", name: "left" }), Option.some("prev"));
		assert.deepStrictEqual(match({ _tag: "Named", name: "tab" }), Option.some("next"));
		assert.deepStrictEqual(match({ _tag: "Named", name: "shift+tab" }), Option.some("prev"));
		assert.deepStrictEqual(match({ _tag: "Char", char: "2" }), Option.some({ jump: 1 }));
		assert.deepStrictEqual(match({ _tag: "Char", char: "0" }), Option.some({ jump: 9 }));
		assert.isTrue(Option.isNone(match({ _tag: "Named", name: "down" })), "↓ is a column key");
		assert.deepStrictEqual(Tabs.columnKeys.match({ _tag: "Named", name: "down" }), Option.some("next"));
		assert.deepStrictEqual(Tabs.columnKeys.match({ _tag: "Named", name: "up" }), Option.some("prev"));
	});
});

describe("Tabs.View, uncontrolled", () => {
	it.effect("onChange fires once on mount with the default, then on each change; right wraps; 2 jumps", () =>
		Effect.gen(function* () {
			const calls: Array<readonly [Name, number]> = [];
			const handle = yield* CliUiTest.render(hosting({ tabs: three, defaultValue: "beta" }, calls));
			assert.deepStrictEqual(calls, [["beta", 1]], "the initial value, once");
			assert.strictEqual(active(yield* handle.frame), "Beta");
			yield* handle.press("right", "right");
			assert.strictEqual(active(yield* handle.frame), "Alpha", "wrapped past the end");
			yield* handle.type("3");
			assert.strictEqual(active(yield* handle.frame), "Gamma");
			assert.deepStrictEqual(calls, [
				["beta", 1],
				["gamma", 2],
				["alpha", 0],
				["gamma", 2],
			]);
		}).pipe(Effect.scoped),
	);

	it.effect("tab and shift+tab cycle while focused", () =>
		Effect.gen(function* () {
			const calls: Array<readonly [Name, number]> = [];
			const handle = yield* CliUiTest.render(hosting({ tabs: three }, calls));
			assert.strictEqual(active(yield* handle.frame), "Alpha", "the first tab without a default");
			yield* handle.press("tab");
			assert.strictEqual(active(yield* handle.frame), "Beta");
			yield* handle.press("shift+tab", "shift+tab");
			assert.strictEqual(active(yield* handle.frame), "Gamma");
		}).pipe(Effect.scoped),
	);

	it.effect("unfocused, keys are ignored and every tab is muted", () =>
		Effect.gen(function* () {
			const calls: Array<readonly [Name, number]> = [];
			const handle = yield* CliUiTest.render(hosting({ tabs: three, isFocused: false }, calls));
			yield* handle.press("right", "tab");
			yield* handle.type("2");
			assert.deepStrictEqual(calls, [["alpha", 0]], "only the mount call");
			const frame = yield* handle.frame;
			assert.notInclude(frame, "[accent]");
			assert.include(frame, "[muted]");
		}).pipe(Effect.scoped),
	);
});

describe("Tabs.View, controlled", () => {
	it.effect("shows value; a key calls onChange but moves nothing until value changes", () =>
		Effect.gen(function* () {
			const calls: Array<readonly [Name, number]> = [];
			const handle = yield* CliUiTest.render(hosting({ tabs: three, value: "alpha" }, calls));
			yield* handle.press("right");
			assert.deepStrictEqual(calls, [
				["alpha", 0],
				["beta", 1],
			]);
			assert.strictEqual(active(yield* handle.frame), "Alpha", "still the controlled value");
			yield* handle.rerender(hosting({ tabs: three, value: "beta" }, calls));
			assert.strictEqual(active(yield* handle.frame), "Beta");
		}).pipe(Effect.scoped),
	);
});

describe("Tabs.View drawing", () => {
	it.effect(
		"the active tab is accent, bold and underlined; the separator follows the glyph set; showIndex numbers",
		() =>
			Effect.gen(function* () {
				const unicode = yield* Effect.scoped(
					Effect.flatMap(CliUiTest.render(hosting({ tabs: three }, [])), (handle) =>
						Effect.all([handle.frame, handle.plainFrame]),
					),
				);
				// The modifiers may nest in either order around the colour, so read what opens before the active label.
				const opened = unicode[0].slice(0, unicode[0].indexOf("Alpha"));
				for (const tag of ["[accent]", "[b]", "[u]"]) assert.include(opened, tag, unicode[0]);
				const rest = unicode[0].slice(unicode[0].indexOf("Alpha"));
				assert.notMatch(rest, /\[(?:accent|b|u)\]Beta/, "an inactive tab is plain");
				assert.strictEqual(unicode[1].trim(), "Alpha │ Beta │ Gamma");
				const ascii = yield* Effect.scoped(
					Effect.flatMap(
						CliUiTest.render(hosting({ tabs: three, showIndex: true }, []), { glyphs: "ascii" }),
						(handle) => handle.plainFrame,
					),
				);
				assert.strictEqual(ascii.trim(), "1. Alpha | 2. Beta | 3. Gamma");
			}),
	);

	it.effect("a column of tabs moves with ↑/↓", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(hosting({ tabs: three, direction: "column" }, []));
			assert.deepStrictEqual(
				(yield* handle.plainFrame)
					.trimEnd()
					.split("\n")
					.map((line) => line.trim()),
				["Alpha", "Beta", "Gamma"],
			);
			yield* handle.press("down");
			assert.strictEqual(active(yield* handle.frame), "Beta");
		}).pipe(Effect.scoped),
	);

	it.effect("tabs wider than a 20-column terminal stay on one line around the active tab", () =>
		Effect.gen(function* () {
			const many = Array.from({ length: 6 }, (_, index) => ({ name: `t${index}`, label: `Section ${index}` }));
			const handle = yield* CliUiTest.render(hosting({ tabs: many }, []), { columns: 20, color: "none" });
			const check = (expected: string) =>
				Effect.gen(function* () {
					const lines = (yield* handle.plainFrame).trimEnd().split("\n");
					assert.lengthOf(lines, 1, lines.join(" / "));
					assert.isAtMost(Fmt.width(lines[0] ?? ""), 19, lines[0]);
					assert.include(lines[0], expected);
				});
			yield* check("Section 0");
			yield* handle.type("6");
			yield* check("Section 5");
		}).pipe(Effect.scoped),
	);
});

describe("Tabs input", () => {
	it.live("adds no keypress or data listener, and no second readable listener, to stdin", () =>
		Effect.gen(function* () {
			const listeners = (screen: Screen<never>) =>
				Effect.gen(function* () {
					const fake = makeFakeStreams();
					const stdin = fake.streams.stdin;
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
					const counts = ["keypress", "data", "readable"].map((event) => stdin.listenerCount(event));
					yield* Fiber.interrupt(fiber);
					return counts;
				});
			const baseline = yield* listeners(() => createElement(Text, null, "no tabs"));
			const withTabs = yield* listeners(hosting({ tabs: three }, []));
			assert.deepStrictEqual(baseline.slice(0, 2), [0, 0], "Ink itself reads through readable");
			assert.deepStrictEqual(withTabs, baseline);
		}),
	);
});

/** Unused: keeps ReactElement imported for the hosting helper's inferred types. */
export type Element = ReactElement;
