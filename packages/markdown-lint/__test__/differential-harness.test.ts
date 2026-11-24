// The differential harness can fail, and can pass. Two throwaway ports of
// markdownlint's MD047 `single-trailing-newline`, defined here and never in
// src/rules/: a faithful one, held to zero divergences over the whole corpus
// (the positive control), and one that reports a line late (the negative
// control), which must diverge and name the fixtures it diverges on.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { LintContext, LintReport } from "../src/LintContext.js";
import { LintRule } from "../src/LintRule.js";
import { corpus, differential } from "./helpers/differential.js";
import { oracleLineEnding } from "./helpers/markdownlint-oracle.js";

// markdownlint's `isBlankLine`, verbatim in behaviour.
const isBlankLine = (line: string | undefined): boolean => {
	const removeComments = (text: string): string => {
		let s = text;
		while (true) {
			const start = s.indexOf("<!--");
			const end = s.indexOf("-->");
			if (end !== -1 && (start === -1 || end < start)) s = s.slice(end + 3);
			else if (start !== -1 && end !== -1) s = s.slice(0, start) + s.slice(end + 3);
			else if (start !== -1 && end === -1) s = s.slice(0, start);
			else return s;
		}
	};
	return !line?.trim() || !removeComments(line).replace(/>/g, "").trim();
};

// The offset each line of `source` starts at.
const lineStarts = (source: string): Array<number> => {
	const starts = [0];
	for (const match of source.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
	return starts;
};

// MD047 over the kit context: markdownlint's last content line (its `lines`
// exclude the front matter, and an empty remainder is one empty line).
const md047Report = (context: LintContext, lineShift: number): LintReport | undefined => {
	const frontMatterLines = Option.match(context.frontmatter, { onNone: () => 0, onSome: (block) => block.lineCount });
	const content = context.lines.slice(frontMatterLines);
	const lastLine = content.length === 0 ? "" : (content[content.length - 1] as string);
	if (isBlankLine(lastLine)) return undefined;
	const lastLineNumber = frontMatterLines + Math.max(content.length, 1);
	const start = lineStarts(context.source)[lastLineNumber - 1 + lineShift] ?? 0;
	return {
		at: { offset: start, length: 0 },
		range: { offset: start + lastLine.length - 1, length: 1 },
		fix: { offset: start + lastLine.length, length: 0, content: oracleLineEnding(context.source) },
	};
};

const md047 = (lineShift: number) =>
	LintRule.make({
		names: ["MD047", "single-trailing-newline"],
		description: "Files should end with a single newline character",
		tags: ["blank_lines"],
		check: (context, report) => {
			const finding = md047Report(context, lineShift);
			if (finding !== undefined) report(context.diagnostic(finding));
		},
	});

// A differential pass lints the whole corpus twice in two engines; under a parallel run it outlasts the default.
describe("the differential harness", { timeout: 60_000 }, () => {
	it("compares every corpus file, LF and CRLF", () => {
		assert.lengthOf(corpus, 437);
	});

	it("finds no divergence for a faithful port over the whole corpus", () => {
		const result = differential(md047(0), {
			extra: [
				{ name: "no trailing newline", source: "# H\n\ntext" },
				{ name: "front matter only, unterminated", source: "---\ntitle: x\n---" },
				{ name: "a comment-only last line", source: "# H\n\n<!-- c -->" },
			],
		});
		assert.strictEqual(result.compared, 437 * 2 + 3);
		// Not vacuous: markdownlint reports MD047 on 7 corpus files, LF and CRLF, and on "no trailing newline"; an
		// unterminated block of front matter alone leaves an empty content line, which is blank.
		assert.strictEqual(result.oracleFindings, 15);
		assert.deepStrictEqual(result.divergences, []);
	});

	it("reports a port that puts its finding on the wrong line, naming each fixture", () => {
		const result = differential(md047(-1), { extra: [{ name: "late line", source: "a\nb\nc" }] });
		assert.isAbove(result.divergences.length, 0);
		const named = result.divergences.find((divergence) => divergence.fixture === "late line");
		assert.isDefined(named);
		assert.match(named?.reason ?? "", /lineNumber: kit 2, markdownlint 3/);
		for (const divergence of result.divergences) {
			assert.isTrue(
				divergence.fixture === "late line" ||
					corpus.some((entry) => divergence.fixture.replace(/ \(CRLF\)$/, "") === entry.name),
				divergence.fixture,
			);
		}
	});

	it("reports a missing finding and a wrong fix as divergences", () => {
		const silent = LintRule.make({
			names: ["MD047", "single-trailing-newline"],
			description: "Files should end with a single newline character",
			tags: ["blank_lines"],
			check: () => {},
		});
		const missing = differential(silent, { extra: [{ name: "unterminated", source: "a" }] });
		assert.match(missing.divergences.find((d) => d.fixture === "unterminated")?.reason ?? "", /^missing finding 1/);
		const wrongFix = LintRule.make({
			names: ["MD047", "single-trailing-newline"],
			description: "Files should end with a single newline character",
			tags: ["blank_lines"],
			check: (context, report) => {
				const finding = md047Report(context, 0);
				if (finding !== undefined)
					report(context.diagnostic({ ...finding, fix: { offset: 0, length: 0, content: "\n" } }));
			},
		});
		const fixed = differential(wrongFix, { extra: [{ name: "unterminated", source: "a" }] });
		assert.match(fixed.divergences.find((d) => d.fixture === "unterminated")?.reason ?? "", /fixInfo/);
	});
});
