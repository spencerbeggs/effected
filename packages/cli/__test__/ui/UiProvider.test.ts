import { assert, describe, it } from "@effect/vitest";
import { TerminalEnv } from "@effected/env";
import { Effect, Exit, Layer, Option } from "effect";
import { Box, Text, render, renderToString } from "ink";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { CliTheme } from "../../src/CliTheme.js";
import { withInkColour } from "../../src/ui/internal/ink.js";
import { useScreenCancel } from "../../src/ui/internal/ScreenContext.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { UiContextValue } from "../../src/ui.js";
import { CliUi, Styled, UiProvider, useGlyphs, useTerminalSize, useTheme } from "../../src/ui.js";

/** A truecolor terminal and a theme whose accent token is one unmistakable colour, with ASCII glyphs. */
const themeLayer = CliTheme.layer({ tokens: { accent: { fg: "#123456" } }, glyphs: "ascii" }).pipe(
	Layer.provide(
		TerminalEnv.layerTest({
			stdinIsTerminal: true,
			stdout: { isTerminal: true, color: "truecolor", hyperlinks: false, columns: Option.some(80) },
			stderr: { isTerminal: true, color: "truecolor", hyperlinks: false, columns: Option.some(80) },
		}),
	),
);

/** The SGR truecolor opener of `#123456`. */
const ACCENT = "\u001b[38;2;18;52;86m";

/** Mount `tree` with Ink's own `render` on fake streams, in debug mode, unmount it, and return stdout and the exit. */
const mountPlain = (
	tree: ReactNode,
	size: { readonly columns: number; readonly rows: number } = { columns: 80, rows: 24 },
) =>
	Effect.gen(function* () {
		const fake = makeFakeStreams(size);
		const instance = render(tree, {
			stdin: fake.streams.stdin,
			stdout: fake.streams.stdout,
			stderr: fake.streams.stderr,
			debug: true,
			patchConsole: false,
			exitOnCtrlC: false,
		});
		instance.unmount();
		const exit = yield* Effect.exit(Effect.tryPromise(() => instance.waitUntilExit()));
		return { stdout: fake.stdout(), exit };
	});

const Probe = (): ReactElement => {
	const theme = useTheme();
	const glyphs = useGlyphs();
	return createElement(
		Box,
		{ flexDirection: "column" },
		createElement(Styled, { token: "accent" }, "marked"),
		createElement(Text, null, `glyphs=${glyphs.kind} color=${theme.color}`),
	);
};

const Size = (): ReactElement => {
	const { columns, rows } = useTerminalSize();
	return createElement(Text, null, `size=${columns}x${rows}`);
};

const provided = (value: UiContextValue, child: ReactElement): ReactElement =>
	createElement(UiProvider, { value }, child);

describe("UiProvider: the kit's hooks in a tree the kit did not mount", () => {
	it.effect("useTheme, useGlyphs and Styled render the theme's tokens under Ink's own render", () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context;
			yield* withInkColour(value.theme.color);
			const { stdout, exit } = yield* mountPlain(provided(value, createElement(Probe)));
			assert.isTrue(Exit.isSuccess(exit), String(exit));
			assert.include(stdout, `${ACCENT}marked`);
			assert.include(stdout, "glyphs=ascii color=truecolor");
		}).pipe(Effect.scoped, Effect.provide(themeLayer)),
	);

	it.effect("control: without the provider the same component throws the outside-a-screen error", () =>
		Effect.gen(function* () {
			yield* CliUi.context;
			const { exit } = yield* mountPlain(createElement(Probe));
			assert.isTrue(Exit.isFailure(exit));
			assert.include(String(exit), "outside a screen");
		}).pipe(Effect.provide(themeLayer)),
	);

	it.effect("useScreenCancel is a no-op under the provider, where there is no screen to cancel", () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context;
			const Cancels = (): ReactElement => {
				useScreenCancel()("escape");
				return createElement(Text, null, "still here");
			};
			const { stdout, exit } = yield* mountPlain(provided(value, createElement(Cancels)));
			assert.isTrue(Exit.isSuccess(exit), String(exit));
			assert.include(stdout, "still here");
		}).pipe(Effect.provide(themeLayer)),
	);
});

describe("UiProvider's size override (probe L1)", () => {
	it.effect(
		"renderToString: useTerminalSize reads the override, not process.stdout, so it agrees with Ink's layout",
		() =>
			Effect.gen(function* () {
				const value = yield* CliUi.context;
				const out = renderToString(provided({ ...value, size: { columns: 30, rows: 8 } }, createElement(Size)), {
					columns: 30,
				});
				assert.strictEqual(out.trim(), "size=29x7");
			}).pipe(Effect.provide(themeLayer)),
	);

	it.effect("a live mount: the override wins over the stdout's size, and without it the stdout's is read", () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context;
			const overridden = yield* mountPlain(provided({ ...value, size: { columns: 30, rows: 8 } }, createElement(Size)));
			assert.include(overridden.stdout, "size=29x7");
			const control = yield* mountPlain(provided(value, createElement(Size)));
			assert.include(control.stdout, "size=79x23");
		}).pipe(Effect.provide(themeLayer)),
	);
});
