// MD034 `no-bare-urls`: a port of markdownlint's lib/md034.mjs over the kit
// tree. markdownlint reports micromark's GFM `literalAutolink` tokens, walking
// the tree past the content between an inline HTML open tag and its matching
// close tag among the same siblings, and leaving out a literal with a `<` text
// right before it and a `>` right after (micromark issue 164) and any inside
// an HTML block or inline math.
//
// micromark tokenizes a literal autolink as it reads the text, before
// emphasis and brackets resolve; the kit's parser follows cmark-gfm, which
// links in a pass after them. So the kit's literals are a starting point:
// - a URL or `www.` literal is the kit's link that opens with neither `[` nor
//   `<`, read as micromark reads it: an `ftp://` literal is none, a `www.`
//   in another case (`WWW.`) is one, a URL ends before a trailing `]`, and a
//   literal after a `[` inside inline math (which the kit's parser does not
//   read as math, so the bracket hid the literal) is re-read;
// - an email address is micromark's own scan of the source (see
//   `scanBlock`), which differs from cmark-gfm's in where an address starts
//   (an `_` before it, an escape, a `/`, a scheme) and on a second `@`;
// - no literal is linked while a `[` or `![` before it in the block is
//   unbalanced, a `]` balancing the latest opener whether or not it makes a
//   link.

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

type Span = readonly [start: number, end: number];

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

const sliceOf = (source: string, node: MarkdownNode): string =>
	source.slice(node.position.start.offset, node.position.end.offset);

const isLiteral = (source: string, node: MarkdownNode): boolean =>
	node.type === "link" && !"[<".includes(source.charAt(node.position.start.offset));

// A URL or `www.` literal, as against an email address.
const isUrl = (text: string): boolean => /^(?:https?:\/\/|ftp:\/\/|www\.)/i.test(text);

/**
 * The URL and `www.` literal autolinks the GFM reading of `text` finds, in its offsets.
 *
 * @remarks
 * A whole parse of `text`, linear in it but with a parse's fixed cost (about 45 µs for a short text): called at most
 * twice per inline block, once for a block holding a `www.` in another case and once for the rest of a block after a
 * `[` in inline math when that rest holds `://` or `www.`. Email addresses are scanned, never re-parsed.
 */
const urlsIn = (text: string): ReadonlyArray<Literal> => {
	const parsed = MarkdownDocument.parseResult(text, options);
	if (!Result.isSuccess(parsed)) return [];
	return (parsed.success.findAll("link") as ReadonlyArray<MarkdownNode>)
		.filter((link) => isLiteral(text, link) && isUrl(sliceOf(text, link)))
		.map((link) => ({ start: link.position.start.offset, end: link.position.end.offset }));
};

// micromark's reading of a URL literal the kit's parser found at `[start, end)`: none for `ftp://`, and ending
// before a trailing `]` and the trailing punctuation that leaves.
const micromarkUrl = (source: string, start: number, end: number): Literal | undefined => {
	if (/^ftp:\/\//i.test(source.slice(start, end))) return undefined;
	let stop = end;
	while (stop > start && source.charAt(stop - 1) === "]") {
		stop--;
		while (stop > start && "?!.,:*_~'\"".includes(source.charAt(stop - 1))) stop--;
	}
	return { start, end: stop };
};

// Whether a URL or `www.` literal re-read out of its context may open at `offset`, as micromark's `previousWww` and
// `previousProtocol` require of the character before it.
const opensAt = (source: string, offset: number, www: boolean): boolean => {
	if (offset === 0) return true;
	const before = source.charAt(offset - 1);
	return www ? /\s/.test(before) || "*_~([]".includes(before) : !/[A-Za-z]/.test(before);
};

// The URL literals of `text` at `offset` in the source, re-read alone (a `www.` in another case lowered, as micromark
// links it) and kept where micromark could open them.
// A leading `a ` keeps the text a paragraph however it opens (blanked math can leave an indent of four spaces).
const urlsAt = (source: string, offset: number, text: string): ReadonlyArray<Literal> =>
	urlsIn(`a ${text.replace(/[wW]{3}\./g, (match) => match.toLowerCase())}`)
		.map((literal) => ({ start: offset + literal.start - 2, end: offset + literal.end - 2 }))
		.filter((literal) => literal.start >= offset)
		.filter((literal) => opensAt(source, literal.start, /^www\./i.test(source.slice(literal.start, literal.end))));

// The `www.` hosts written in another case in each inline block, which micromark links and the kit's parser,
// following the spec, does not: the block re-read once with each `www` lowered, its literals kept where they open on a
// `www` in another case inside a text node in `texts` (disjoint, in document order).
const otherCaseWww = (
	source: string,
	blocks: ReadonlyArray<MarkdownNode>,
	texts: ReadonlyArray<Span>,
): ReadonlyArray<Literal> => {
	const found: Array<Literal> = [];
	for (const block of blocks) {
		const start = block.position.start.offset;
		const text = source.slice(start, block.position.end.offset);
		if (!/(?!www)[wW]{3}\./.test(text)) continue;
		for (const literal of urlsAt(source, start, text)) {
			if (source.startsWith("www.", literal.start) || !/^[wW]{3}\./.test(source.slice(literal.start))) continue;
			const node = texts[lowerBound(texts, literal.start + 1) - 1];
			if (node !== undefined && literal.start < node[1]) found.push(literal);
		}
	}
	return found;
};

// Character classes by code, for the scan that visits every character of a block: a one-character string or "".
const codeOf = (char: string): number => (char.length === 1 ? char.charCodeAt(0) : -1);
const isAsciiAlpha = (char: string): boolean => {
	const code = codeOf(char) | 0x20;
	return code >= 0x61 && code <= 0x7a;
};
const isAsciiAlphanumeric = (char: string): boolean => {
	const code = codeOf(char);
	return (code >= 0x30 && code <= 0x39) || isAsciiAlpha(char);
};
// micromark's `gfmAtext`: what an address's local part holds.
const isAtext = (char: string): boolean =>
	char === "+" || char === "-" || char === "." || char === "_" || isAsciiAlphanumeric(char);
const isAsciiPunctuation = (char: string): boolean => {
	const code = codeOf(char);
	return (
		(code >= 0x21 && code <= 0x2f) ||
		(code >= 0x3a && code <= 0x40) ||
		(code >= 0x5b && code <= 0x60) ||
		(code >= 0x7b && code <= 0x7e)
	);
};

// micromark's `tokenizeEmailAutolink` from `at`: the end of the address, or -1 where none starts.
const emailEnd = (source: string, at: number, end: number): number => {
	let index = at;
	while (index < end && isAtext(source.charAt(index))) index++;
	if (index >= end || source.charAt(index) !== "@") return -1;
	index++;
	let data = false;
	let dot = false;
	while (index < end) {
		const char = source.charAt(index);
		if (char === ".") {
			// A dot continues the domain only before an alphanumeric.
			if (!isAsciiAlphanumeric(source.charAt(index + 1))) break;
			dot = true;
			index++;
		} else if (char === "-" || char === "_" || isAsciiAlphanumeric(char)) {
			data = true;
			index++;
		} else break;
	}
	return data && dot && isAsciiAlpha(source.charAt(index - 1)) ? index : -1;
};

interface BlockScan {
	// The spans in which a label opener is unbalanced, disjoint and in document order.
	readonly open: Array<Span>;
	// micromark's email addresses outside an unbalanced label.
	readonly emails: Array<Literal>;
	// The end of each block's first inline math holding a `[`, with the end of its block: the kit's parser, not
	// reading the math, took the bracket as open and may have left a literal after it unlinked. Disjoint and in
	// document order.
	readonly bracketMath: Array<Span>;
}

/**
 * One pass over each inline block (a paragraph, heading or table cell) as micromark reads its text: the label
 * openers (`[` or `![`) still unbalanced at each offset, each `]` balancing the latest opener whether or not it makes
 * a link, and the email addresses, which micromark tokenizes as it reads.
 *
 * @remarks
 * Code spans, inline HTML, autolinks, the URL literals in `urls`, inline math and escapes hold neither; each leaves
 * its last character as the one before what follows, which is what an address's start checks.
 */
const scanBlocks = (
	context: LintContext,
	blocks: ReadonlyArray<MarkdownNode>,
	urls: ReadonlyArray<Literal>,
): BlockScan => {
	const { source } = context;
	const inMath = inMathText(context);
	const scan: BlockScan = { open: [], emails: [], bracketMath: [] };
	const urlSpans = urls.map((url) => [url.start, url.end] as Span).sort((a, b) => a[0] - b[0]);
	for (const block of blocks) {
		const skips: Array<Span> = [];
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
		collect(childrenOf(block));
		const start = block.position.start.offset;
		const end = block.position.end.offset;
		let url = lowerBound(urlSpans, start);
		while (url < urlSpans.length && (urlSpans[url] as Span)[0] < end) skips.push(urlSpans[url++] as Span);
		skips.sort((a, b) => a[0] - b[0]);
		let skip = 0;
		let depth = 0;
		let from = -1;
		let previous = "";
		let mathBracket = false;
		let inMathRun = false;
		let bracketed = false;
		for (let at = start; at < end; at++) {
			while (skip < skips.length && (skips[skip] as Span)[1] <= at) skip++;
			const span = skips[skip];
			if (span !== undefined && span[0] <= at) {
				at = span[1] - 1;
				previous = source.charAt(at);
				continue;
			}
			const char = source.charAt(at);
			if (inMath(at)) {
				if (char === "[") mathBracket = true;
				inMathRun = true;
				previous = char;
				continue;
			}
			if (inMathRun) {
				if (mathBracket && !bracketed) {
					scan.bracketMath.push([at, end]);
					bracketed = true;
				}
				inMathRun = false;
				mathBracket = false;
			}
			if (char === "\\" && isAsciiPunctuation(source.charAt(at + 1))) {
				at++;
				previous = source.charAt(at);
				continue;
			}
			if (isAtext(char) && previous !== "/" && !isAtext(previous)) {
				const stop = emailEnd(source, at, end);
				if (stop >= 0) {
					if (depth === 0) scan.emails.push({ start: at, end: stop });
					at = stop - 1;
					previous = source.charAt(at);
					continue;
				}
			}
			if (char === "[" || (char === "!" && source.charAt(at + 1) === "[")) {
				if (depth === 0) from = at;
				depth++;
				if (char === "!") at++;
			} else if (char === "]" && depth > 0) {
				depth--;
				if (depth === 0) scan.open.push([from, at]);
			}
			previous = source.charAt(at);
		}
		if (inMathRun && mathBracket && !bracketed) scan.bracketMath.push([end, end]);
		if (depth > 0) scan.open.push([from, end]);
	}
	return scan;
};

// The index of the first span starting at or after `offset`.
const lowerBound = (spans: ReadonlyArray<Span>, offset: number): number => {
	let low = 0;
	let high = spans.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((spans[middle] as Span)[0] < offset) low = middle + 1;
		else high = middle;
	}
	return low;
};

// Whether `offset` lies inside one of the disjoint, ordered `spans` (start exclusive, end exclusive).
const within = (spans: ReadonlyArray<Span>, offset: number): boolean => {
	const index = lowerBound(spans, offset) - 1;
	return index >= 0 && offset < (spans[index] as Span)[1];
};

// The nodes markdownlint's walk visits among `children`: past the content between an inline HTML open tag and its
// matching close tag, the open tag itself left out whether or not it closes. upstream's count of same-name tags is
// bracket matching per name, so one stack per name pairs every tag in one pass.
const walked = (
	source: string,
	children: ReadonlyArray<MarkdownNode>,
	inline: boolean,
): ReadonlyArray<MarkdownNode> => {
	if (!inline) return children;
	const tags = children.map((child) => (child.type === "html" ? htmlTagInfo(sliceOf(source, child)) : undefined));
	const match = new Map<number, number>();
	const stacks = new Map<string, Array<number>>();
	for (const [index, tag] of tags.entries()) {
		if (tag === undefined) continue;
		const stack = stacks.get(tag.name) ?? [];
		stacks.set(tag.name, stack);
		if (!tag.close) stack.push(index);
		else {
			const open = stack.pop();
			if (open !== undefined) match.set(open, index);
		}
	}
	const kept: Array<MarkdownNode> = [];
	for (let index = 0; index < children.length; index++) {
		const tag = tags[index];
		if (tag === undefined || tag.close) kept.push(children[index] as MarkdownNode);
		else index = match.get(index) ?? index;
	}
	return kept;
};

// The literal autolinks markdownlint reports, in document order.
const bareUrls = (context: LintContext): ReadonlyArray<Literal> => {
	const { source } = context;
	const keep = outsideMath(context);
	const flow = mathFlowLines(context);
	const inMath = inMathText(context);
	// The URL literals, wrapped or not, and the text and literal nodes markdownlint's walk reaches, in document order
	// (an address counts where its `@` is in one).
	const urls: Array<Literal & { readonly wrapped: boolean }> = [];
	const texts: Array<MarkdownNode> = [];
	const reached: Array<Span> = [];
	const visit = (node: MarkdownNode, siblings: ReadonlyArray<MarkdownNode>, index: number): void => {
		if (isLiteral(source, node)) {
			if (!keep(node)) return;
			const start = node.position.start.offset;
			const end = node.position.end.offset;
			reached.push([start, end]);
			if (!isUrl(source.slice(start, end))) return;
			const previous = siblings[index - 1];
			const next = siblings[index + 1];
			const wrapped =
				previous?.type === "text" &&
				next?.type === "text" &&
				sliceOf(source, previous).endsWith("<") &&
				sliceOf(source, next).startsWith(">");
			const literal = micromarkUrl(source, start, end);
			if (literal !== undefined) urls.push({ ...literal, wrapped });
			return;
		}
		if (node.type === "text") {
			if (flow.has(node.position.start.line)) return;
			texts.push(node);
			reached.push([node.position.start.offset, node.position.end.offset]);
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

	// The inline blocks (paragraphs, headings, table cells) the scans and re-reads go over, in document order.
	const blocks = context.document.findAll(
		(node) => node.type === "paragraph" || node.type === "heading" || node.type === "tableCell",
	) as ReadonlyArray<MarkdownNode>;
	const textSpans = texts.map((text) => [text.position.start.offset, text.position.end.offset] as Span);
	for (const literal of otherCaseWww(source, blocks, textSpans)) {
		if (!inMath(literal.start)) urls.push({ ...literal, wrapped: false });
	}
	// The rest of a block after a `[` in inline math: the kit's parser took the bracket as open and linked nothing
	// after it. One re-read per block, its literals kept where they open in a text node the walk reaches.
	const first = scanBlocks(context, blocks, urls);
	let added = false;
	if (first.bracketMath.length > 0) {
		const known = new Set(urls.map((url) => url.start));
		for (const [from, end] of first.bracketMath) {
			// A URL or `www.` literal needs one of these: text without either is not re-parsed.
			const raw = source.slice(from, end);
			if (!raw.includes("://") && !/www\./i.test(raw)) continue;
			// Each character of inline math blanked, so a later bracket in math hides nothing either; the length holds.
			let blanked = "";
			for (let at = from; at < end; at++) blanked += inMath(at) ? " " : source.charAt(at);
			for (const literal of urlsAt(source, from, blanked)) {
				const text = textSpans[lowerBound(textSpans, literal.start + 1) - 1];
				if (text === undefined || literal.start >= text[1]) continue;
				if (known.has(literal.start) || inMath(literal.start)) continue;
				const url = micromarkUrl(source, literal.start, literal.end);
				if (url !== undefined) {
					urls.push({ ...url, wrapped: false });
					added = true;
				}
			}
		}
	}
	// A URL the re-read added holds no address and balances no bracket: scan again only then.
	const scan = added ? scanBlocks(context, blocks, urls) : first;
	reached.sort((a, b) => a[0] - b[0]);
	const found: Array<Literal> = [
		...urls.filter((url) => !url.wrapped && !within(scan.open, url.start)),
		...scan.emails.filter((email) => {
			const at = source.indexOf("@", email.start);
			const wrapped = source.charAt(email.start - 1) === "<" && source.charAt(email.end) === ">";
			const node = reached[lowerBound(reached, at + 1) - 1];
			return !wrapped && node !== undefined && at < node[1] && !inMath(email.start);
		}),
	];
	return found.sort((a, b) => a.start - b.start);
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
