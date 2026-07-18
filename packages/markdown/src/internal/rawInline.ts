// The leaf-block content seam between the block pass and the inline pass.
//
// commonmark.js hands `block._string_content.trim()` straight to its inline
// parser and lets inline nodes inherit the leaf's sourcepos. This port trims
// with the source provenance attached (see `RawInlineSegment`), so the inline
// pass can place absolute offsets on every node it builds.
//
// Imports leaf node classes from `../MarkdownNode.js`, which is the sanctioned
// exception to the cycle firewall (nodes are an import leaf).

import type { PhrasingContent, Position } from "../MarkdownNode.js";
import { Text } from "../MarkdownNode.js";
import type { BlockNode, PreparedInline, RawInlineSegment } from "./blockTypes.js";

/** Builds the `Position` for an absolute source range. */
type PositionOf = (start: number, end: number) => Position;

const reWhitespace = /\s/;

/**
 * Trim `text` the way commonmark.js does before inline parsing, carrying the
 * segment table along so the surviving characters keep their source offsets.
 */
const trimWithSegments = (
	text: string,
	segments: ReadonlyArray<RawInlineSegment>,
): { readonly text: string; readonly segments: ReadonlyArray<RawInlineSegment> } => {
	let start = 0;
	let end = text.length;
	while (start < end && reWhitespace.test(text.charAt(start))) {
		start += 1;
	}
	while (end > start && reWhitespace.test(text.charAt(end - 1))) {
		end -= 1;
	}

	if (start === 0 && end === text.length) {
		return { text, segments };
	}

	const trimmed: RawInlineSegment[] = [];
	for (const segment of segments) {
		const from = Math.max(segment.textOffset, start);
		const to = Math.min(segment.textOffset + segment.length, end);
		if (to > from) {
			trimmed.push({
				textOffset: from - start,
				sourceOffset: segment.sourceOffset + (from - segment.textOffset),
				length: to - from,
			});
		}
	}

	return { text: text.slice(start, end), segments: trimmed };
};

/**
 * The absolute source offset of `textIndex` within a segmented content run.
 *
 * An index that falls between segments — on an injected `\n`, or on the
 * spaces a partially consumed tab expanded to — resolves to the end of the
 * segment before it, which is the closest real source position there is.
 */
export const sourceOffsetAt = (
	segments: ReadonlyArray<RawInlineSegment>,
	textIndex: number,
	fallback: number,
): number => {
	let offset = fallback;
	for (const segment of segments) {
		if (textIndex < segment.textOffset) {
			return offset;
		}
		if (textIndex < segment.textOffset + segment.length) {
			return segment.sourceOffset + (textIndex - segment.textOffset);
		}
		offset = segment.sourceOffset + segment.length;
	}
	return offset;
};

/**
 * Cut `[from, to)` out of a segmented content run, keeping the provenance of
 * every character that survives.
 */
export const sliceWithSegments = (
	segments: ReadonlyArray<RawInlineSegment>,
	from: number,
	to: number,
): ReadonlyArray<RawInlineSegment> => {
	const sliced: RawInlineSegment[] = [];
	for (const segment of segments) {
		const start = Math.max(segment.textOffset, from);
		const end = Math.min(segment.textOffset + segment.length, to);
		if (end > start) {
			sliced.push({
				textOffset: start - from,
				sourceOffset: segment.sourceOffset + (start - segment.textOffset),
				length: end - start,
			});
		}
	}
	return sliced;
};

/**
 * TEMPORARY INLINE PASSTHROUGH — deleted in Task 8.
 *
 * Until the inline pass exists, a leaf block's raw text becomes a single
 * `Text` child so the conformance harness has something to render. Escapes,
 * entities, code spans, emphasis and links are all still literal here, which
 * is exactly why the harness defers the examples that need them.
 */
const passthroughChildren = (
	text: string,
	startOffset: number,
	endOffset: number,
	position: PositionOf,
): ReadonlyArray<PhrasingContent> =>
	text.length === 0 ? [] : [Text.make({ value: text, position: position(startOffset, endOffset) })];

/**
 * Prepare a leaf block's accumulated content for materialization: trim it,
 * keep its source provenance, and build the temporary passthrough children.
 */
export const prepareInline = (block: BlockNode, position: PositionOf): PreparedInline => {
	const { text, segments } = trimWithSegments(block.stringContent, block.segments);
	const first = segments[0];
	const last = segments[segments.length - 1];
	const startOffset = first === undefined ? block.startOffset : first.sourceOffset;
	const endOffset = last === undefined ? startOffset : last.sourceOffset + last.length;

	return {
		text,
		startOffset,
		endOffset,
		segments,
		children: passthroughChildren(text, startOffset, endOffset, position),
	};
};
