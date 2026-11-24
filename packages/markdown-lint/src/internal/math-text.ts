// PARSER GAP: inline math. markdownlint's micromark runs the math
// extension's `mathText`, which the kit tree does not carry, so this module
// re-reads it from the source. When @effected/markdown parses math, delete
// this module and read the tree's inline math nodes instead.

import type { MarkdownDocument, MarkdownNode } from "@effected/markdown";

/** A source span, `[start, end)`. @internal */
export interface Span {
	readonly start: number;
	readonly end: number;
}

// Where a link's or image's label ends: the `]` closing the `[` at `open`, brackets nested and escapes skipped.
const labelEnd = (source: string, open: number, end: number): number => {
	let depth = 0;
	for (let at = open + 1; at < end; at++) {
		const char = source.charAt(at);
		if (char === "\\") at++;
		else if (char === "[") depth++;
		else if (char === "]") {
			if (depth === 0) return at;
			depth--;
		}
	}
	return end;
};

// What micromark reads as one token before a `$` inside it could open math: a code span, inline HTML, an
// autolink, a footnote call, and a link's or image's destination or reference (all after its label, which
// micromark parses inline, so math can open there).
const atomicSpans = (node: MarkdownNode, source: string, found: Array<Span>): Array<Span> => {
	const { start, end } = { start: node.position.start.offset, end: node.position.end.offset };
	if (node.type === "inlineCode" || node.type === "html" || node.type === "footnoteReference") {
		found.push({ start, end });
	} else if (node.type === "link" || node.type === "linkReference") {
		if (source.charAt(start) === "<") found.push({ start, end });
		else found.push({ start: labelEnd(source, start, end), end });
	} else if (node.type === "image" || node.type === "imageReference") {
		found.push({ start: labelEnd(source, start + 1, end), end });
	}
	if ("children" in node)
		for (const child of node.children as ReadonlyArray<MarkdownNode>) atomicSpans(child, source, found);
	return found;
};

const mathTextCache = new WeakMap<MarkdownDocument, { readonly source: string; readonly spans: ReadonlyArray<Span> }>();

/**
 * The inline math spans of a document: markdownlint's micromark runs the
 * math extension's `mathText`, which the kit tree does not carry. Within each
 * paragraph, heading and table cell, read left to right as micromark does: a
 * run of `$` opens math when a later run of exactly as many closes it (what
 * lies between is math, unparsed), and a code span, inline HTML, an autolink,
 * a footnote call, or a link's or image's destination that starts first is
 * read whole (a label is read inline, as micromark reads it). A
 * backslash escapes the character after it outside math. Computed once per
 * document and source, and shared: read-only.
 * @internal
 */
export const mathTextSpans = (document: MarkdownDocument, source: string): ReadonlyArray<Span> => {
	const cached = mathTextCache.get(document);
	if (cached !== undefined && cached.source === source) return cached.spans;
	const spans: Array<Span> = [];
	const leaves = document.findAll(
		(node) => node.type === "paragraph" || node.type === "heading" || node.type === "tableCell",
	);
	for (const leaf of leaves) {
		const atomic = atomicSpans(leaf, source, []).sort((a, b) => a.start - b.start);
		const end = leaf.position.end.offset;
		let at = leaf.position.start.offset;
		// `atomic` is sorted by start and `at` only moves forward: `next` is the first span not before `at`.
		let next = 0;
		while (at < end) {
			while (next < atomic.length && (atomic[next] as Span).start < at) next++;
			const skip = atomic[next]?.start === at ? atomic[next] : undefined;
			if (skip !== undefined) {
				at = Math.max(skip.end, at + 1);
				continue;
			}
			const char = source.charAt(at);
			if (char === "\\" && /[!-/:-@[-`{-~]/.test(source.charAt(at + 1))) {
				at += 2;
				continue;
			}
			if (char !== "$") {
				at++;
				continue;
			}
			let open = at;
			while (open < end && source.charAt(open) === "$") open++;
			const size = open - at;
			let close = -1;
			let scan = open;
			while (scan < end) {
				if (source.charAt(scan) !== "$") {
					scan++;
					continue;
				}
				let run = scan;
				while (run < end && source.charAt(run) === "$") run++;
				if (run - scan === size) {
					close = run;
					break;
				}
				scan = run;
			}
			if (close === -1) {
				at = open;
				continue;
			}
			spans.push({ start: at, end: close });
			at = close;
		}
	}
	mathTextCache.set(document, { source, spans });
	return spans;
};

/** Whether `offset` lies inside one of `spans`. @internal */
export const inSpans = (spans: ReadonlyArray<Span>, offset: number): boolean =>
	spans.some((span) => span.start <= offset && offset < span.end);
