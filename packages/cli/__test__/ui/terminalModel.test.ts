import { assert, describe, it } from "@effect/vitest";
import { screenAfter } from "../../src/ui/testing/terminalModel.js";

const ESC = String.fromCodePoint(0x1b);

describe("terminalModel: erase below", () => {
	it("blanks the rows below without shrinking the screen, so a later home still addresses the same top", () => {
		// Two visible rows; a and b have scrolled off. Home, erase below, home again, then draw X.
		const written = `a\nb\nc\nd${ESC}[1;1H${ESC}[J${ESC}[1;1HX`;
		// A real terminal keeps a and b in scrollback and draws X on the screen's first row. Shrinking the buffer on
		// erase would move the screen's top up a row, and X would overwrite b.
		assert.deepStrictEqual(screenAfter(written, 2), ["a", "b", "X"]);
	});

	it("keeps the cursor row's text left of the cursor", () => {
		assert.deepStrictEqual(screenAfter(`abc${ESC}[2G${ESC}[J`), ["a"]);
	});
});
