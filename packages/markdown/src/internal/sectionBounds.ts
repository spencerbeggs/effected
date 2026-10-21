// The single root-level section-boundary rule, shared by
// `MarkdownDocument.sections` and `MarkdownTransform.sections` so the two
// cannot drift: a root-level heading's section ends at the next ROOT-level
// heading of equal or shallower depth, or at the end of the children.
//
// Pure over the children array — no source text — which is what lets the
// transform-side finder run on a tree a `MarkdownTransform.map` has reshaped.
// Type-only imports keep the cycle firewall intact.

import type { Heading, Root } from "../MarkdownNode.js";

/** One root-level heading and the child index its section ends at. */
export interface RootHeadingBound {
	readonly heading: Heading;
	/** The heading's index in `root.children`. */
	readonly index: number;
	/** Exclusive child index where the section ends: the boundary heading's index, or `children.length`. */
	readonly end: number;
}

/**
 * Every root-level heading of `children`, in document order, paired with the
 * child index its section ends at.
 */
export const rootHeadingBounds = (children: Root["children"]): Array<RootHeadingBound> => {
	const headings: Array<{ readonly index: number; readonly node: Heading }> = [];
	for (let index = 0; index < children.length; index += 1) {
		const block = children[index];
		if (block !== undefined && block.type === "heading") {
			headings.push({ index, node: block });
		}
	}
	// Built once, scanned heading-to-heading from the back: `nextByDepth[d]`
	// is the nearest following heading of depth `d`, so the boundary of a
	// depth-`n` heading is the nearest of `nextByDepth[1..n]`.
	const nextByDepth: Array<number | undefined> = [
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
	];
	const bounds = new Array<RootHeadingBound>(headings.length);
	for (let index = headings.length - 1; index >= 0; index -= 1) {
		const current = headings[index];
		if (current === undefined) continue;
		let boundary: number | undefined;
		for (let depth = 1; depth <= current.node.depth; depth += 1) {
			const candidate = nextByDepth[depth];
			if (candidate !== undefined && (boundary === undefined || candidate < boundary)) {
				boundary = candidate;
			}
		}
		bounds[index] = {
			heading: current.node,
			index: current.index,
			end: boundary === undefined ? children.length : (headings[boundary]?.index ?? children.length),
		};
		nextByDepth[current.node.depth] = index;
	}
	return bounds;
};
