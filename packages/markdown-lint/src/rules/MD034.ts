// MD034 `no-bare-urls`: a port of markdownlint's lib/md034.mjs over the kit
// tree. markdownlint reports micromark's GFM `literalAutolink` tokens, walking
// the tree past the content between an inline HTML open tag and its matching
// close tag among the same siblings, and leaving out a literal with a `<` text
// right before it and a `>` right after (micromark issue 164) and any inside
// an HTML block or inline math. The kit's literal autolinks are its links
// that open with neither `[` nor `<`. Its parser follows the GFM spec, which
// micromark's literal-autolink extension reads three ways differently, so the
// kit reads micromark's: an `ftp://` literal is none, a `mailto:` or `xmpp:`
// literal is its email address alone, a `www.` written in another case
// (`WWW.`) is one too, a URL ends before a trailing `]`, and an address
// starts past a character reference before it and is none after an escape.

import type { MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { Result } from "effect";
import { CONTAINERS } from "../internal/containers.js";
import { htmlTagInfo } from "../internal/html-text.js";
import { inMathText, outsideMath } from "../internal/inline.js";
import { errorContext } from "../internal/lines.js";
import { mathFlowLines } from "../internal/math-flow.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

const options = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

interface Literal {
	readonly start: number;
	readonly end: number;
}

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

const isLiteral = (source: string, node: MarkdownNode): boolean =>
	node.type === "link" && !"[<".includes(source.charAt(node.position.start.offset));

// The literal autolinks the GFM reading of `text` finds, in its offsets.
const literalsIn = (text: string): ReadonlyArray<Literal> => {
	const parsed = MarkdownDocument.parseResult(text, options);
	if (!Result.isSuccess(parsed)) return [];
	return (parsed.success.findAll("link") as ReadonlyArray<MarkdownNode>)
		.filter((link) => isLiteral(text, link))
		.map((link) => ({ start: link.position.start.offset, end: link.position.end.offset }));
};

// micromark's reading of a literal the kit's parser found at `[start, end)`.
const micromarkLiteral = (source: string, start: number, end: number): Literal | undefined => {
	const text = source.slice(start, end);
	if (/^ftp:\/\//i.test(text)) return undefined;
	if (text.includes("@") && !/^(?:https?:|www\.)/i.test(text)) {
		// An address the kit decoded an escape or a reference into: micromark's starts past it, and none follows an
		// escaped character an address may hold.
		if (text.startsWith("\\")) return undefined;
		const reference = /^&[^;\s]*;/.exec(text)?.[0];
		if (reference !== undefined) return { start: start + reference.length, end };
	}
	if (!text.includes("@") || /^(?:https?:|www\.)/i.test(text)) {
		// micromark ends a URL before a trailing `]`, and before the trailing punctuation that leaves.
		let stop = end;
		while (stop > start && source.charAt(stop - 1) === "]") {
			stop--;
			while (stop > start && "?!.,:*_~'\"".includes(source.charAt(stop - 1))) stop--;
		}
		return { start, end: stop };
	}
	const scheme = /^(?:mailto|xmpp):/i.exec(text)?.[0];
	if (scheme === undefined) return { start, end };
	// micromark links only the address after the scheme, as an email.
	const [email] = literalsIn(text.slice(scheme.length));
	return email === undefined
		? undefined
		: { start: start + scheme.length + email.start, end: start + scheme.length + email.end };
};

// The `www.` hosts written in another case in a text node's source, which micromark links and the kit's parser,
// following the spec, does not: re-read with that `www` lowered. Like any `www.` literal, one opens only at a line's
// start or after a space or one of `*_~(`.
const otherCaseWww = (source: string, node: MarkdownNode): ReadonlyArray<Literal> => {
	const start = node.position.start.offset;
	const text = source.slice(start, node.position.end.offset);
	if (!/www\./i.test(text) || !/(?!www)[wW]{3}\./.test(text)) return [];
	const lowered = text.replace(/[wW]{3}\./g, (match) => match.toLowerCase());
	const original = new Set(literalsIn(text).map((literal) => literal.start));
	return literalsIn(lowered)
		.filter((literal) => !original.has(literal.start) && lowered.startsWith("www.", literal.start))
		.map((literal) => ({ start: start + literal.start, end: start + literal.end }))
		.filter((literal) => {
			const before = source.charAt(literal.start - 1);
			return literal.start === 0 || /\s/.test(before) || "*_~(".includes(before);
		});
};

// The offsets in each inline block (a paragraph, heading or table cell) at which a label opener (`[` or `![`) is
// still unbalanced, as micromark's literal-autolink tokenizer checks before it links: each `]` balances the latest
// opener, whether or not it makes a link. Code spans, inline HTML, autolinks, inline math and escapes hold none.
const unbalancedAt = (context: LintContext): ((offset: number) => boolean) => {
	const { source } = context;
	const inMath = inMathText(context);
	const open: Array<readonly [number, number]> = [];
	for (const block of context.document.findAll(
		(node) => node.type === "paragraph" || node.type === "heading" || node.type === "tableCell",
	) as ReadonlyArray<MarkdownNode>) {
		const atomic = (block as MarkdownNode & { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];
		const skips: Array<readonly [number, number]> = [];
		const collect = (nodes: ReadonlyArray<MarkdownNode>): void => {
			for (const node of nodes) {
				const start = node.position.start.offset;
				if (
					node.type === "inlineCode" ||
					node.type === "html" ||
					(node.type === "link" && source.charAt(start) === "<")
				) {
					skips.push([start, node.position.end.offset]);
				} else collect(childrenOf(node));
			}
		};
		collect(atomic);
		skips.sort((a, b) => a[0] - b[0]);
		let skip = 0;
		let depth = 0;
		let from = -1;
		const end = block.position.end.offset;
		for (let at = block.position.start.offset; at < end; at++) {
			while (skip < skips.length && (skips[skip] as readonly [number, number])[1] <= at) skip++;
			const span = skips[skip];
			if (span !== undefined && span[0] <= at) {
				at = span[1] - 1;
				continue;
			}
			if (inMath(at)) continue;
			const char = source.charAt(at);
			if (char === "\\") {
				at++;
				continue;
			}
			if (char === "[" || (char === "!" && source.charAt(at + 1) === "[")) {
				if (depth === 0) from = at;
				depth++;
				if (char === "!") at++;
			} else if (char === "]" && depth > 0) {
				depth--;
				if (depth === 0) open.push([from, at]);
			}
		}
		if (depth > 0) open.push([from, end]);
	}
	// The spans are disjoint and in document order: one search finds the last opening before `offset`.
	return (offset) => {
		let low = 0;
		let high = open.length - 1;
		let found = -1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			if ((open[middle] as readonly [number, number])[0] < offset) {
				found = middle;
				low = middle + 1;
			} else high = middle - 1;
		}
		return found >= 0 && offset < (open[found] as readonly [number, number])[1];
	};
};

// The nodes markdownlint's walk visits among `children`: past the content between an inline HTML open tag and its
// matching close tag, the open tag itself left out whether or not it closes.
const walked = (
	source: string,
	children: ReadonlyArray<MarkdownNode>,
	inline: boolean,
): ReadonlyArray<MarkdownNode> => {
	if (!inline) return children;
	const kept: Array<MarkdownNode> = [];
	for (let index = 0; index < children.length; index++) {
		const current = children[index] as MarkdownNode;
		const open = current.type === "html" ? htmlTagInfo(sliceOf(source, current)) : undefined;
		if (open === undefined || open.close) {
			kept.push(current);
			continue;
		}
		let count = 1;
		for (let next = index + 1; next < children.length; next++) {
			const candidate = children[next] as MarkdownNode;
			const close = candidate.type === "html" ? htmlTagInfo(sliceOf(source, candidate)) : undefined;
			if (close === undefined || close.name !== open.name) continue;
			if (!close.close) count++;
			else if (--count === 0) {
				index = next;
				break;
			}
		}
	}
	return kept;
};

const sliceOf = (source: string, node: MarkdownNode): string =>
	source.slice(node.position.start.offset, node.position.end.offset);

// The literal autolinks markdownlint reports, in document order.
const bareUrls = (context: LintContext): ReadonlyArray<Literal> => {
	const { source } = context;
	const keep = outsideMath(context);
	const flow = mathFlowLines(context);
	const inMath = inMathText(context);
	const unbalanced = unbalancedAt(context);
	const found: Array<Literal> = [];
	const visit = (node: MarkdownNode, siblings: ReadonlyArray<MarkdownNode>, index: number): void => {
		if (isLiteral(source, node)) {
			if (!keep(node)) return;
			const previous = siblings[index - 1];
			const next = siblings[index + 1];
			const wrapped =
				previous?.type === "text" &&
				next?.type === "text" &&
				sliceOf(source, previous).endsWith("<") &&
				sliceOf(source, next).startsWith(">");
			const literal = micromarkLiteral(source, node.position.start.offset, node.position.end.offset);
			if (!wrapped && literal !== undefined && !unbalanced(literal.start)) found.push(literal);
			return;
		}
		if (node.type === "text") {
			if (flow.has(node.position.start.line)) return;
			for (const literal of otherCaseWww(source, node)) {
				if (!inMath(literal.start) && !unbalanced(literal.start)) found.push(literal);
			}
			return;
		}
		// A link's label holds no literal. An HTML node has no children: an HTML block's content is no literal's, as
		// markdownlint's walk passes over it.
		if ((node.type === "link" || node.type === "linkReference") && source.charAt(node.position.start.offset) === "[")
			return;
		const children = childrenOf(node);
		const positions = new Map(children.map((child, at) => [child, at] as const));
		for (const child of walked(source, children, !CONTAINERS.has(node.type))) {
			visit(child, children, positions.get(child) ?? 0);
		}
	};
	const root = context.document.root as MarkdownNode;
	for (const [index, child] of childrenOf(root).entries()) visit(child, childrenOf(root), index);
	return found;
};

/**
 * MD034 `no-bare-urls`: a URL is written as a link, not bare.
 *
 * @remarks
 * No settings. The fix wraps the URL in angle brackets. A URL inside an
 * HTML element's content, an HTML block, inline math or angle brackets is
 * not reported.
 *
 * @public
 */
export const MD034: Lint.LintRule = LintRule.make({
	names: ["MD034", "no-bare-urls"],
	description: "Bare URL used",
	tags: ["links", "url"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md034.md",
	check: (context, report) => {
		const { source } = context;
		for (const literal of bareUrls(context)) {
			const text = source.slice(literal.start, literal.end);
			report(
				context.diagnostic({
					at: { offset: literal.start, length: 0 },
					context: errorContext(text),
					range: { offset: literal.start, length: text.length },
					fix: { offset: literal.start, length: text.length, content: `<${text}>` },
				}),
			);
		}
	},
});
