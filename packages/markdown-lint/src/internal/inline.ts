// Inline content as markdownlint's micromark reads it: the kit's inline
// nodes, less any micromark reads as math (a math block's lines are
// `mathFlow`, and a `$` run that opens before a node makes the node part of
// its `mathText`); where micromark cuts its `data` tokens (marker runs it
// leaves bare, unmatched label openers, escapes, character references, line
// endings); code spans' padding and data; and the inline content of image
// descriptions and of re-read HTML blocks, which the kit tree does not carry.
// Every rule that reads inline content reads it here.

import type { Code, MarkdownNode } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Result } from "effect";
import type { LintContext } from "../LintContext.js";
import { codeFlowValues, codeNodes } from "./code-blocks.js";
import { contentInContainers, flowNodes } from "./containers.js";
import type { RereadLine } from "./html-reread.js";
import { sourceColumn } from "./html-reread.js";
import { isHtmlFlowComment, rereadBlock } from "./html-text.js";
import { inMathBlock, mathFlowBlocks, mathFlowLines } from "./math-flow.js";
import type { Span } from "./math-text.js";
import { labelEnd, mathTextSpans } from "./math-text.js";
import { perReading } from "./memo.js";

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

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

/** A point check over a document's inline math spans. @internal */
export const mathCheck = (document: MarkdownDocument, source: string): ((offset: number) => boolean) => {
	const spans = [...mathTextSpans(document, source)].sort((a, b) => a.start - b.start);
	return (offset) => inSortedSpans(spans, offset);
};

/** Whether `offset` lies in an inline math span. Built once per reading. @internal */
export const inMathText: (context: LintContext) => (offset: number) => boolean = perReading((context) =>
	mathCheck(context.document, context.source),
);

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

// The bare marker runs of each inline block of `document` over `source`, less any `inMath` holds or in a block
// `skip` passes over.
const bareRunsIn = (
	document: MarkdownDocument,
	source: string,
	inMath: (offset: number) => boolean,
	skip: (block: MarkdownNode) => boolean,
): ReadonlyArray<ReadonlyArray<BareMarker>> => {
	const blocks = document.findAll((node) => INLINE_BLOCKS.has(node.type)) as ReadonlyArray<MarkdownNode>;
	const found: Array<ReadonlyArray<BareMarker>> = [];
	for (const block of blocks) {
		if (skip(block)) continue;
		const runs: Array<BareMarker> = [];
		const scan = (node: MarkdownNode): void => {
			if (node.type === "delete") {
				for (const child of childrenOf(node)) scan(child);
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
		for (const child of childrenOf(block)) scan(child);
		found.push(runs);
	}
	return found;
};

/**
 * The bare emphasis-marker runs of each block's top-level inline content, in
 * order: the runs of `*` or `_` left in the block's own text (and in a
 * strikethrough's, which micromark does not parse) once the delimiters that
 * pair are emphasis. micromark leaves each as a `data` token of its own
 * there, where inside an emphasis, a strong or a link label its resolver
 * merges them into the text around. A run escaped by a backslash, or inside
 * inline math, is none; a block in a math block is math. Computed once per
 * reading.
 * @internal
 */
export const bareMarkers: (context: LintContext) => ReadonlyArray<ReadonlyArray<BareMarker>> = perReading((context) => {
	const flow = mathFlowLines(context);
	return bareRunsIn(context.document, context.source, inMathText(context), (block) =>
		flow.has(block.position.start.line),
	);
});

/** A `data` token's text: `[start, end)` of a view's source, on one line. @internal */
export interface DataSegment {
	readonly start: number;
	readonly end: number;
}

/**
 * A source micromark's inline tokens are read over: the reading's own, a
 * re-read HTML block's text, or a re-parsed image label. `contentStart`
 * gives where a line's inline content starts, past its containers' prefix,
 * for the line starting at `offset`; `bare` maps each bare marker run's start
 * to its end.
 * @internal
 */
export interface TokenView {
	readonly source: string;
	readonly inMath: (offset: number) => boolean;
	readonly bare: ReadonlyMap<number, number>;
	readonly contentStart: (offset: number) => number;
}

const bareMap = (runs: ReadonlyArray<ReadonlyArray<BareMarker>>): ReadonlyMap<number, number> => {
	const bare = new Map<number, number>();
	for (const block of runs) for (const run of block) bare.set(run.start, run.end);
	return bare;
};

/** The reading's own {@link TokenView}. Built once per reading. @internal */
export const documentDataView: (context: LintContext) => TokenView = perReading((context) => ({
	source: context.source,
	inMath: inMathText(context),
	bare: bareMap(bareMarkers(context)),
	contentStart: (offset) => {
		const lineNumber = context.mapping.lineNumber(offset);
		const line = context.lines[lineNumber - 1] ?? "";
		const content = contentInContainers(context, lineNumber) ?? line;
		return context.mapping.lineStart(lineNumber) + line.length - content.length;
	},
}));

/** A character reference's shape, before {@link isReference} asks whether micromark decodes it. @internal */
export const characterReference = /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/;
const labelOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });
const references = new Map<string, boolean>();

/** Whether `text` is a character reference micromark decodes: a numeric one, or a named one the parser knows. @internal */
export const isReference = (text: string): boolean => {
	const known = references.get(text);
	if (known !== undefined) return known;
	const parsed = MarkdownDocument.parseResult(text, labelOptions);
	const decoded =
		Result.isSuccess(parsed) &&
		(parsed.success.findAll("text") as ReadonlyArray<MarkdownNode & { readonly value?: string }>).every(
			(node) => node.value !== text,
		);
	references.set(text, decoded);
	return decoded;
};

/**
 * micromark's `data` tokens over `[start, end)` of plain inline text (text
 * and strikethrough delimiters, which markdownlint does not parse): cut at a
 * line ending (the next line's container prefix and leading whitespace, and
 * the whitespace before the ending, are no data), at inline math, at a
 * character escape or reference (no data either), at an unmatched `[` or
 * `![` (a token of its own, inside emphasis too) and at a bare marker run
 * (one too). A `]` cuts nothing.
 * @internal
 */
export const splitData = (view: TokenView, start: number, end: number, push: (segment: DataSegment) => void): void => {
	const { source } = view;
	let from = start;
	const close = (at: number) => {
		if (at > from) push({ start: from, end: at });
	};
	let at = start;
	while (at < end) {
		const char = source.charAt(at);
		if (char === "\n" || char === "\r") {
			let stop = at;
			while (stop > from && /[ \t]/.test(source.charAt(stop - 1))) stop--;
			close(stop);
			at += char === "\r" && source.charAt(at + 1) === "\n" ? 2 : 1;
			at = Math.min(end, Math.max(at, view.contentStart(at)));
			while (at < end && /[ \t]/.test(source.charAt(at))) at++;
			from = at;
			continue;
		}
		if (view.inMath(at)) {
			close(at);
			while (at < end && view.inMath(at)) at++;
			from = at;
			continue;
		}
		if (char === "\\" && /[!-/:-@[-`{-~]/.test(source.charAt(at + 1))) {
			close(at);
			at += 2;
			from = at;
			continue;
		}
		if (char === "&") {
			const reference = characterReference.exec(source.slice(at, Math.min(end, at + 40)))?.[0];
			if (reference !== undefined && isReference(reference)) {
				close(at);
				at += reference.length;
				from = at;
				continue;
			}
		}
		const opener = char === "[" ? 1 : char === "!" && source.charAt(at + 1) === "[" ? 2 : 0;
		const token = opener > 0 ? at + opener : view.bare.get(at);
		if (token !== undefined && token > at) {
			close(at);
			push({ start: at, end: token });
			at = token;
			from = at;
			continue;
		}
		at++;
	}
	close(end);
};

/**
 * The `data` tokens of one block's inline content (a paragraph, heading or
 * table cell), in order: each run of plain text (text nodes, and a
 * strikethrough's text and delimiters) through {@link splitData}, descending
 * into emphasis, strong, links with a label and link references. Every other
 * node ends a run and is handed to `other`, when given.
 * @internal
 */
export const blockDataTokens = (
	view: TokenView,
	block: MarkdownNode,
	push: (segment: DataSegment) => void,
	other?: (node: MarkdownNode) => void,
): void => {
	let runStart: number | undefined;
	let runEnd = 0;
	const flush = () => {
		if (runStart !== undefined) splitData(view, runStart, runEnd, push);
		runStart = undefined;
	};
	const plain = (start: number, end: number) => {
		if (end <= start) return;
		if (runStart === undefined || start !== runEnd) {
			flush();
			runStart = start;
		}
		runEnd = end;
	};
	const visit = (node: MarkdownNode): void => {
		const start = node.position.start.offset;
		const end = node.position.end.offset;
		const children = childrenOf(node);
		switch (node.type) {
			case "text":
				plain(start, end);
				return;
			case "delete": {
				// Its delimiters are text to markdownlint, which parses no strikethrough.
				const first = children[0];
				const last = children.at(-1);
				plain(start, first?.position.start.offset ?? end);
				for (const child of children) visit(child);
				if (last !== undefined) plain(last.position.end.offset, end);
				return;
			}
			case "emphasis":
			case "strong":
			case "linkReference":
				flush();
				for (const child of children) visit(child);
				flush();
				return;
			case "link":
				flush();
				// An autolink is no `data`: only a link with a label is read.
				if (view.source.charAt(start) === "[") for (const child of children) visit(child);
				else other?.(node);
				flush();
				return;
			default:
				flush();
				other?.(node);
		}
	};
	for (const child of childrenOf(block)) visit(child);
	flush();
};

/** One of a code span's content tokens: a space, a line ending, or a run of data. @internal */
export interface CodeSpanToken {
	readonly kind: "space" | "eol" | "data";
	readonly start: number;
	readonly end: number;
}

// A code span's content tokens, as micromark's code text tokenizer reads them before its resolver runs.
const codeSpanTokens = (view: TokenView, start: number, end: number): Array<CodeSpanToken> => {
	const { source } = view;
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
			at = Math.max(at, view.contentStart(at));
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
 * A code span as micromark tokenizes it, read back from its source in
 * `view`: its source text, its `codeTextPadding` (the first and last content
 * token, when both are a space or a line ending and there is data between)
 * and its `codeTextData` runs (everything between, merged and split at line
 * endings). Each space is a token and each line ending one, the next line's
 * container prefix skipped and its leading whitespace kept. A code span's
 * position starts at its opening backtick run and ends past its closing one.
 * @internal
 */
export const codeSpanPartsIn = (
	view: TokenView,
	code: MarkdownNode,
): {
	readonly span: string;
	readonly paddings: ReadonlyArray<CodeSpanToken>;
	readonly datas: ReadonlyArray<CodeSpanToken>;
} => {
	const spanStart = code.position.start.offset;
	const spanEnd = code.position.end.offset;
	const span = view.source.slice(spanStart, spanEnd);
	const sequence = (/^`+/.exec(span)?.[0] ?? "").length;
	const tokens = codeSpanTokens(view, spanStart + sequence, spanEnd - sequence);
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

/** A code span of the reading as micromark tokenizes it (see {@link codeSpanPartsIn}). @internal */
export const codeSpanParts = (context: LintContext, code: MarkdownNode): ReturnType<typeof codeSpanPartsIn> =>
	codeSpanPartsIn(documentDataView(context), code);

/**
 * An inline node or token read from source the kit tree does not carry it
 * in: its type (`emphasis`, `strong`, `data`, `codeData` for a code span's
 * data run, `linkLabel` for a link's bracketed label, `linkLabelCoded` for
 * one holding a code span or inline HTML directly, or `link` for the whole
 * link) and source span, on one line for `data` and `codeData`.
 * @internal
 */
export interface InlineSpan {
	readonly type: string;
	readonly start: number;
	readonly end: number;
}

// The parser's label key (`@effected/markdown`'s `normalizeLabelText`, which keys `MarkdownDocument.definitions`).
const definitionKey = (label: string): string =>
	label
		.trim()
		.replace(/[ \t\r\n]+/g, " ")
		.toLowerCase()
		.toUpperCase();

/**
 * The definitions an image label's re-parse appends, after a blank line each,
 * so the references its own brackets name resolve as they do in the reading:
 * one stand-in (`[label]: x`) per distinct label the document defines, keyed
 * as the parser keys `definitions`. A definition's destination and title play
 * no part in how the label parses, so the appended text is bounded by the
 * label's own length whatever the definitions hold.
 * @internal
 */
export const labelDefinitions = (label: string, definitions: ReadonlyMap<string, unknown>): string => {
	if (definitions.size === 0) return "";
	const seen = new Set<string>();
	let named = "";
	for (const match of label.matchAll(/\[([^[\]]*)\]/g)) {
		const written = match[1] ?? "";
		const key = definitionKey(written);
		if (seen.has(key) || !definitions.has(key)) continue;
		seen.add(key);
		// On one line, so the stand-in is a definition and not paragraph text: the same key.
		named += `\n\n[${written.trim().replace(/[ \t\r\n]+/g, " ")}]: x`;
	}
	return named;
};

// A view over a re-parsed label's text: no containers, no bare runs (a label's content is merged), its own math.
const labelView = (document: MarkdownDocument, source: string): TokenView => ({
	source,
	inMath: mathCheck(document, source),
	bare: new Map(),
	contentStart: (offset) => offset,
});

// The inline content of the image label in `text` from `open` (its `[`) to `close` (its `]`), whose characters
// `toSource` maps to the reading's source, pushed in source offsets: its emphasis and strong, its `data` tokens and its code
// spans' data runs, and those of any image nested in it, read the same way.
const readLabel = (
	text: string,
	textToSource: (offset: number) => number | undefined,
	open: number,
	close: number,
	inMath: (offset: number) => boolean,
	definitions: ReadonlyMap<string, unknown>,
	push: (span: InlineSpan) => void,
): void => {
	// The label is re-parsed after its own `[`, as a paragraph: links cannot nest, so a label holding a link would not
	// re-parse as a link's label, and the unmatched `[` keeps the label's start as micromark reads it.
	// A stand-in for each definition the label's own brackets name follows (see `labelDefinitions`), so its references
	// resolve as they do in the reading and many images and definitions stay linear.
	const label = text.slice(open + 1, close);
	const source = `[${label}${labelDefinitions(label, definitions)}`;
	const parsed = MarkdownDocument.parseResult(source, labelOptions);
	if (!Result.isSuccess(parsed)) return;
	const document = parsed.success;
	// A re-parsed offset to the reading's: the `[` is the label's own, the rest the label's characters. Composed, not
	// copied, so an image nested in the label costs its own label's length, not this one's.
	const toSource = (offset: number) => textToSource(open + offset);
	const mapped = (type: string, start: number, end: number) => {
		const first = toSource(start);
		const last = toSource(end - 1);
		if (first !== undefined && last !== undefined && !inMath(first)) push({ type, start: first, end: last + 1 });
	};
	const view = labelView(document, source);
	const paragraph = childrenOf(document.root as MarkdownNode)[0];
	if (paragraph === undefined) return;
	blockDataTokens(
		view,
		paragraph,
		// The label's own `[` is no token of its content.
		(segment) => {
			if (segment.start > 0) mapped("data", segment.start, segment.end);
		},
		(node) => {
			if (node.type === "inlineCode") {
				if (view.inMath(node.position.start.offset)) return;
				for (const data of codeSpanPartsIn(view, node).datas) mapped("codeData", data.start, data.end);
			} else if (node.type === "image" || node.type === "imageReference") {
				const start = node.position.start.offset;
				const end = labelEnd(source, start + 1, node.position.end.offset);
				readLabel(source, toSource, start + 1, end, inMath, definitions, push);
			}
		},
	);
	for (const node of document.findAll(
		(each) =>
			(each.type === "link" && source.charAt(each.position.start.offset) === "[") || each.type === "linkReference",
	) as ReadonlyArray<MarkdownNode>) {
		if (view.inMath(node.position.start.offset)) continue;
		const labelClose = labelEnd(source, node.position.start.offset, node.position.end.offset);
		mapped("linkLabel", node.position.start.offset, labelClose + 1);
		mapped("link", node.position.start.offset, node.position.end.offset);
		// A label holding a code span or inline HTML directly, which MD059 passes over.
		if (childrenOf(node).some((child) => child.type === "inlineCode" || child.type === "html")) {
			mapped("linkLabelCoded", node.position.start.offset, labelClose + 1);
		}
	}
	for (const node of document.findAll(
		(each) => each.type === "emphasis" || each.type === "strong",
	) as ReadonlyArray<MarkdownNode>) {
		if (view.inMath(node.position.start.offset)) continue;
		mapped(node.type, node.position.start.offset, node.position.end.offset);
	}
};

/**
 * PARSER GAP: the inline content of image descriptions. micromark parses an
 * image's label as inline content, where the kit's image carries its alt as a
 * string, so each label (its continuation lines' container prefixes left out)
 * is re-parsed after its own `[`, as a paragraph (links cannot nest, so a
 * label holding a link would not re-parse as a link's label): its emphasis and
 * strong, its `data` tokens (see {@link splitData}), its code spans' data runs
 * and its links (`link`) and their labels (`linkLabel`, brackets included), mapped back to their
 * source offsets. References in a label resolve against no definitions there. An image nested in a
 * label is read the same way, so an outer label's text is re-parsed once with
 * each image it holds. Those micromark reads as math are dropped. Computed
 * once per reading.
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
	if (images.length === 0) return found;
	// The document's definitions, by the parser's key, for a label's references to resolve against.
	const definitions = context.document.definitions;
	for (const image of images) {
		if (!keep(image)) continue;
		const open = image.position.start.offset + 1;
		const close = labelEnd(source, open, image.position.end.offset);
		// The label's text from its `[`, and each character's source offset, continuation lines' prefixes left out.
		let text = "[";
		const offsets: Array<number> = [open];
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
		text += "]";
		offsets.push(close);
		readLabel(
			text,
			(offset) => offsets[offset],
			0,
			text.length - 1,
			inMath,
			definitions,
			(span) => found.push(span),
		);
	}
	return found.sort((a, b) => a.start - b.start);
});

/**
 * An HTML block's re-read content as a {@link TokenView}: the re-read
 * document over its text (see `rereadBlock`), its own inline math and bare
 * marker runs, a continuation line's inline content past its blockquote
 * markers, and `toSource`, which maps a re-read offset back to the block's
 * source line (`undefined` on a stub line the re-read inserted). Built once
 * per block per reading.
 * @internal
 */
export const rereadDataView = (
	context: LintContext,
	block: MarkdownNode,
):
	| {
			readonly view: TokenView;
			readonly document: MarkdownDocument;
			readonly lines: ReadonlyArray<RereadLine>;
			readonly toSource: (offset: number) => number | undefined;
	  }
	| undefined => {
	const cache = rereadViews(context);
	if (cache.has(block)) return cache.get(block);
	const { document, lines } = rereadBlock(context, block);
	let built: ReturnType<typeof rereadDataView>;
	if (document !== undefined) {
		const source = lines.map((line) => line.text).join("\n");
		const inMath = mathCheck(document, source);
		const view: TokenView = {
			source,
			inMath,
			bare: bareMap(bareRunsIn(document, source, inMath, () => false)),
			contentStart: (offset) =>
				offset + (/^(?:[ \t]{0,3}>[ \t]?)*/.exec(source.slice(offset, offset + 64))?.[0].length ?? 0),
		};
		const toSource = (offset: number): number | undefined => {
			const row = document.lineIndex.lineAt(offset);
			const line = lines[row];
			if (line === undefined || line.origin === 0) return undefined;
			const column = sourceColumn(line, offset - document.lineIndex.lineStart(row));
			return context.mapping.lineStart(line.origin) + Math.min(column, context.lines[line.origin - 1]?.length ?? 0);
		};
		built = { view, document, lines, toSource };
	}
	cache.set(block, built);
	return built;
};

const rereadViews: (context: LintContext) => Map<MarkdownNode, ReturnType<typeof rereadDataView>> = perReading(
	() => new Map(),
);

/** Which tokens beside `data` a text scan reads: code (`codeFlowValue`, `codeTextData`) and HTML. @internal */
export interface TextScan {
	readonly code: boolean;
	readonly html: boolean;
}

// `[start, end)` of `view`'s source, one segment per line, each continuation line from past its containers' prefix:
// an HTML token's `htmlTextData` or `htmlFlowData` lines.
const linePieces = (view: TokenView, start: number, end: number, push: (segment: DataSegment) => void): void => {
	let from = start;
	for (let at = start; at <= end; at++) {
		const char = at < end ? view.source.charAt(at) : "";
		if (at < end && char !== "\n" && char !== "\r") continue;
		if (at > from) push({ start: from, end: at });
		if (char === "\r" && view.source.charAt(at + 1) === "\n") at++;
		from = Math.max(at + 1, view.contentStart(at + 1));
	}
};

// The token texts markdownlint scans in one block's inline content: its `data` tokens (see `blockDataTokens`), and
// by setting its code spans' data runs and its inline HTML, and its footnote calls' labels.
const blockSegments = (
	view: TokenView,
	block: MarkdownNode,
	scan: TextScan,
	push: (segment: DataSegment) => void,
): void =>
	blockDataTokens(view, block, push, (node) => {
		const start = node.position.start.offset;
		const end = node.position.end.offset;
		if (view.inMath(start)) return;
		if (node.type === "inlineCode" && scan.code) for (const data of codeSpanPartsIn(view, node).datas) push(data);
		else if (node.type === "html" && scan.html) linePieces(view, start, end, push);
		else if (node.type === "footnoteReference") push({ start: start + 2, end: end - 1 });
	});

/**
 * Every token text markdownlint's MD044 scans, in source offsets and
 * document order, each on one line: the `data` tokens of each block's inline
 * content (see {@link blockDataTokens}), of image descriptions (see
 * {@link imageLabelNodes}), of footnote call and definition labels, and of
 * each HTML block's re-read content (see {@link rereadDataView}), mapped back;
 * with `scan.code`, code spans' data runs and code blocks' lines; with
 * `scan.html`, inline HTML and an HTML comment block's lines. Inline and
 * block math is no token text.
 * @internal
 */
export const textTokens = (context: LintContext, scan: TextScan): ReadonlyArray<DataSegment> => {
	const { source } = context;
	const segments: Array<DataSegment> = [];
	const push = (segment: DataSegment) => segments.push(segment);
	const flow = mathFlowLines(context);
	const math = mathFlowBlocks(context);
	const view = documentDataView(context);
	for (const block of context.document.findAll((node) => INLINE_BLOCKS.has(node.type)) as ReadonlyArray<MarkdownNode>) {
		if (!flow.has(block.position.start.line)) blockSegments(view, block, scan, push);
	}
	for (const span of imageLabelNodes(context)) {
		if (span.type === "data" || (span.type === "codeData" && scan.code)) push(span);
	}
	for (const node of context.document.findAll("footnoteDefinition") as ReadonlyArray<MarkdownNode>) {
		const start = node.position.start.offset + 2;
		const close = source.indexOf("]", start);
		if (close !== -1 && !flow.has(node.position.start.line)) push({ start, end: close });
	}
	if (scan.code) {
		for (const code of codeNodes(context)) {
			// Strict: a fence starting on a math opener line holds the opener (see `inMathBlock`).
			if (inMathBlock(math, code.position.start.line)) continue;
			for (const value of codeFlowValues(context, code as Code)) {
				push({ start: value.offset, end: value.offset + value.text.length });
			}
		}
	}
	for (const block of flowNodes(context, new Set(["html"]))) {
		if (flow.has(block.position.start.line)) continue;
		if (isHtmlFlowComment(context, block)) {
			if (scan.html) linePieces(view, block.position.start.offset, block.position.end.offset, push);
			continue;
		}
		// markdownlint re-parses the block's lines: its content is read there and mapped back.
		const reread = rereadDataView(context, block);
		if (reread === undefined) continue;
		const mapped = (segment: DataSegment) => {
			const start = reread.toSource(segment.start);
			const end = reread.toSource(segment.end);
			if (start !== undefined && end !== undefined && end > start) push({ start, end });
		};
		for (const inner of reread.document.findAll((node) =>
			INLINE_BLOCKS.has(node.type),
		) as ReadonlyArray<MarkdownNode>) {
			blockSegments(reread.view, inner, scan, mapped);
		}
	}
	return segments.sort((a, b) => a.start - b.start);
};
