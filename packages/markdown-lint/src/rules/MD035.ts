// MD035 `hr-style`: a port of markdownlint's lib/md035.mjs over the kit
// tree. A thematic break's text is micromark's `thematicBreak` token's: from
// its first marker to its line's end, trailing whitespace included.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { mathFlowLines } from "../internal/math-flow.js";
import { stringSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD035 `hr-style`: every horizontal rule is written the same way.
 *
 * @remarks
 * markdownlint's setting: `style` (default `consistent`, the first rule's
 * text), read as `String(style || "consistent").trim()`, so any falsy value
 * is the default and a non-string its text.
 *
 * @public
 */
export const MD035: Lint.LintRule = LintRule.make({
	names: ["MD035", "hr-style"],
	description: "Horizontal rule style",
	tags: ["hr"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md035.md",
	check: (context, report) => {
		let style = stringSetting(context.config, "style", "consistent").trim();
		const math = mathFlowLines(context);
		for (const node of context.document.findAll("thematicBreak") as ReadonlyArray<MarkdownNode>) {
			const { line: lineNumber, offset } = node.position.start;
			if (math.has(lineNumber)) continue;
			const line = context.lines[lineNumber - 1] ?? "";
			const text = line.slice(offset - context.mapping.lineStart(lineNumber));
			if (style === "consistent") style = text;
			if (text === style) continue;
			report(context.diagnostic({ at: node, detail: `Expected: ${style}; Actual: ${text}` }));
		}
	},
});
