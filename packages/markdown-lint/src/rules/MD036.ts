// MD036 `no-emphasis-as-heading`: a port of markdownlint's lib/md036.mjs
// over the kit tree. markdownlint reads micromark tokens: a top-level
// paragraph, or one at the top of a top-level HTML block's re-parse, whose
// one meaningful child (not inline HTML, not a blank `data` token) is an
// emphasis or strong whose text is one `data` token. The kit's text nodes
// merge what micromark splits, so the split is read from the source: a line
// ending, and trailing whitespace (micromark's `lineSuffix`), are tokens of
// their own, and inside the emphasis an escape or a character reference
// (where the text's value differs from its source), a link or image opener
// (`[`, which micromark leaves a token apart when it matches nothing) or
// inline math (micromark's `mathText`) is a token beside the `data`.
// markdownlint parses no strikethrough, so the kit's `delete` of plain text
// is part of the `data`, tildes and all.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { sourceColumn } from "../internal/html-reread.js";
import { isHtmlFlowComment, rereadBlock } from "../internal/html-text.js";
import { errorContext } from "../internal/lines.js";
import { mathFlowLines } from "../internal/math-flow.js";
import type { Span } from "../internal/math-text.js";
import { mathTextSpans } from "../internal/math-text.js";
import { stringSettingUnlessAbsent } from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

const allPunctuation = ".,;:!?。，；：！？";

const lineBreak = /[\r\n]/;
const trailingWhitespace = /[ \t]$/;

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

// How many of micromark's meaningful paragraph children the part of a kit child inside `window` stands for, as far
// as one or more matters.
const meaningful = (text: string, node: MarkdownNode, window: Span): number => {
	const start = Math.max(node.position.start.offset, window.start);
	const end = Math.min(node.position.end.offset, window.end);
	if (start >= end || node.type === "html") return 0;
	if (node.type !== "text") return 1;
	const slice = text.slice(start, end);
	return (slice.trim().length > 0 ? 1 : 0) + (lineBreak.test(slice) ? 1 : 0);
};

// Whether every text node under `node` (a `text`, or a `delete` of nothing but text) reads as written: no escape or
// character reference decoded.
const plainText = (text: string, node: MarkdownNode): boolean => {
	if (node.type === "text")
		return (
			(node as { readonly value?: string }).value === text.slice(node.position.start.offset, node.position.end.offset)
		);
	// markdownlint parses no strikethrough, so a `delete` of plain text is data to it, tildes and all.
	return node.type === "delete" && childrenOf(node).every((child) => plainText(text, child));
};

// The emphasis's text when micromark reads it as one `data` token.
const singleDataText = (text: string, node: MarkdownNode, math: ReadonlyArray<Span>): string | undefined => {
	const children = childrenOf(node);
	const first = children[0];
	const last = children.at(-1);
	if (first === undefined || last === undefined || !children.every((child) => plainText(text, child))) return undefined;
	const start = first.position.start.offset;
	const end = last.position.end.offset;
	// Inline math is a `mathText` token beside the data.
	if (math.some((span) => span.start < end && start < span.end)) return undefined;
	const slice = text.slice(start, end);
	return !lineBreak.test(slice) && !slice.includes("[") ? slice : undefined;
};

/**
 * The emphasis or strong a paragraph is made of, and its text, when
 * markdownlint reads the part of `paragraph` inside `window` (of `text`) as a
 * one-child paragraph; `trailing` is whether its line ends in whitespace.
 */
const emphasisHeading = (
	text: string,
	paragraph: MarkdownNode,
	window: Span,
	trailing: boolean,
	math: ReadonlyArray<Span>,
): { readonly node: MarkdownNode; readonly text: string } | undefined => {
	const children = childrenOf(paragraph);
	const count = children.reduce((sum, child) => sum + meaningful(text, child, window), trailing ? 1 : 0);
	if (count !== 1) return undefined;
	const node = children.find(
		(child) =>
			(child.type === "emphasis" || child.type === "strong") &&
			child.position.start.offset >= window.start &&
			child.position.end.offset <= window.end,
	);
	if (node === undefined) return undefined;
	const emphasized = singleDataText(text, node, math);
	return emphasized === undefined ? undefined : { node, text: emphasized };
};

interface Found {
	readonly type: string;
	readonly offset: number;
	readonly text: string;
}

// The paragraphs at the top of markdownlint's re-parse of a top-level HTML block, each read on its one source line.
const fromHtmlBlock = (context: LintContext, block: MarkdownNode, found: Array<Found>): void => {
	const { document, lines } = rereadBlock(context, block);
	if (document === undefined) return;
	const text = lines.map((line) => line.text).join("\n");
	const math = mathTextSpans(document, text);
	for (const paragraph of childrenOf(document.root as MarkdownNode)) {
		if (paragraph.type !== "paragraph") continue;
		// A stub line the re-read put before the paragraph is no part of it to markdownlint.
		const real: Array<number> = [];
		for (let row = paragraph.position.start.line; row <= paragraph.position.end.line; row++) {
			if ((lines[row - 1]?.origin ?? 0) !== 0) real.push(row);
		}
		const [row] = real;
		if (real.length !== 1 || row === undefined) continue;
		const line = lines[row - 1];
		if (line === undefined) continue;
		const lineStart = document.lineIndex.lineStart(row - 1);
		const window = { start: lineStart, end: lineStart + line.text.length };
		const trailing = trailingWhitespace.test(context.lines[line.origin - 1] ?? "");
		const heading = emphasisHeading(text, paragraph, window, trailing, math);
		if (heading === undefined) continue;
		const column = sourceColumn(line, heading.node.position.start.offset - lineStart);
		found.push({
			type: heading.node.type,
			offset: context.mapping.lineStart(line.origin) + column,
			text: heading.text,
		});
	}
};

const punctuationPattern = (punctuation: string): RegExp => {
	try {
		return new RegExp(`[${punctuation}]$`);
	} catch {
		// markdownlint throws on a pattern that does not compile; the kit stays total and reads the default.
		return new RegExp(`[${allPunctuation}]$`);
	}
};

/**
 * MD036 `no-emphasis-as-heading`: a one-line paragraph of nothing but
 * emphasis is a heading, written as one.
 *
 * @remarks
 * markdownlint's setting: `punctuation` (default `.,;:!?。，；：！？`): text
 * ending in one of these is not reported. markdownlint reads it as
 * `String(punctuation)` into a character class unescaped, so `""` reports
 * every ending and a leading `^` negates the class; a value that does not
 * compile, where markdownlint throws, reads as the default.
 *
 * @public
 */
export const MD036: Lint.LintRule = LintRule.make({
	names: ["MD036", "no-emphasis-as-heading"],
	description: "Emphasis used instead of a heading",
	tags: ["headings", "emphasis"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md036.md",
	check: (context, report) => {
		const trailing = punctuationPattern(stringSettingUnlessAbsent(context.config, "punctuation", allPunctuation));
		const math = mathFlowLines(context);
		const mathText = mathTextSpans(context.document, context.source);
		const found: Array<Found> = [];
		for (const node of context.root.children as ReadonlyArray<MarkdownNode>) {
			// Inclusive: on a math opener line, this is the fence's meta (see `mathFlowLines`).
			if (math.has(node.position.start.line)) continue;
			if (node.type === "html" && !isHtmlFlowComment(context, node)) fromHtmlBlock(context, node, found);
			if (node.type !== "paragraph") continue;
			const window = { start: node.position.start.offset, end: node.position.end.offset };
			const endsInSpace = trailingWhitespace.test(context.lines[node.position.end.line - 1] ?? "");
			const heading = emphasisHeading(context.source, node, window, endsInSpace, mathText);
			if (heading !== undefined)
				found.push({ type: heading.node.type, offset: heading.node.position.start.offset, text: heading.text });
		}
		// markdownlint reports every emphasis, then every strong.
		for (const type of ["emphasis", "strong"]) {
			for (const each of found) {
				if (each.type !== type || trailing.test(each.text)) continue;
				report(context.diagnostic({ at: { offset: each.offset, length: 0 }, context: errorContext(each.text) }));
			}
		}
	},
});
