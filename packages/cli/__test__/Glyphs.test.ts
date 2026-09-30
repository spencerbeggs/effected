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

	it("carries a path separator per audience and a spinner interval", () => {
		assert.strictEqual(Glyphs.unicode.pathSeparator.human, "›");
		assert.strictEqual(Glyphs.unicode.pathSeparator.agent, " > ");
		assert.strictEqual(Glyphs.ascii.pathSeparator.human, ">");
		assert.strictEqual(Glyphs.ascii.pathSeparator.agent, " > ");
		assert.strictEqual(Glyphs.unicode.spinnerIntervalMs, 80);
		assert.strictEqual(Glyphs.ascii.spinnerIntervalMs, 80);
	});

	it("the ascii separators are ascii only", () => {
		for (const ch of Glyphs.ascii.pathSeparator.human + Glyphs.ascii.pathSeparator.agent) {
			assert.isBelow(ch.codePointAt(0) ?? 0, 128);
		}
	});

	it("the shared sets cannot be edited through their nested values", () => {
		for (const set of [Glyphs.unicode, Glyphs.ascii]) {
			assert.isTrue(Object.isFrozen(set));
			assert.isTrue(Object.isFrozen(set.pathSeparator));
			assert.isTrue(Object.isFrozen(set.spinner));
		}
	});
});
