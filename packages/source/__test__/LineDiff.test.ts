import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import type { LineDiffHunk } from "../src/index.js";
import { LineDiff } from "../src/index.js";

const splitLines = (text: string): Array<string> =>
	text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

/** Test-local oracle: rebuild `after` from `before` and the hunks. */
const applyHunks = (before: string, hunks: ReadonlyArray<LineDiffHunk>): string => {
	const old = splitLines(before);
	const out: Array<string> = [];
	let cursor = 0;
	for (const hunk of hunks) {
		const consumed = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
		while (cursor < consumed) out.push(old[cursor++] ?? "");
		for (const line of hunk.lines) {
			if (line.kind === "add") out.push(line.text);
			else {
				if (line.kind === "context") out.push(line.text);
				cursor++;
			}
		}
	}
	while (cursor < old.length) out.push(old[cursor++] ?? "");
	return out.map((line) => `${line}\n`).join("");
};

const manyLines = (prefix: string, count: number): string =>
	Array.from({ length: count }, (_, index) => `${prefix}${index}`).join("\n");

const twenty = Array.from({ length: 20 }, (_, index) => `line${index}`);
const twentyChangedEnds = twenty.map((line, index) => (index === 0 || index === 19 ? `${line}!` : line));

const linesArb = Schema.Array(Schema.Literals(["a", "b", "c", "", "\r"])).pipe(Schema.check(Schema.isMaxLength(12)));
const join = (lines: ReadonlyArray<string>): string => lines.map((line) => `${line}\n`).join("");

describe("LineDiff", () => {
	it("identical input yields no hunks", () => assert.deepStrictEqual(LineDiff.compute("a\nb\n", "a\nb\n"), []));

	it("reports 1-based lines with context", () => {
		const [hunk] = LineDiff.compute("a\nb\nc\n", "a\nX\nc\n");
		assert.deepStrictEqual(
			hunk?.lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine]),
			[
				["context", "a", 1, 1],
				["remove", "b", 2, undefined],
				["add", "X", undefined, 2],
				["context", "c", 3, 3],
			],
		);
	});

	it("empty before is all additions", () => assert.strictEqual(LineDiff.compute("", "a\nb\n")[0]?.oldLines, 0));

	it("distant changes make separate hunks", () =>
		assert.strictEqual(LineDiff.compute(twenty.join("\n"), twentyChangedEnds.join("\n")).length, 2));

	it("a CRLF difference stays visible", () => {
		const hunks = LineDiff.compute("a\r\nb", "a\nb");
		assert.strictEqual(hunks.length, 1);
		assert.deepStrictEqual(
			hunks[0]?.lines.filter((l) => l.kind !== "context").map((l) => [l.kind, l.text]),
			[
				["remove", "a\r"],
				["add", "a"],
			],
		);
	});

	it("unified output is parseable git-style text", () => {
		const hunks = LineDiff.compute("a\nb\nc\n", "a\nX\nc\n");
		const text = LineDiff.unified(hunks, { before: "a", after: "b" });
		assert.include(text, "@@ -1,3 +1,3 @@");
		assert.include(text, "--- a\n+++ b\n");
		assert.include(text, "-b\n+X\n");
	});

	it("falls back to a replace block past maxEditDistance", () => {
		const hunks = LineDiff.compute("a\nb\nc\nd", "w\nx\ny\nz", { maxEditDistance: 2 });
		assert.strictEqual(hunks.length, 1);
		assert.deepStrictEqual(
			hunks[0]?.lines.map((l) => l.kind),
			["remove", "remove", "remove", "remove", "add", "add", "add", "add"],
		);
	});

	it.prop("applying the hunks to before yields after", [linesArb, linesArb], ([bLines, aLines]) => {
		const b = join(bLines);
		const a = join(aLines);
		assert.strictEqual(applyHunks(b, LineDiff.compute(b, a)), a);
		assert.strictEqual(applyHunks(b, LineDiff.compute(b, a, { context: 0 })), a);
	});

	it("a wholly replaced 100k-line document returns within 2s", () => {
		const start = Date.now();
		const hunks = LineDiff.compute(manyLines("a", 100_000), manyLines("b", 100_000));
		assert.isBelow(Date.now() - start, 2_000);
		assert.strictEqual(hunks.length, 1);
	});
});
