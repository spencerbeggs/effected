import { assert, describe, it } from "@effect/vitest";
import { Glyphs } from "../src/index.js";

describe("Glyphs", () => {
	it("unicode and ascii are distinct, tagged sets", () => {
		assert.strictEqual(Glyphs.unicode.kind, "unicode");
		assert.strictEqual(Glyphs.ascii.kind, "ascii");
		assert.strictEqual(Glyphs.unicode.ellipsis, "…");
		assert.strictEqual(Glyphs.ascii.ellipsis, "...");
		assert.strictEqual(Glyphs.unicode.arrow, "→");
		assert.strictEqual(Glyphs.ascii.arrow, "->");
	});

	it("the ascii set is ascii only, and every set has spinner frames", () => {
		const text = [Glyphs.ascii.ellipsis, Glyphs.ascii.bullet, Glyphs.ascii.arrow, ...Glyphs.ascii.spinner].join("");
		for (const ch of text) assert.isBelow(ch.codePointAt(0) ?? 0, 128);
		assert.isAbove(Glyphs.unicode.spinner.length, 0);
		assert.isAbove(Glyphs.ascii.spinner.length, 0);
	});
});
