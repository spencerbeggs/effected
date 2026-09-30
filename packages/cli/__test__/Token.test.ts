import { assert, describe, it } from "@effect/vitest";
import { Token } from "../src/index.js";
import { nearest256, paintStyle } from "../src/internal/ansi.js";

describe("Token", () => {
	it("builds styles as data", () => {
		assert.deepStrictEqual(Token.hex("#e09a4e"), { fg: "#e09a4e" });
		assert.deepStrictEqual(Token.named("red"), { fg: "red" });
		assert.deepStrictEqual(Token.style({ bold: true }), { bold: true });
	});
});

describe("paintStyle", () => {
	it("is the identity at none, and for empty text", () => {
		assert.strictEqual(paintStyle({ fg: "red", bold: true }, "none", "x"), "x");
		assert.strictEqual(paintStyle({ fg: "red" }, "basic", ""), "");
	});

	it("basic uses 16-colour SGR with a per-attribute closer", () => {
		assert.strictEqual(paintStyle({ fg: "red" }, "basic", "x"), "\x1b[31mx\x1b[39m");
		assert.strictEqual(paintStyle({ fg: "brightCyan" }, "basic", "x"), "\x1b[96mx\x1b[39m");
	});

	it("truecolor uses 38;2;r;g;b", () => {
		assert.strictEqual(paintStyle(Token.hex("#e09a4e"), "truecolor", "x"), "\x1b[38;2;224;154;78mx\x1b[39m");
		assert.strictEqual(paintStyle(Token.hex("#fff"), "truecolor", "x"), "\x1b[38;2;255;255;255mx\x1b[39m");
	});

	it("256 uses the nearest 38;5;n, deterministically", () => {
		// Pure red is the cube corner (5,0,0); mid-gray is exactly on the grayscale ramp.
		assert.strictEqual(paintStyle(Token.hex("#ff0000"), "256", "x"), "\x1b[38;5;196mx\x1b[39m");
		assert.strictEqual(paintStyle(Token.hex("#808080"), "256", "x"), "\x1b[38;5;244mx\x1b[39m");
		assert.strictEqual(nearest256([224, 154, 78]), 173);
		assert.strictEqual(nearest256([224, 154, 78]), nearest256([224, 154, 78]));
	});

	it("basic maps a hex to the nearest of the 16 colours", () => {
		assert.strictEqual(paintStyle(Token.hex("#ff0000"), "basic", "x"), "\x1b[91mx\x1b[39m");
		assert.strictEqual(paintStyle(Token.hex("#000000"), "basic", "x"), "\x1b[30mx\x1b[39m");
	});

	it("an invalid hex paints no colour instead of failing", () => {
		assert.strictEqual(paintStyle(Token.hex("#zzz"), "truecolor", "x"), "x");
	});

	it("attributes close individually, innermost colour first", () => {
		assert.strictEqual(paintStyle({ fg: "red", bold: true }, "basic", "x"), "\x1b[1m\x1b[31mx\x1b[39m\x1b[22m");
		assert.strictEqual(paintStyle({ dim: true }, "basic", "x"), "\x1b[2mx\x1b[22m");
		assert.strictEqual(paintStyle({ italic: true, underline: true }, "basic", "x"), "\x1b[4m\x1b[3mx\x1b[23m\x1b[24m");
	});

	it("a painted span inside a painted span leaves the outer colour in force after it", () => {
		const inner = paintStyle({ fg: "green" }, "basic", "b");
		const outer = paintStyle({ fg: "red" }, "basic", `a${inner}c`);
		// After the inner 39 the outer red is opened again, so "c" stays red.
		assert.strictEqual(outer, "\x1b[31ma\x1b[32mb\x1b[39m\x1b[31mc\x1b[39m");
	});

	it("a different attribute nested inside a colour does not disturb it", () => {
		const inner = paintStyle({ bold: true }, "basic", "b");
		assert.strictEqual(paintStyle({ fg: "red" }, "basic", `a${inner}c`), "\x1b[31ma\x1b[1mb\x1b[22mc\x1b[39m");
	});
});
