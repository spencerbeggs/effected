// `prefixWidths` segments a line once where MD060 used to measure every
// divider's prefix on its own: it must give exactly `stringWidth` of each
// prefix, at grapheme boundaries and inside clusters alike.

import { assert, describe, it } from "@effect/vitest";
import { prefixWidths, stringWidth } from "../src/internal/string-width.js";

const samples = [
	"",
	"| a | b |",
	"| 漢字 | v1 | 漢字 |",
	"| 👩‍👩‍👧 | 🇺🇸🇬🇧 | 1️⃣ |",
	"| é | é | ก่ |",
	"| ؀123 | ؀ |",
	"| 한국어 | 각 |",
	"| ａｂ | 　 |",
	"a‍b|c",
	"|\t| |",
];

describe("prefixWidths", () => {
	it("is stringWidth of each prefix, at every offset of every sample", () => {
		for (const text of samples) {
			const offsets = Array.from({ length: text.length + 2 }, (_, offset) => offset);
			assert.deepStrictEqual(
				prefixWidths(text, offsets),
				offsets.map((offset) => stringWidth(text.slice(0, offset))),
				JSON.stringify(text),
			);
		}
	});
});
