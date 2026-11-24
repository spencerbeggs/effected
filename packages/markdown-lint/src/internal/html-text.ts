// markdownlint's `htmlText` tokens: the kit's inline HTML, and the tags
// inside each HTML block (through the re-read in html-reread.ts), less any
// inside math, with the tag readers MD033 and MD045 share.

import type { MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { flowNodes } from "./containers.js";
import { rereadHtmlBlock } from "./html-reread.js";
import { mathFlowLines } from "./math-flow.js";
import { inSpans, mathTextSpans } from "./math-text.js";

/** One `htmlText` token: where its text starts, the text, and whether a table holds it. @internal */
export interface HtmlText {
	readonly offset: number;
	readonly text: string;
	readonly inTable: boolean;
}

const FLOW_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

// Every inline `html` node under `node` (none an HTML block), with whether a table holds it.
const inlineHtml = (node: MarkdownNode, inTable: boolean, found: Array<{ node: MarkdownNode; inTable: boolean }>) => {
	const tabled = inTable || node.type === "table";
	if ("children" in node) {
		for (const child of node.children as ReadonlyArray<MarkdownNode>) {
			if (child.type === "html" && !FLOW_PARENTS.has(node.type)) found.push({ node: child, inTable: tabled });
			inlineHtml(child, tabled, found);
		}
	}
	return found;
};

/**
 * markdownlint's `isHtmlFlowComment`: an HTML block that is one comment,
 * read from its unmasked source span.
 * @internal
 */
export const isHtmlFlowComment = (context: LintContext, node: MarkdownNode): boolean => {
	if (node.type !== "html") return false;
	// markdownlint reads the comment before masking it, so `<!-- a --->` still ends in `-`.
	const text = context.unmaskedSource.slice(node.position.start.offset, node.position.end.offset);
	if (!text.startsWith("<!--") || !text.endsWith("-->")) return false;
	const comment = text.slice(4, -3);
	return !comment.startsWith(">") && !comment.startsWith("->") && !comment.endsWith("-");
};

// The `htmlText` tokens markdownlint's re-parse of an HTML block's lines gives, at their offsets in `source`.
const blockHtmlText = (context: LintContext, block: MarkdownNode) => {
	const blockLines = context.lines.slice(block.position.start.line - 1, block.position.end.line);
	const { document, lines } = rereadHtmlBlock(blockLines, block.position.start.line);
	if (document === undefined) return [];
	const text = lines.map((line) => line.text).join("\n");
	const math = mathTextSpans(document, text);
	const found: Array<HtmlText> = [];
	for (const { node, inTable } of inlineHtml(document.root as MarkdownNode, false, [])) {
		const line = lines[node.position.start.line - 1];
		if (line === undefined || line.origin === 0 || inSpans(math, node.position.start.offset)) continue;
		// The column in the re-read line, less the columns inserted before it, undone last first.
		let column = node.position.start.offset - document.lineIndex.lineStart(node.position.start.line - 1);
		for (const [at, length] of [...line.inserts].reverse()) {
			if (column >= at + length) column -= length;
			else if (column >= at) column = at;
		}
		found.push({
			offset: context.mapping.lineStart(line.origin) + column,
			text: text.slice(node.position.start.offset, node.position.end.offset),
			inTable,
		});
	}
	return found;
};

/**
 * markdownlint's `htmlText` tokens, at their offsets in `source`, in order:
 * the kit's inline `html` nodes, less any inside inline math, and the tags
 * inside each HTML block that is not one comment, which markdownlint
 * re-parses as Markdown with HTML blocks and indented code turned off (see
 * {@link rereadHtmlBlock}), mapped back to the block's own lines. The nodes
 * the kit reads inside a math block are dropped.
 * @internal
 */
export const htmlTextTokens = (context: LintContext): Array<HtmlText> => {
	const math = mathFlowLines(context);
	const mathText = mathTextSpans(context.document, context.source);
	const tokens: Array<HtmlText> = [];
	for (const { node, inTable } of inlineHtml(context.root as MarkdownNode, false, [])) {
		if (math.has(node.position.start.line) || inSpans(mathText, node.position.start.offset)) continue;
		tokens.push({
			offset: node.position.start.offset,
			text: context.source.slice(node.position.start.offset, node.position.end.offset),
			inTable,
		});
	}
	for (const block of flowNodes(context, new Set(["html"]))) {
		if (math.has(block.position.start.line) || isHtmlFlowComment(context, block)) continue;
		tokens.push(...blockHtmlText(context, block));
	}
	tokens.sort((a, b) => a.offset - b.offset);
	return tokens;
};

/**
 * An `htmlText` token's range as markdownlint measures it: from its start to
 * the end of its first line.
 * @internal
 */
export const htmlTextRange = (token: HtmlText): { readonly offset: number; readonly length: number } => ({
	offset: token.offset,
	length: token.text.replace(/[\r\n][\s\S]*$/, "").length,
});

/**
 * markdownlint's `getHtmlTagInfo`: an `htmlText` token's element name, and
 * whether it is a closing tag; `undefined` for a comment, declaration or
 * CDATA.
 * @internal
 */
export const htmlTagInfo = (text: string): { readonly name: string; readonly close: boolean } | undefined => {
	const name = /^<([^!>][^/\s>]*)/.exec(text)?.[1];
	if (name === undefined) return undefined;
	const close = name.startsWith("/");
	return { name: close ? name.slice(1) : name, close };
};
