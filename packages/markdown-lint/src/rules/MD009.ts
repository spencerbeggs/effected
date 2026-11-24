// MD009 `no-trailing-spaces`: a port of markdownlint's lib/md009.mjs over
// the kit tree. markdownlint reads micromark tokens for four line sets — code
// block lines, list lines whose indentation it forgives, paragraph lines and
// code span lines — and this module derives each from kit node positions and
// the raw lines instead.

import type { List, MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { codeNodes, fencedInterior } from "../internal/code-blocks.js";
import { addRange, firstContentLine } from "../internal/lines.js";
import { isBoolean, isNumber, setting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

// The lines markdownlint leaves to the code: an indented block's every line,
// and a fenced block's lines between its fences.
const codeLines = (context: Lint.LintContext): Set<number> => {
	const lines = new Set<number>();
	for (const node of codeNodes(context)) {
		if (node.fenceChar === undefined) addRange(lines, node.position.start.line, node.position.end.line);
		else {
			const interior = fencedInterior(context, node);
			addRange(lines, interior.start, interior.end);
		}
	}
	return lines;
};

const isContent = (node: MarkdownNode): boolean => node.type === "paragraph" || node.type === "definition";

// markdownlint forgives a list's lines, less each item's indented lines after
// its last paragraph: micromark's direct `listItemIndent` tokens, the
// indentation of a line that no child block of the item already spans.
const listLines = (context: Lint.LintContext): Set<number> => {
	const lines = new Set<number>();
	for (const list of context.document.findAll("list") as ReadonlyArray<List>) {
		addRange(lines, list.position.start.line, list.position.end.line);
		const items = list.children;
		for (const [index, item] of items.entries()) {
			const regionEnd =
				index + 1 < items.length ? (items[index + 1] as MarkdownNode).position.start.line - 1 : list.position.end.line;
			const contents = item.children.filter(isContent);
			const after =
				contents.length === 0
					? item.position.start.line
					: (contents[contents.length - 1] as MarkdownNode).position.end.line;
			for (let line = after + 1; line <= regionEnd; line++) {
				const inChild = item.children.some(
					(child) => child.position.start.line < line && line <= child.position.end.line,
				);
				if (!inChild && /^[ \t]/.test(context.lines[line - 1] ?? "")) lines.delete(line);
			}
		}
	}
	return lines;
};

const spanLines = (context: Lint.LintContext, type: "paragraph" | "inlineCode"): Set<number> => {
	const lines = new Set<number>();
	for (const node of context.document.findAll(type))
		addRange(lines, node.position.start.line, node.position.end.line - 1);
	return lines;
};

/**
 * MD009 `no-trailing-spaces`: lines end with no unexpected whitespace.
 *
 * @remarks
 * markdownlint's settings: `br_spaces` (default `2`), `code_blocks` (default
 * `false`), `list_item_empty_lines` (default `false`) and `strict` (default
 * `false`). A setting of the wrong type reads as its default.
 *
 * @public
 */
export const MD009: Lint.LintRule = LintRule.make({
	names: ["MD009", "no-trailing-spaces"],
	description: "Trailing spaces",
	tags: ["whitespace"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md009.md",
	check: (context, report) => {
		const brSpaces = setting(context.config, "br_spaces", isNumber, 2);
		const includeCode = setting(context.config, "code_blocks", isBoolean, false);
		const listItemEmptyLines = setting(context.config, "list_item_empty_lines", isBoolean, false);
		const strict = setting(context.config, "strict", isBoolean, false);
		const code = includeCode ? new Set<number>() : codeLines(context);
		const listed = listItemEmptyLines ? listLines(context) : new Set<number>();
		const paragraphs = strict ? spanLines(context, "paragraph") : new Set<number>();
		const codeSpans = strict ? spanLines(context, "inlineCode") : new Set<number>();
		const expected = brSpaces < 2 ? 0 : brSpaces;
		for (let lineNumber = firstContentLine(context); lineNumber <= context.lines.length; lineNumber++) {
			const line = context.lines[lineNumber - 1] as string;
			const trailing = line.length - line.trimEnd().length;
			if (
				trailing &&
				!code.has(lineNumber) &&
				!listed.has(lineNumber) &&
				(expected !== trailing || (strict && (!paragraphs.has(lineNumber) || codeSpans.has(lineNumber))))
			) {
				const offset = context.mapping.lineStart(lineNumber) + line.length - trailing;
				report(
					context.diagnostic({
						at: { offset, length: trailing },
						detail: `Expected: ${expected === 0 ? "" : "0 or "}${expected}; Actual: ${trailing}`,
						range: true,
						fix: { offset, length: trailing, content: "" },
					}),
				);
			}
		}
	},
});
