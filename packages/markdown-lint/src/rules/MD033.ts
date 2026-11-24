// MD033 `no-inline-html`: a port of markdownlint's lib/md033.mjs over the kit
// tree. markdownlint reports its `htmlText` tokens: inline HTML, and the tags
// inside each HTML block that is not one comment, which it re-parses as
// Markdown with HTML blocks and indented code turned off. The kit's inline
// `html` nodes give the first (less those inside inline math, which micromark
// reads as math); for the second, an HTML block's lines are
// re-read by the kit with every line that could open a block indented four
// columns behind the line before it (or a stub line), table rows kept as
// written, and the inline `html` nodes of that parse are mapped back to the
// block's own lines.

import type { MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { Result } from "effect";
import {
	flowNodes,
	inSpans,
	isHtmlFlowComment,
	lineStarts,
	mathFlowLines,
	mathTextSpans,
} from "../internal/rule-helpers.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `getHtmlTagInfo` name pattern.
const htmlTagName = /^<([^!>][^/\s>]*)/;

// markdownlint's `toLowerCaseStringArray`: an array's items as lowercase strings, or nothing.
const lowerCaseList = (value: unknown): ReadonlyArray<string> =>
	Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : [];

const reparseOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

/** One `htmlText` token: where its text starts, the text, and whether a table holds it. */
interface HtmlText {
	readonly offset: number;
	readonly text: string;
	readonly inTable: boolean;
}

// Every inline `html` node under `node`, with whether a table holds it.
const inlineHtml = (node: MarkdownNode, inTable: boolean, found: Array<{ node: MarkdownNode; inTable: boolean }>) => {
	const tabled = inTable || node.type === "table";
	if (node.type === "html") found.push({ node, inTable: tabled });
	if ("children" in node) {
		for (const child of node.children as ReadonlyArray<MarkdownNode>) inlineHtml(child, tabled, found);
	}
	return found;
};

// A line the re-read keeps as written: a table row (a line with a pipe) that cannot open an HTML block.
const keptLine = (line: string): boolean => line.includes("|") && !/^[\s>]*</.test(line) && !/^(?: {4}|\t)/.test(line);

// The `htmlText` tokens markdownlint's re-parse of an HTML block's lines gives, at their offsets in `source`.
const blockHtmlText = (context: Lint.LintContext, block: MarkdownNode, starts: ReadonlyArray<number>) => {
	const lines: Array<string> = [];
	// For each line of the re-read text, the source line it holds (0 for a stub line) and the columns added.
	const origins: Array<{ readonly line: number; readonly shift: number }> = [];
	let afterBlank = true;
	for (let lineNumber = block.position.start.line; lineNumber <= block.position.end.line; lineNumber++) {
		const line = context.lines[lineNumber - 1] ?? "";
		if (line.trim() === "") {
			lines.push("");
			origins.push({ line: 0, shift: 0 });
			afterBlank = true;
			continue;
		}
		if (keptLine(line)) {
			lines.push(line);
			origins.push({ line: lineNumber, shift: 0 });
		} else {
			// Indented four columns, as the continuation of the line before (or of a stub line), no line opens a block.
			if (afterBlank) {
				lines.push("x");
				origins.push({ line: 0, shift: 0 });
			}
			lines.push(`    ${line}`);
			origins.push({ line: lineNumber, shift: 4 });
		}
		afterBlank = false;
	}
	const text = lines.join("\n");
	const parsed = MarkdownDocument.parseResult(text, reparseOptions);
	if (Result.isFailure(parsed)) return [];
	const textStarts = lineStarts(text);
	const math = mathTextSpans(parsed.success, text);
	const found: Array<HtmlText> = [];
	for (const { node, inTable } of inlineHtml(parsed.success.root as MarkdownNode, false, [])) {
		const origin = origins[node.position.start.line - 1];
		if (origin === undefined || origin.line === 0 || inSpans(math, node.position.start.offset)) continue;
		const column = node.position.start.offset - (textStarts[node.position.start.line - 1] as number) - origin.shift;
		found.push({
			offset: (starts[origin.line - 1] as number) + column,
			text: text.slice(node.position.start.offset, node.position.end.offset),
			inTable,
		});
	}
	return found;
};

/**
 * MD033 `no-inline-html`: no raw HTML.
 *
 * @remarks
 * markdownlint's settings: `allowed_elements` and `table_allowed_elements`
 * (default `[]`; element names, any case). As in markdownlint, a list that
 * is not an array allows nothing, and a falsy `table_allowed_elements`
 * reads as `allowed_elements`.
 *
 * @public
 */
export const MD033: Lint.LintRule = LintRule.make({
	names: ["MD033", "no-inline-html"],
	description: "Inline HTML",
	tags: ["html"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md033.md",
	check: (context, report) => {
		const allowed = lowerCaseList(context.config.allowed_elements);
		const tableAllowed = lowerCaseList(context.config.table_allowed_elements || context.config.allowed_elements);
		const starts = lineStarts(context.source);
		const math = mathFlowLines(context, starts);
		const mathText = mathTextSpans(context.document, context.source);
		const blocks = new Set(flowNodes(context, new Set(["html"])));
		const tokens: Array<HtmlText> = [];
		for (const { node, inTable } of inlineHtml(context.root as MarkdownNode, false, [])) {
			if (math.has(node.position.start.line)) continue;
			if (!blocks.has(node)) {
				if (inSpans(mathText, node.position.start.offset)) continue;
				tokens.push({
					offset: node.position.start.offset,
					text: context.source.slice(node.position.start.offset, node.position.end.offset),
					inTable,
				});
			} else if (!isHtmlFlowComment(context, node)) {
				tokens.push(...blockHtmlText(context, node, starts));
			}
		}
		tokens.sort((a, b) => a.offset - b.offset);
		for (const token of tokens) {
			const match = htmlTagName.exec(token.text);
			if (match === null) continue;
			const name = match[1] as string;
			if (name.startsWith("/")) continue;
			const element = name.toLowerCase();
			if ((token.inTable || !allowed.includes(element)) && (!token.inTable || !tableAllowed.includes(element))) {
				report(
					context.diagnostic({
						at: { offset: token.offset, length: 0 },
						detail: `Element: ${name}`,
						range: { offset: token.offset, length: token.text.replace(/[\r\n][\s\S]*$/, "").length },
					}),
				);
			}
		}
	},
});
