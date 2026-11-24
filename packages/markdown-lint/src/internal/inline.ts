// Inline content as markdownlint's micromark reads it: the kit's inline
// nodes, less any micromark reads as math. A math block's lines are
// `mathFlow`, and a `$` run that opens before a node makes the node part of
// its `mathText`, so neither carries the inline tokens an inline rule walks.
// Every rule that reads inline nodes enumerates them here.

import type { MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Result } from "effect";
import type { LintContext } from "../LintContext.js";
import { contentInContainers } from "./containers.js";
import { mathFlowLines } from "./math-flow.js";
import type { Span } from "./math-text.js";
import { labelEnd, mathTextSpans } from "./math-text.js";
import { perReading } from "./memo.js";

// Whether `offset` lies in one of `spans`, which are sorted by start and do not overlap: a binary search.
const inSortedSpans = (spans: ReadonlyArray<Span>, offset: number): boolean => {
	let low = 0;
	let high = spans.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const span = spans[middle] as Span;
		if (offset < span.start) high = middle - 1;
		else if (offset >= span.end) low = middle + 1;
		else return true;
	}
	return false;
};

/**
 * Whether micromark reads the inline content at `node`'s start as inline
 * content, not math: its line is in no math block (inclusive: on a math
 * opener line it is the fence's meta, see `mathFlowLines`) and its start in
 * no inline math span. Built once per reading.
 * @internal
 */
export const outsideMath: (context: LintContext) => (node: MarkdownNode) => boolean = perReading((context) => {
	const flow = mathFlowLines(context);
	const inMath = inMathText(context);
	return (node) => !flow.has(node.position.start.line) && !inMath(node.position.start.offset);
});

/** Whether `offset` lies in an inline math span. Built once per reading. @internal */
export const inMathText: (context: LintContext) => (offset: number) => boolean = perReading((context) => {
	const spans = [...mathTextSpans(context.document, context.source)].sort((a, b) => a.start - b.start);
	return (offset) => inSortedSpans(spans, offset);
});

/**
 * Every inline node of `type`, in document order, less any micromark reads
 * as math (see {@link outsideMath}).
 * @internal
 */
export const inlineNodes = (context: LintContext, type: string): ReadonlyArray<MarkdownNode> => {
	const keep = outsideMath(context);
	return (context.document.findAll((node) => node.type === type) as ReadonlyArray<MarkdownNode>).filter(keep);
};

/** A run of `*` or `_` micromark leaves bare: an attention sequence that matched nothing, its own `data` token. @internal */
export interface BareMarker {
	readonly marker: string;
	readonly start: number;
	readonly end: number;
}

// The blocks whose inline content micromark reads as one token's children: a paragraph, a heading, a table cell.
const INLINE_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "tableCell"]);

/**
 * The bare emphasis-marker runs of each block's top-level inline content, in
 * order: the runs of `*` or `_` left in the block's own text (and in a
 * strikethrough's, which micromark does not parse) once the delimiters that
 * pair are emphasis. micromark leaves each as a `data` token of its own
 * there, where inside an emphasis, a strong or a link label its resolver
 * merges them into the text around. A run escaped by a backslash, or inside
 * inline math, is none. Computed once per reading.
 * @internal
 */
export const bareMarkers: (context: LintContext) => ReadonlyArray<ReadonlyArray<BareMarker>> = perReading((context) => {
	const { source } = context;
	const flow = mathFlowLines(context);
	const inMath = inMathText(context);
	const blocks = context.document.findAll((node) => INLINE_BLOCKS.has(node.type)) as ReadonlyArray<MarkdownNode>;
	const found: Array<ReadonlyArray<BareMarker>> = [];
	for (const block of blocks) {
		// A block in a math block is math; within a block, each run is checked against inline math on its own.
		if (flow.has(block.position.start.line)) continue;
		const runs: Array<BareMarker> = [];
		const scan = (node: MarkdownNode): void => {
			if (node.type === "delete") {
				for (const child of (node as { readonly children: ReadonlyArray<MarkdownNode> }).children) scan(child);
				return;
			}
			if (node.type !== "text") return;
			const end = node.position.end.offset;
			let at = node.position.start.offset;
			while (at < end) {
				const char = source.charAt(at);
				if (char === "\\" && /[!-/:-@[-`{-~]/.test(source.charAt(at + 1))) {
					at += 2;
					continue;
				}
				if (char !== "*" && char !== "_") {
					at++;
					continue;
				}
				let stop = at;
				while (stop < end && source.charAt(stop) === char) stop++;
				if (!inMath(at)) runs.push({ marker: source.slice(at, stop), start: at, end: stop });
				at = stop;
			}
		};
		for (const child of (block as { readonly children: ReadonlyArray<MarkdownNode> }).children) scan(child);
		found.push(runs);
	}
	return found;
});

/** An inline node read from source the kit tree does not carry it in: its type and source span. @internal */
export interface InlineSpan {
	readonly type: string;
	readonly start: number;
	readonly end: number;
}

const labelOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

/**
 * PARSER GAP: the inline nodes of image descriptions. micromark parses an
 * image's label as inline content, where the kit's image carries its alt as a
 * string, so each label (its continuation lines' container prefixes left out)
 * is re-parsed as a link label, which CommonMark parses the same way, and its
 * emphasis, strong and text nodes mapped back to their source offsets, a text
 * node as one piece per source line. The emphasis micromark reads as math is
 * dropped. Computed once per reading.
 * @internal
 */
export const imageLabelNodes: (context: LintContext) => ReadonlyArray<InlineSpan> = perReading((context) => {
	const { source } = context;
	const keep = outsideMath(context);
	const inMath = inMathText(context);
	const found: Array<InlineSpan> = [];
	const images = context.document.findAll(
		(node) => node.type === "image" || node.type === "imageReference",
	) as ReadonlyArray<MarkdownNode>;
	for (const image of images) {
		if (!keep(image)) continue;
		const open = image.position.start.offset + 1;
		const close = labelEnd(source, open, image.position.end.offset);
		// The label's text, and each character's source offset.
		let text = "";
		const offsets: Array<number> = [];
		for (let at = open + 1; at < close; at++) {
			const char = source.charAt(at);
			text += char;
			offsets.push(at);
			if (char === "\n" || (char === "\r" && source.charAt(at + 1) !== "\n")) {
				const lineNumber = context.mapping.lineNumber(at + 1);
				const line = context.lines[lineNumber - 1] ?? "";
				const content = contentInContainers(context, lineNumber) ?? line;
				at = Math.max(at, context.mapping.lineStart(lineNumber) + line.length - content.length - 1);
			}
		}
		const parsed = MarkdownDocument.parseResult(`[${text}](u)`, labelOptions);
		if (!Result.isSuccess(parsed)) continue;
		for (const node of parsed.success.findAll(
			(each) => each.type === "emphasis" || each.type === "strong" || each.type === "text",
		) as ReadonlyArray<MarkdownNode>) {
			const from = node.position.start.offset - 1;
			const to = node.position.end.offset - 1;
			if (node.type !== "text") {
				const first = offsets[from];
				const last = offsets[to - 1];
				if (first === undefined || last === undefined || inMath(first)) continue;
				found.push({ type: node.type, start: first, end: last + 1 });
				continue;
			}
			// A text node's pieces, one per source line: where the label's offsets jump, a line's prefix was left out.
			let pieceStart = from;
			for (let index = from; index <= to; index++) {
				const at = offsets[index];
				const previous = offsets[index - 1];
				const breaks =
					index === to || at === undefined || (index > pieceStart && previous !== undefined && at !== previous + 1);
				const isLineBreak = at !== undefined && (source.charAt(at) === "\n" || source.charAt(at) === "\r");
				if (!breaks && !isLineBreak) continue;
				const first = offsets[pieceStart];
				const last = offsets[index - 1];
				if (first !== undefined && last !== undefined && index > pieceStart) {
					found.push({ type: "text", start: first, end: last + 1 });
				}
				pieceStart = isLineBreak ? index + 1 : index;
			}
		}
	}
	return found;
});

/** One of a code span's content tokens: a space, a line ending, or a run of data. @internal */
export interface CodeSpanToken {
	readonly kind: "space" | "eol" | "data";
	readonly start: number;
	readonly end: number;
}

// A code span's content tokens, as micromark's code text tokenizer reads them before its resolver runs.
const codeSpanTokens = (context: LintContext, start: number, end: number): Array<CodeSpanToken> => {
	const { source } = context;
	const tokens: Array<CodeSpanToken> = [];
	let at = start;
	while (at < end) {
		const char = source.charAt(at);
		if (char === " ") {
			tokens.push({ kind: "space", start: at, end: at + 1 });
			at++;
		} else if (char === "\n" || char === "\r") {
			const length = char === "\r" && source.charAt(at + 1) === "\n" ? 2 : 1;
			tokens.push({ kind: "eol", start: at, end: at + length });
			at += length;
			// The next line's container prefix is no part of the inline content; its leading whitespace is.
			const lineNumber = context.mapping.lineNumber(at);
			const line = context.lines[lineNumber - 1] ?? "";
			const content = contentInContainers(context, lineNumber) ?? line;
			at = Math.max(at, context.mapping.lineStart(lineNumber) + line.length - content.length);
		} else {
			const last = tokens.at(-1);
			if (last?.kind === "data" && last.end === at) tokens[tokens.length - 1] = { ...last, end: at + 1 };
			else tokens.push({ kind: "data", start: at, end: at + 1 });
			at++;
		}
	}
	return tokens;
};

/**
 * A code span as micromark tokenizes it, read back from its source: its
 * source text, its `codeTextPadding` (the first and last content token, when
 * both are a space or a line ending and there is data between) and its
 * `codeTextData` runs (everything between, merged and split at line
 * endings). Each space is a token and each line ending one, the next line's
 * container prefix skipped and its leading whitespace kept. A code span's
 * position starts at its opening backtick run and ends past its closing one.
 * @internal
 */
export const codeSpanParts = (
	context: LintContext,
	code: MarkdownNode,
): {
	readonly span: string;
	readonly paddings: ReadonlyArray<CodeSpanToken>;
	readonly datas: ReadonlyArray<CodeSpanToken>;
} => {
	const spanStart = code.position.start.offset;
	const spanEnd = code.position.end.offset;
	const span = context.source.slice(spanStart, spanEnd);
	const sequence = (/^`+/.exec(span)?.[0] ?? "").length;
	const tokens = codeSpanTokens(context, spanStart + sequence, spanEnd - sequence);
	const first = tokens[0];
	const last = tokens.at(-1);
	const blank = (token: CodeSpanToken | undefined) => token !== undefined && token.kind !== "data";
	let paddings: ReadonlyArray<CodeSpanToken> = [];
	let inner = tokens;
	if (blank(first) && blank(last) && tokens.slice(1, -1).some((token) => token.kind === "data")) {
		paddings = [first as CodeSpanToken, last as CodeSpanToken];
		inner = tokens.slice(1, -1);
	}
	const datas: Array<CodeSpanToken> = [];
	let open = false;
	for (const token of inner) {
		if (token.kind === "eol") {
			open = false;
			continue;
		}
		const run = datas.at(-1);
		if (open && run !== undefined) datas[datas.length - 1] = { ...run, end: token.end };
		else datas.push({ kind: "data", start: token.start, end: token.end });
		open = true;
	}
	return { span, paddings, datas };
};
