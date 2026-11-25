// MD007 `ul-indent`: a port of markdownlint's lib/md007.mjs over the kit
// tree. markdownlint nests an unordered list by the unordered lists around
// it up to a blockquote, skips one inside an ordered list, and measures each
// item's indent past the last blockquote marker on its line; the kit reads the
// same from each list's ancestors and the item's line.

import type { List, ListItem, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { blockQuotePrefixEnd, flowNodesWithAncestors, listItemPrefix } from "../internal/containers.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { REPEAT_CAP, flagSetting, numberSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

// markdownlint's nesting: the unordered lists around `list` up to its nearest blockquote; `undefined` inside an
// ordered list.
const nestingOf = (ancestors: ReadonlyArray<MarkdownNode>): number | undefined => {
	let nesting = 0;
	for (let index = ancestors.length - 1; index >= 0; index--) {
		const ancestor = ancestors[index] as MarkdownNode;
		if (ancestor.type === "blockquote") break;
		if (ancestor.type !== "list") continue;
		if ((ancestor as List).ordered === true) return undefined;
		nesting++;
	}
	return nesting;
};

/**
 * MD007 `ul-indent`: unordered list items are indented by a fixed step per
 * level of nesting.
 *
 * @remarks
 * markdownlint's settings: `indent` (default 2), `start_indented` (default
 * `false`) and `start_indent` (default `indent`), read as markdownlint
 * coerces them (`Number(x ?? d)`, `!!x`). A list inside an ordered list is not
 * checked; one in a footnote is indented four more. A fix inserts at most
 * 1,000 spaces, where markdownlint pads to any setting.
 *
 * @public
 */
export const MD007: Lint.LintRule = LintRule.make({
	names: ["MD007", "ul-indent"],
	description: "Unordered list indentation",
	tags: ["bullet", "ul", "indentation"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md007.md",
	check: (context, report) => {
		const indent = numberSetting(context.config, "indent", 2);
		const startIndented = flagSetting(context.config, "start_indented");
		const startIndent = numberSetting(context.config, "start_indent", indent);
		const math = mathFlowBlocks(context);
		for (const { node, ancestors } of flowNodesWithAncestors(context, new Set(["list"]))) {
			const list = node as List;
			// Strict: a list starting on a math opener line holds the opener (see `inMathBlock`).
			if (list.ordered === true || inMathBlock(math, list.position.start.line)) continue;
			const nesting = nestingOf(ancestors);
			if (nesting === undefined) continue;
			const baseIndent = ancestors.some((ancestor) => ancestor.type === "footnoteDefinition") ? 4 : 0;
			const expectedIndent = baseIndent + (startIndented ? startIndent : 0) + nesting * indent;
			for (const item of list.children as ReadonlyArray<ListItem>) {
				const lineNumber = item.position.start.line;
				const prefix = listItemPrefix(context, item);
				const lineStart = context.mapping.lineStart(lineNumber);
				const adjustment = blockQuotePrefixEnd(context, lineNumber, ancestors);
				const actualIndent = item.position.start.column - 1 - adjustment;
				if (expectedIndent === actualIndent) continue;
				// markdownlint's fix counts are the raw arithmetic, which its `slice` and `padEnd` truncate: a fractional
				// setting deletes and pads whole columns, and a `NaN` one neither deletes nor inserts.
				// A negative setting can ask to delete past the line's end, where markdownlint throws; the kit stops there.
				const lineLength = (context.lines[lineNumber - 1] ?? "").length;
				const remove = Math.min(lineLength - adjustment, Math.trunc(Math.max(actualIndent - expectedIndent, 0)) || 0);
				const insert = Math.min(REPEAT_CAP, Math.trunc(Math.max(expectedIndent - actualIndent, 0)) || 0);
				report(
					context.diagnostic({
						at: { offset: prefix.offset, length: 0 },
						detail: `Expected: ${expectedIndent}; Actual: ${actualIndent}`,
						range: { offset: lineStart, length: prefix.offset - lineStart + prefix.marker + prefix.whitespace },
						fix: { offset: lineStart + adjustment, length: remove, content: " ".repeat(insert) },
					}),
				);
			}
		}
	},
});
