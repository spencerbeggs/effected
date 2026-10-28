import { assert, describe, it } from "@effect/vitest";
import type { LineBreaks, SourcePosition } from "../src/index.js";
import { LineIndex } from "../src/index.js";

const lsp = (text: string) => LineIndex.make(text);

// Invisible and astral characters are built from code points, never written
// literally or as string escapes an editor can collapse.
const LS = String.fromCodePoint(0x2028);
const PS = String.fromCodePoint(0x2029);
const GRIN = String.fromCodePoint(0x1f600);
const HIGH_SURROGATE = String.fromCharCode(0xd83d);
const LOW_SURROGATE = String.fromCharCode(0xde00);

describe("LineIndex.make", () => {
	it("gives the empty text one empty line", () => {
		const index = lsp("");
		assert.strictEqual(index.lineCount, 1);
		assert.strictEqual(index.lineStart(0), 0);
		assert.strictEqual(index.lineEnd(0), 0);
		assert.strictEqual(index.lineText(0), "");
		assert.deepStrictEqual(index.positionAt(0), { line: 0, character: 0 });
		assert.strictEqual(index.offsetAt({ line: 0, character: 0 }), 0);
	});

	it("defaults to the lsp rule", () => {
		assert.strictEqual(lsp("a").lineBreaks, "lsp");
		assert.strictEqual(LineIndex.make("a", { lineBreaks: "lf" }).lineBreaks, "lf");
	});

	it("counts the empty line after a trailing terminator", () => {
		assert.strictEqual(lsp("a\n").lineCount, 2);
		assert.strictEqual(lsp("a\r\n").lineCount, 2);
		assert.strictEqual(lsp("a\r").lineCount, 2);
		assert.strictEqual(lsp("a").lineCount, 1);
	});

	it("ends a line at \\n, \\r\\n and a bare \\r under lsp", () => {
		const index = lsp("a\nbb\r\nccc\rd");
		assert.strictEqual(index.lineCount, 4);
		assert.deepStrictEqual(
			[0, 1, 2, 3].map((line) => index.lineText(line)),
			["a", "bb", "ccc", "d"],
		);
		assert.deepStrictEqual(
			[0, 1, 2, 3].map((line) => [index.lineStart(line), index.lineEnd(line)]),
			[
				[0, 1],
				[2, 4],
				[6, 9],
				[10, 11],
			],
		);
	});

	it("does not end a line at U+2028 or U+2029 under lsp", () => {
		const index = lsp(`a${LS}b${PS}c`);
		assert.strictEqual(index.lineCount, 1);
		assert.deepStrictEqual(index.positionAt(4), { line: 0, character: 4 });
	});

	it("ends a line at U+2028 and U+2029 under unicode, and still at \\r and \\r\\n", () => {
		const index = LineIndex.make(`a${LS}b${PS}c\rd\r\ne`, { lineBreaks: "unicode" });
		assert.strictEqual(index.lineCount, 5);
		assert.deepStrictEqual(
			[0, 1, 2, 3, 4].map((line) => index.lineText(line)),
			["a", "b", "c", "d", "e"],
		);
		assert.deepStrictEqual(index.positionAt(2), { line: 1, character: 0 });
	});

	it("treats a bare \\r as text under lf, but keeps \\r\\n one terminator", () => {
		const index = LineIndex.make("a\rb\r\nc", { lineBreaks: "lf" });
		assert.strictEqual(index.lineCount, 2);
		assert.strictEqual(index.lineText(0), "a\rb");
		assert.strictEqual(index.lineEnd(0), 3);
		assert.strictEqual(index.lineText(1), "c");
		assert.deepStrictEqual(index.positionAt(2), { line: 0, character: 2 });
		assert.deepStrictEqual(index.positionAt(5), { line: 1, character: 0 });
	});
});

describe("LineIndex.positionAt", () => {
	it("places the end-of-text offset on the last line", () => {
		assert.deepStrictEqual(lsp("a\nb").positionAt(3), { line: 1, character: 1 });
		assert.deepStrictEqual(lsp("a\n").positionAt(2), { line: 1, character: 0 });
	});

	it("places an offset at a terminator at the end of the line it ends", () => {
		assert.deepStrictEqual(lsp("ab\ncd").positionAt(2), { line: 0, character: 2 });
		assert.deepStrictEqual(lsp("ab\r\ncd").positionAt(2), { line: 0, character: 2 });
	});

	it("reads an offset inside a \\r\\n as the end of its line, never a negative character", () => {
		const index = lsp("ab\r\ncd");
		assert.deepStrictEqual(index.positionAt(3), { line: 0, character: 2 });
		assert.deepStrictEqual(index.positionAt(4), { line: 1, character: 0 });
	});

	it("counts UTF-16 code units, so an astral character is two", () => {
		const index = lsp(`${GRIN}x\n${GRIN}`);
		assert.deepStrictEqual(index.positionAt(2), { line: 0, character: 2 });
		assert.deepStrictEqual(index.positionAt(3), { line: 0, character: 3 });
		// the low half of the pair is a nameable position; LSP leaves it to the client
		assert.deepStrictEqual(index.positionAt(5), { line: 1, character: 1 });
		assert.deepStrictEqual(index.positionAt(6), { line: 1, character: 2 });
	});

	it("clamps an offset below 0 or past the end", () => {
		const index = lsp("ab\ncd");
		assert.deepStrictEqual(index.positionAt(-5), { line: 0, character: 0 });
		assert.deepStrictEqual(index.positionAt(99), { line: 1, character: 2 });
	});

	it("throws a RangeError for an offset that is not an integer", () => {
		const index = lsp("ab");
		for (const bad of [Number.NaN, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			assert.throws(() => index.positionAt(bad), RangeError);
			assert.throws(() => index.lineAt(bad), RangeError);
		}
	});
});

describe("LineIndex.offsetAt", () => {
	const index = lsp("ab\r\ncd\nef");

	it("maps a position inside the text to its offset", () => {
		assert.strictEqual(index.offsetAt({ line: 0, character: 1 }), 1);
		assert.strictEqual(index.offsetAt({ line: 1, character: 0 }), 4);
		assert.strictEqual(index.offsetAt({ line: 2, character: 2 }), 9);
	});

	it("clamps a character past the line to the line's end, before its terminator", () => {
		assert.strictEqual(index.offsetAt({ line: 0, character: 3 }), 2);
		assert.strictEqual(index.offsetAt({ line: 0, character: 50 }), 2);
		assert.strictEqual(index.offsetAt({ line: 1, character: 50 }), 6);
		assert.strictEqual(index.offsetAt({ line: 2, character: 50 }), 9);
	});

	it("clamps a negative character to the line's start", () => {
		assert.strictEqual(index.offsetAt({ line: 1, character: -3 }), 4);
	});

	it("reads a line below 0 as offset 0 and a line past the last as the end", () => {
		assert.strictEqual(index.offsetAt({ line: -1, character: 5 }), 0);
		assert.strictEqual(index.offsetAt({ line: 3, character: 0 }), 9);
		assert.strictEqual(index.offsetAt({ line: 300, character: -2 }), 9);
	});

	it("throws a RangeError for a line or character that is not an integer", () => {
		assert.throws(() => index.offsetAt({ line: Number.NaN, character: 0 }), RangeError);
		assert.throws(() => index.offsetAt({ line: 0, character: 0.5 }), RangeError);
	});
});

describe("LineIndex line accessors", () => {
	const index = lsp("ab\ncd");

	it("clamps a line number into the table", () => {
		assert.strictEqual(index.lineStart(-1), 0);
		assert.strictEqual(index.lineStart(9), 3);
		assert.strictEqual(index.lineEnd(9), 5);
		assert.strictEqual(index.lineText(9), "cd");
	});

	it("finds the line containing an offset", () => {
		assert.deepStrictEqual(
			[0, 1, 2, 3, 4, 5].map((offset) => index.lineAt(offset)),
			[0, 0, 0, 1, 1, 1],
		);
	});

	it("throws a RangeError for a line that is not an integer", () => {
		assert.throws(() => index.lineStart(Number.NaN), RangeError);
		assert.throws(() => index.lineText(0.5), RangeError);
	});
});

describe("LineIndex ranges", () => {
	const index = lsp("ab\r\ncd");

	it("converts a range to a span and back", () => {
		const span = index.spanOf({ offset: 1, length: 4 });
		assert.deepStrictEqual(span, { start: { line: 0, character: 1 }, end: { line: 1, character: 1 } });
		assert.deepStrictEqual(index.rangeOf(span), { offset: 1, length: 4 });
	});

	it("gives an empty range an empty span", () => {
		assert.deepStrictEqual(index.spanOf({ offset: 4, length: 0 }), {
			start: { line: 1, character: 0 },
			end: { line: 1, character: 0 },
		});
	});

	it("rejects a negative length and a reversed span", () => {
		assert.throws(() => index.spanOf({ offset: 2, length: -1 }), RangeError);
		assert.throws(
			() => index.rangeOf({ start: { line: 1, character: 0 }, end: { line: 0, character: 0 } }),
			RangeError,
		);
	});

	it("locates a range: the range unchanged plus its start position", () => {
		assert.deepStrictEqual(index.locationOf({ offset: 5, length: 1 }), {
			offset: 5,
			length: 1,
			line: 1,
			character: 1,
		});
	});

	it("guards a location's length as spanOf does", () => {
		for (const bad of [Number.NaN, 0.5, Number.POSITIVE_INFINITY, -1]) {
			assert.throws(() => index.locationOf({ offset: 2, length: bad }), RangeError, undefined, String(bad));
			assert.throws(() => index.spanOf({ offset: 2, length: bad }), RangeError, undefined, String(bad));
		}
		assert.deepStrictEqual(index.locationOf({ offset: 2, length: 0 }), { offset: 2, length: 0, line: 0, character: 2 });
	});
});

// ── Differential check against an independent oracle ───────────────────────
//
// The oracle splits the text with a regular expression and walks the pieces;
// it shares no code with LineIndex. Every string of up to six characters over
// an alphabet holding every terminator is checked at every offset and every
// position, which covers each pairing of terminators.

const TERMINATORS: Record<LineBreaks, RegExp> = {
	lsp: /\r\n|\r|\n/g,
	lf: /\r\n|\n/g,
	unicode: /\r\n|\r|\n|\u{2028}|\u{2029}/gu,
};

interface OracleLine {
	readonly start: number;
	readonly end: number;
}

const oracleLines = (text: string, breaks: LineBreaks): ReadonlyArray<OracleLine> => {
	const lines: OracleLine[] = [];
	let start = 0;
	for (const match of text.matchAll(TERMINATORS[breaks])) {
		lines.push({ start, end: match.index });
		start = match.index + match[0].length;
	}
	lines.push({ start, end: text.length });
	return lines;
};

const oraclePosition = (lines: ReadonlyArray<OracleLine>, offset: number): SourcePosition => {
	let line = 0;
	for (let i = 0; i < lines.length; i++) if ((lines[i] as OracleLine).start <= offset) line = i;
	const { start, end } = lines[line] as OracleLine;
	return { line, character: Math.min(offset, end) - start };
};

const ALPHABET = ["a", "\n", "\r", LS, HIGH_SURROGATE, LOW_SURROGATE];

const allStrings = (maxLength: number): ReadonlyArray<string> => {
	const out: string[] = [""];
	let frontier = [""];
	for (let length = 1; length <= maxLength; length++) {
		const next: string[] = [];
		for (const prefix of frontier) for (const ch of ALPHABET) next.push(prefix + ch);
		out.push(...next);
		frontier = next;
	}
	return out;
};

describe("LineIndex agrees with an independent oracle", () => {
	const corpus = allStrings(6);

	it("walks the expected corpus", () => {
		// 1 + 6 + 36 + ... + 6^6
		assert.strictEqual(corpus.length, 55987);
	});

	for (const breaks of ["lsp", "lf", "unicode"] as const) {
		it(`matches line tables, positions and round trips under ${breaks}`, () => {
			let checked = 0;
			for (const text of corpus) {
				const index = LineIndex.make(text, { lineBreaks: breaks });
				const lines = oracleLines(text, breaks);
				if (index.lineCount !== lines.length) assert.fail(`${JSON.stringify(text)}: line count`);
				for (let line = 0; line < lines.length; line++) {
					const expected = lines[line] as OracleLine;
					if (index.lineStart(line) !== expected.start || index.lineEnd(line) !== expected.end) {
						assert.fail(`${JSON.stringify(text)}: line ${line} bounds`);
					}
				}
				for (let offset = 0; offset <= text.length; offset++) {
					const position = index.positionAt(offset);
					const expected = oraclePosition(lines, offset);
					if (position.line !== expected.line || position.character !== expected.character) {
						assert.fail(
							`${JSON.stringify(text)} @${offset}: ${JSON.stringify(position)} != ${JSON.stringify(expected)}`,
						);
					}
					// a position maps back to the offset it came from, unless the offset sat
					// inside a terminator, where it maps to the terminator's start
					const back = index.offsetAt(position);
					const terminatorStart = (lines[position.line] as OracleLine).end;
					if (back !== Math.min(offset, terminatorStart)) {
						assert.fail(`${JSON.stringify(text)} @${offset}: round trip ${back}`);
					}
					checked++;
				}
			}
			assert.isAbove(checked, 300000);
		});
	}
});
