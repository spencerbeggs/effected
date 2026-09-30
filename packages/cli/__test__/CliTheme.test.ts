import { assert, describe, it } from "@effect/vitest";
import { TerminalEnv } from "@effected/env";
import { ConfigProvider, Effect } from "effect";
import { Prompt } from "effect/cli";
import { CliTheme, Status, Token } from "../src/index.js";

const env = (color: "none" | "basic" | "256" | "truecolor") => TerminalEnv.layerTest({ stdout: { color } });

describe("CliTheme.paint", () => {
	it.effect("returns the text unchanged at none", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.paint("failure", "x"), "x");
			assert.strictEqual(theme.paint(Token.hex("#e09a4e"), "x"), "x");
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "none" }))),
	);

	it.effect("paints a token at basic, closing with its own code", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.paint("failure", "x"), "\x1b[31mx\x1b[39m");
			assert.strictEqual(theme.paint("success", "x"), "\x1b[32mx\x1b[39m");
			assert.strictEqual(theme.paint("error", "x"), "\x1b[1m\x1b[31mx\x1b[39m\x1b[22m");
			assert.strictEqual(theme.paint("muted", "x"), "\x1b[2mx\x1b[22m");
			assert.strictEqual(theme.paint("emphasis", "x"), "\x1b[1mx\x1b[22m");
			assert.strictEqual(theme.paint("accent", "x"), "\x1b[36mx\x1b[39m");
			assert.strictEqual(theme.paint("info", "x"), "\x1b[36mx\x1b[39m");
			assert.strictEqual(theme.paint("warning", "x"), "\x1b[33mx\x1b[39m");
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "basic" }))),
	);

	it.effect("paints an explicit style with truecolor", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.paint(Token.hex("#e09a4e"), "x"), "\x1b[38;2;224;154;78mx\x1b[39m");
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "truecolor" }))),
	);
});

describe("CliTheme.layer", () => {
	it.effect("reads the colour level from TerminalEnv: none paints plain", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.color, "none");
			assert.strictEqual(theme.paint("failure", "x"), "x");
		}).pipe(Effect.provide(CliTheme.layer({ glyphs: "unicode" })), Effect.provide(env("none"))),
	);

	it.effect("reads 256 from TerminalEnv", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.color, "256");
			assert.strictEqual(theme.paint(Token.hex("#ff0000"), "x"), "\x1b[38;5;196mx\x1b[39m");
		}).pipe(Effect.provide(CliTheme.layer({ glyphs: "unicode" })), Effect.provide(env("256"))),
	);

	it.effect("token overrides replace a default and leave the rest", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.paint("failure", "x"), "\x1b[35mx\x1b[39m");
			assert.strictEqual(theme.paint("success", "x"), "\x1b[32mx\x1b[39m");
		}).pipe(
			Effect.provide(CliTheme.layer({ glyphs: "unicode", tokens: { failure: Token.named("magenta") } })),
			Effect.provide(env("basic")),
		),
	);

	describe("glyphs auto", () => {
		const glyphsUnder = (term: Record<string, string>) =>
			Effect.gen(function* () {
				return (yield* CliTheme).glyphs.kind;
			}).pipe(
				Effect.provide(CliTheme.layer({ glyphs: "auto" })),
				Effect.provide(env("none")),
				Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(term)),
			);

		it.effect("is ascii only when TERM=dumb", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* glyphsUnder({ TERM: "dumb" }), "ascii");
				assert.strictEqual(yield* glyphsUnder({ TERM: "xterm-256color" }), "unicode");
				assert.strictEqual(yield* glyphsUnder({}), "unicode");
			}),
		);
	});

	it.effect("explicit glyphs ignore TERM", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* CliTheme).glyphs.kind, "ascii");
		}).pipe(
			Effect.provide(CliTheme.layer({ glyphs: "ascii" })),
			Effect.provide(env("none")),
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ TERM: "xterm" })),
		),
	);
});

describe("CliTheme.status", () => {
	it.effect("renders glyph and text at none, in unicode and in ascii", () =>
		Effect.gen(function* () {
			const unicode = yield* Effect.provide(CliTheme, CliTheme.layerTest({ color: "none", glyphs: "unicode" }));
			const ascii = yield* Effect.provide(CliTheme, CliTheme.layerTest({ color: "none", glyphs: "ascii" }));
			assert.strictEqual(unicode.status(Status.core, "failure", "boom"), "✗ boom");
			assert.strictEqual(ascii.status(Status.core, "failure", "boom"), "[FAIL] boom");
			assert.strictEqual(unicode.status(Status.core, "success"), "✓");
		}),
	);

	it.effect("paints the glyph with the status token, and supports an extended vocabulary", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.strictEqual(theme.status(Status.core, "failure", "boom"), "\x1b[31m✗\x1b[39m boom");
			const vocab = Status.extend({ timeout: { glyph: "⧖", ascii: "[time]", token: Token.hex("#e09a4e"), rank: 85 } });
			assert.strictEqual(theme.status(vocab, "timeout", "slow"), "\x1b[38;2;224;154;78m⧖\x1b[39m slow");
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "truecolor" }))),
	);
});

describe("CliTheme.promptTheme", () => {
	const promptThemeUnder = (color: "none" | "basic", glyphs: "unicode" | "ascii" = "unicode") =>
		Effect.gen(function* () {
			return yield* Prompt.Theme;
		}).pipe(Effect.provide(CliTheme.promptTheme), Effect.provide(CliTheme.layerTest({ color, glyphs })));

	it.effect("has empty colour fields when colour is none", () =>
		Effect.gen(function* () {
			const theme = yield* promptThemeUnder("none");
			for (const field of ["primaryColor", "mutedColor", "successColor", "errorColor", "submittedColor"] as const) {
				assert.strictEqual(theme[field], "", field);
			}
		}),
	);

	it.effect("carries raw SGR openers from the tokens otherwise", () =>
		Effect.gen(function* () {
			const theme = yield* promptThemeUnder("basic");
			assert.strictEqual(theme.primaryColor, "\x1b[36m");
			assert.strictEqual(theme.successColor, "\x1b[32m");
			assert.strictEqual(theme.errorColor, "\x1b[1m\x1b[31m");
			assert.strictEqual(theme.mutedColor, "\x1b[2m");
		}),
	);

	it.effect("takes its ellipsis from the glyph set", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* promptThemeUnder("none", "ascii")).ellipsis, "...");
			assert.strictEqual((yield* promptThemeUnder("none", "unicode")).ellipsis, "…");
		}),
	);
});
