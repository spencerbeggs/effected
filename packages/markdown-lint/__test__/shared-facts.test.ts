// The rules share document facts computed once per lint (code-block lines,
// math blocks, containers, headings, HTML text tokens). Each differential test
// runs one rule alone, so it cannot see one rule's read of a shared fact
// leaking into another's: this test does. A lint with every rule must report
// exactly what each rule reports alone.

import { assert, describe, it } from "@effect/vitest";
import type { LintConfigRecord } from "../src/LintConfig.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { corpus } from "./helpers/differential.js";

const together = (source: string, config: LintConfigRecord) => MarkdownLint.lint(source, rules, { config });
const alone = (source: string, config: LintConfigRecord) =>
	rules.flatMap((rule) => MarkdownLint.lint(source, [rule], { config }));

describe("shared document facts", () => {
	it("a lint with every rule reports what each rule reports alone, over the corpus", { timeout: 120_000 }, () => {
		for (const { name, source } of corpus) {
			assert.deepStrictEqual(together(source, { default: true }), alone(source, { default: true }), name);
		}
	});

	it("a rule reading the code-block lines sees none of the HTML lines the math-block scan excludes", () => {
		// MD013 reads the headings, and reading them runs the math-block scan first. That scan excludes HTML block
		// lines on top of the code lines; MD013 under `code_blocks: false` skips code lines only, so the long HTML
		// line is still reported unless the scan's additions leak into the shared code-block lines.
		const source = `# T\n\n<div>\n${"word ".repeat(30).trimEnd()}\n</div>\n`;
		const config = { default: true, MD013: { code_blocks: false } };
		const findings = together(source, config);
		assert.deepStrictEqual(findings, alone(source, config));
		assert.isTrue(findings.some((finding) => finding.ruleNames[0] === "MD013" && finding.lineNumber === 4));
	});
});
