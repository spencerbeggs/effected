// MD044 `proper-names`: a port of markdownlint's lib/md044.mjs over the kit
// tree. markdownlint matches each name over the text of its `data` tokens
// (and, by setting, `codeFlowValue`/`codeTextData` and
// `htmlFlowData`/`htmlTextData`), leaving out link destinations, references,
// definitions and fence info. A token's edges are word boundaries to its
// pattern, so the kit reads the same token texts: each text run of a block's
// inline content, split at line breaks and at the marker runs micromark
// leaves bare (see `bareMarkers`) and cut around inline math; image
// descriptions (see `imageLabelNodes`); footnote labels; code-span data (see
// `codeSpanParts`) and code lines (see `codeFlowValues`); inline HTML; an
// HTML comment block's lines; and an HTML block's re-read content.

import type { Code, MarkdownDocument, MarkdownNode } from "@effected/markdown";
import { MarkdownDocument as Document, MarkdownParseOptions } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { Result } from "effect";
import { codeFlowValues, codeNodes } from "../internal/code-blocks.js";
import { sourceColumn } from "../internal/html-reread.js";
import { isHtmlFlowComment, rereadBlock } from "../internal/html-text.js";
import { bareMarkers, codeSpanParts, imageLabelNodes, inMathText } from "../internal/inline.js";
import { inMathBlock, mathFlowBlocks, mathFlowLines } from "../internal/math-flow.js";
import { inSpans, mathTextSpans } from "../internal/math-text.js";
import { unmaskedSource } from "../internal/memo.js";
import { flagSettingOn } from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

/** A token's text: `[start, end)` of the source, on one line. */
interface Segment {
	readonly start: number;
	readonly end: number;
}

interface Scan {
	readonly code: boolean;
	readonly html: boolean;
}

const INLINE_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "tableCell"]);
const autolinkOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

// `[start, end)` of `source` as one segment per line, less the spans `cut` covers (inline math).
const pieces = (
	source: string,
	start: number,
	end: number,
	cut: (offset: number) => boolean,
	push: (segment: Segment) => void,
): void => {
	let from = start;
	for (let at = start; at <= end; at++) {
		const char = at < end ? source.charAt(at) : "";
		const stop = at === end || char === "\n" || char === "\r" || cut(at);
		if (!stop) continue;
		if (at > from) push({ start: from, end: at });
		from = at + 1;
	}
};

// The token texts of one inline block's (or one re-read document's) inline content, in `view`'s offsets.
const inlineSegments = (
	view: string,
	block: MarkdownNode,
	scan: Scan,
	inMath: (offset: number) => boolean,
	bare: ReadonlySet<number>,
	codeData: (code: MarkdownNode) => ReadonlyArray<Segment>,
	push: (segment: Segment) => void,
): void => {
	const visit = (node: MarkdownNode): void => {
		const { start, end } = { start: node.position.start.offset, end: node.position.end.offset };
		switch (node.type) {
			case "text": {
				// A bare marker run is a token of its own: the text either side of it is two.
				let from = start;
				for (let at = start; at < end; at++) {
					if (!bare.has(at)) continue;
					let stop = at;
					while (stop < end && view.charAt(stop) === view.charAt(at)) stop++;
					pieces(view, from, at, inMath, push);
					pieces(view, at, stop, inMath, push);
					from = stop;
					at = stop - 1;
				}
				pieces(view, from, end, inMath, push);
				return;
			}
			case "inlineCode":
				if (scan.code && !inMath(start)) for (const data of codeData(node)) push(data);
				return;
			case "html":
				if (scan.html && !inMath(start)) pieces(view, start, end, () => false, push);
				return;
			case "footnoteReference":
				if (!inMath(start)) pieces(view, start + 2, end - 1, () => false, push);
				return;
			case "link":
				// An autolink is no `data`: only a link with a label is read.
				if (view.charAt(start) !== "[") return;
				break;
			case "image":
			case "imageReference":
			case "break":
				return;
			default:
				break;
		}
		for (const child of childrenOf(node)) visit(child);
	};
	for (const child of childrenOf(block)) visit(child);
};

// Every token text markdownlint scans, in source offsets and document order.
const segmentsOf = (context: LintContext, scan: Scan): ReadonlyArray<Segment> => {
	const { source } = context;
	const segments: Array<Segment> = [];
	const push = (segment: Segment) => segments.push(segment);
	const flow = mathFlowLines(context);
	const math = mathFlowBlocks(context);
	const inMath = inMathText(context);
	const bare = new Set(bareMarkers(context).flatMap((runs) => runs.map((run) => run.start)));
	const codeData = (code: MarkdownNode) => codeSpanParts(context, code).datas;
	for (const block of context.document.findAll((node) => INLINE_BLOCKS.has(node.type)) as ReadonlyArray<MarkdownNode>) {
		if (flow.has(block.position.start.line)) continue;
		inlineSegments(source, block, scan, inMath, bare, codeData, push);
	}
	for (const image of imageLabelNodes(context)) if (image.type === "text") push(image);
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
	for (const block of context.document.findAll((node) => node.type === "html") as ReadonlyArray<MarkdownNode>) {
		if (!isFlowHtml(context, block) || flow.has(block.position.start.line)) continue;
		if (isHtmlFlowComment(context, block)) {
			if (scan.html) pieces(source, block.position.start.offset, block.position.end.offset, () => false, push);
			continue;
		}
		rereadSegments(context, block, scan, push);
	}
	return segments.sort((a, b) => a.start - b.start);
};

// Whether an `html` node is an HTML block, not inline HTML: its parent is no inline block.
const flowHtml: WeakMap<MarkdownDocument, ReadonlySet<MarkdownNode>> = new WeakMap();
const isFlowHtml = (context: LintContext, node: MarkdownNode): boolean => {
	let blocks = flowHtml.get(context.document);
	if (blocks === undefined) {
		const found = new Set<MarkdownNode>();
		const visit = (parent: MarkdownNode): void => {
			if (INLINE_BLOCKS.has(parent.type)) return;
			for (const child of childrenOf(parent)) {
				if (child.type === "html") found.add(child);
				visit(child);
			}
		};
		visit(context.document.root as MarkdownNode);
		blocks = found;
		flowHtml.set(context.document, blocks);
	}
	return blocks.has(node);
};

// The token texts of an HTML block's re-read content, mapped back to the block's source lines.
const rereadSegments = (
	context: LintContext,
	block: MarkdownNode,
	scan: Scan,
	push: (segment: Segment) => void,
): void => {
	const { document, lines } = rereadBlock(context, block);
	if (document === undefined) return;
	const text = lines.map((line) => line.text).join("\n");
	const spans = mathTextSpans(document, text);
	const toSource = (offset: number): number | undefined => {
		const row = document.lineIndex.lineAt(offset);
		const line = lines[row];
		if (line === undefined || line.origin === 0) return undefined;
		const column = sourceColumn(line, offset - document.lineIndex.lineStart(row));
		return context.mapping.lineStart(line.origin) + Math.min(column, context.lines[line.origin - 1]?.length ?? 0);
	};
	const mapped = (segment: Segment) => {
		const start = toSource(segment.start);
		const end = toSource(segment.end);
		if (start !== undefined && end !== undefined && end > start) push({ start, end });
	};
	const codeData = (code: MarkdownNode) => {
		const span = text.slice(code.position.start.offset, code.position.end.offset);
		const sequence = (/^`+/.exec(span)?.[0] ?? "").length;
		const found: Array<Segment> = [];
		pieces(
			text,
			code.position.start.offset + sequence,
			code.position.end.offset - sequence,
			() => false,
			(each) => found.push(each),
		);
		return found;
	};
	for (const inner of document.findAll((node) => INLINE_BLOCKS.has(node.type)) as ReadonlyArray<MarkdownNode>) {
		inlineSegments(text, inner, scan, (offset) => inSpans(spans, offset), new Set(), codeData, mapped);
	}
};

// markdownlint's `escapeForRegExp`.
const escapeForRegExp = (text: string): string => text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * MD044 `proper-names`: proper names are written with their capitalization.
 *
 * @remarks
 * markdownlint's settings: `names` (default none), the names as they should
 * be written, matched case-insensitively as whole words; `code_blocks`
 * (default `true`), whether code blocks and code spans are checked; and
 * `html_elements` (default `true`), whether HTML is. A longer name is matched
 * first, and a shorter one inside its match is not reported. Where markdownlint
 * throws or hangs, the kit stays total: a name that is no string reads as no
 * names, and an empty name is passed over. The fix writes the name.
 *
 * @public
 */
export const MD044: Lint.LintRule = LintRule.make({
	names: ["MD044", "proper-names"],
	description: "Proper names should have the correct capitalization",
	tags: ["spelling"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md044.md",
	check: (context, report) => {
		const setting = context.config.names;
		const names = Array.isArray(setting) ? [...(setting as ReadonlyArray<unknown>)] : [];
		// markdownlint calls string methods on every name and throws on any other value.
		if (names.length === 0 || !names.every((name): name is string => typeof name === "string")) return;
		names.sort((a, b) => b.length - a.length || a.localeCompare(b));
		const scan = {
			code: flagSettingOn(context.config, "code_blocks"),
			html: flagSettingOn(context.config, "html_elements"),
		};
		// markdownlint matches over its tokens' text, HTML comments as written: the kit's reading masks their bodies.
		const source = unmaskedSource(context);
		const segments = segmentsOf(context, scan);
		// markdownlint's exclusions, by the characters they cover: a match overlapping one is not reported.
		const excluded = new Uint8Array(source.length + 1);
		const covers = (start: number, end: number): boolean => {
			for (let at = start; at < end; at++) if (excluded[at] === 1) return true;
			return false;
		};
		const exclude = (start: number, end: number) => excluded.fill(1, start, end);
		const scanned = new Set<Segment>();
		const lineEnd = (offset: number) => {
			const line = context.mapping.lineNumber(offset);
			return context.mapping.lineStart(line) + (context.lines[line - 1] ?? "").length;
		};
		for (const name of names) {
			// An empty name matches nothing at every word boundary, where markdownlint loops forever.
			if (name.length === 0) continue;
			const startPattern = /^\W/.test(name) ? "" : "\\b_*";
			const endPattern = /\W$/.test(name) ? "" : "_*\\b";
			const pattern = new RegExp(`(${startPattern})(${escapeForRegExp(name)})${endPattern}`, "gi");
			for (const segment of segments) {
				const text = source.slice(segment.start, segment.end);
				pattern.lastIndex = 0;
				for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
					const [, left = "", nameMatch = ""] = match;
					const start = segment.start + match.index + left.length;
					const end = start + nameMatch.length;
					if (!names.includes(nameMatch) && !covers(start, end)) {
						let autolinks: ReadonlyArray<Segment> = [];
						if (!scanned.has(segment)) {
							autolinks = literalAutolinks(text).map((link) => ({
								start: segment.start + link.start,
								// markdownlint's range for it ends `token.endColumn + tok.endColumn - 1`, past the token.
								end: Math.min(lineEnd(segment.start), segment.end + link.end + 1),
							}));
							for (const link of autolinks) exclude(link.start, link.end);
							scanned.add(segment);
						}
						if (!autolinks.some((link) => link.start < end && start < link.end) && name !== nameMatch) {
							report(
								context.diagnostic({
									at: { offset: start, length: 0 },
									detail: `Expected: ${name}; Actual: ${nameMatch}`,
									range: { offset: start, length: nameMatch.length },
									fix: { offset: start, length: nameMatch.length, content: name },
								}),
							);
						}
					}
					exclude(start, end);
				}
			}
		}
	},
});

// The GFM literal autolinks markdownlint's re-parse of a token's text finds, in the text's offsets.
const literalAutolinks = (text: string): ReadonlyArray<Segment> => {
	// A GFM literal autolink starts `www.`, a scheme or holds an `@`: a text with none of them has none, unparsed.
	if (!/www\.|https?:|ftp:|mailto:|xmpp:|@/i.test(text)) return [];
	const parsed = Document.parseResult(text, autolinkOptions);
	if (!Result.isSuccess(parsed)) return [];
	return (parsed.success.findAll("link") as ReadonlyArray<MarkdownNode>)
		.filter((link) => !"[<".includes(text.charAt(link.position.start.offset)))
		.map((link) => ({ start: link.position.start.offset, end: link.position.end.offset }));
};
