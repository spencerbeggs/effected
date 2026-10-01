import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Text, useInput } from "ink";
import type { ReactElement } from "react";
import { createElement, useState } from "react";
import { Styled, useGlyphs, useTerminalSize, useTheme } from "../../src/ui.js";
import type { CliUiTestView } from "../../src/ui-testing.js";
import { CliUiTest } from "../../src/ui-testing.js";

/** A display-only element: it never resolves a screen, and draws through the kit's theme hooks. */
const Status = (props: { readonly label: string }): ReactElement => {
	const glyphs = useGlyphs();
	return createElement(Styled, { token: "success" }, `${glyphs.kind} ${props.label}`);
};

describe("CliUiTest.view: a display-only element (A10)", () => {
	it.effect("mounts an element with the kit's providers, so Styled and the theme hooks work inside it", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.view(createElement(Status, { label: "ok" }), { glyphs: "ascii" });
			assert.strictEqual((yield* view.frame).trim(), "[success]ascii ok[/success]");
		}).pipe(Effect.scoped),
	);

	it.effect("the marker theme, colour and size options apply as for render", () =>
		Effect.gen(function* () {
			const Probe = (): ReactElement => {
				const theme = useTheme();
				const { columns } = useTerminalSize();
				return createElement(Text, null, `${theme.color} ${columns}`);
			};
			const view = yield* CliUiTest.view(createElement(Probe), { color: "256", columns: 40 });
			assert.strictEqual((yield* view.plainFrame).trim(), "256 39");
			yield* view.resize(60, 20);
			assert.strictEqual((yield* view.plainFrame).trim(), "256 59");
		}).pipe(Effect.scoped),
	);

	it.effect("rerender swaps the element, keeping every frame", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.view(createElement(Status, { label: "running" }));
			yield* view.rerender(createElement(Status, { label: "done" }));
			assert.include(yield* view.plainFrame, "done");
			const frames = yield* view.frames;
			assert.isTrue(frames.some((frame) => frame.includes("running")));
			assert.isTrue(frames.at(-1)?.includes("done"));
		}).pipe(Effect.scoped),
	);

	it.effect("press and type reach the element's own input handler", () =>
		Effect.gen(function* () {
			const Echo = (): ReactElement => {
				const [seen, setSeen] = useState("");
				useInput((input, key) => setSeen((previous) => previous + (key.downArrow ? "v" : input)));
				return createElement(Text, null, `seen:${seen}`);
			};
			const view = yield* CliUiTest.view(createElement(Echo));
			yield* view.type("ab");
			yield* view.press("down");
			yield* view.chunk({ char: "c" });
			assert.strictEqual((yield* view.plainFrame).trim(), "seen:abvc");
		}).pipe(Effect.scoped),
	);

	it.effect("closing the scope unmounts it, so the next view mounts", () =>
		Effect.gen(function* () {
			yield* Effect.scoped(CliUiTest.view(createElement(Status, { label: "first" })));
			const second = yield* Effect.scoped(
				Effect.flatMap(CliUiTest.view(createElement(Status, { label: "second" })), (view) => view.plainFrame),
			);
			assert.include(second, "second");
		}),
	);

	it("the handle has no result: a display-only element never ends on its own (type-level)", () => {
		const hasResult: "result" extends keyof CliUiTestView ? true : false = false;
		const hasRerender: "rerender" extends keyof CliUiTestView ? true : false = true;
		assert.isFalse(hasResult);
		assert.isTrue(hasRerender);
	});
});
