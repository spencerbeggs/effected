// Source provenance for accumulated leaf content.
//
// The block pass strips container prefixes and expands tabs, so a leaf
// block's content is not a contiguous slice of the source. Each
// `RawInlineSegment` pins one run that is, and these helpers are how the
// inline pass turns an index into that content back into an absolute source
// offset. Characters the engine injects — the `\n` between lines, the spaces
// a partially consumed tab expands to — lie between segments and belong to no
// source range.
//
// Leaf module: imports only the segment type.

import type { RawInlineSegment } from "./blockTypes.js";

/**
 * The absolute source offset of `textIndex` within a segmented content run.
 *
 * An index that falls between segments resolves to the end of the segment
 * before it, which is the closest real source position there is. The
 * segments run in increasing `textOffset` order, so the one an index falls
 * in or after is found by binary search: one paragraph has a segment per
 * line, and every inline node maps its offsets through them.
 */
export const sourceOffsetAt = (
	segments: ReadonlyArray<RawInlineSegment>,
	textIndex: number,
	fallback: number,
): number => {
	// The last segment starting at or before `textIndex`.
	let low = 0;
	let high = segments.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		if ((segments[middle] as RawInlineSegment).textOffset <= textIndex) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	if (found < 0) return fallback;
	const segment = segments[found] as RawInlineSegment;
	return textIndex < segment.textOffset + segment.length
		? segment.sourceOffset + (textIndex - segment.textOffset)
		: segment.sourceOffset + segment.length;
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
