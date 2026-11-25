// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// THE port delta. Upstream parses link reference definitions off the front of
// every paragraph and DELETES them (`removeLinkReferenceDefinitions`), keeping
// only a refmap, because a renderer has nowhere to put them. This package
// edits markdown, so a deleted definition would be a lost edit: the
// definitions are split out of the paragraph exactly as upstream splits them,
// then spliced into the tree as `definition` nodes at their own source
// position, ahead of whatever is left of the paragraph.
//
// The other half of the delta is that references are never resolved during
// parsing. `parseBlocks` returns a refmap built from these nodes so the
// inline pass and any renderer can resolve on their own terms.
//
// Upstream also does the split in two places (the document finalize walk and
// the setext-heading start). This port does it in one — `extractDefinitions`,
// called from a paragraph's finalize and from the setext start before it
// decides whether any paragraph content is left to promote.

import { Definition } from "../../MarkdownNode.js";
import type { BlockConstruct, BlockNode } from "../blockTypes.js";
import { makeBlockNode } from "../blockTypes.js";
import { parseReference } from "../references.js";
import { sliceWithSegments } from "../segments.js";

const C_OPEN_BRACKET = 0x5b;

/**
 * Split every leading link reference definition out of `block`, inserting one
 * `definition` node per definition into `block`'s parent, immediately before
 * `block` itself.
 *
 * Definitions can only ever start a paragraph — they cannot interrupt one —
 * so a single leading pass is exhaustive.
 */
export const extractDefinitions = (block: BlockNode): void => {
	const parent = block.parent;
	if (parent === undefined) {
		return;
	}

	// One pass over the paragraph's text, never sliced per definition: each definition parses at `pos`, its offsets
	// come from a cursor over the segments that only moves forward, and the nodes and the paragraph's remainder are
	// spliced once. Splitting them off one at a time re-sliced and re-scanned every segment and searched the parent's
	// children per definition, quadratic in a run of them (`pathological.e2e.test.ts`).
	const text = block.stringContent;
	const segments = block.segments;
	let segment = 0;
	// `sourceOffsetAt` for a non-decreasing `index`: past a segment's end and before the next one's start, the end.
	const offsetAt = (index: number, fallback: number): number => {
		while (segment < segments.length) {
			const current = segments[segment] as (typeof segments)[number];
			if (index < current.textOffset + current.length) break;
			segment += 1;
		}
		const current = segments[segment];
		const previous = segments[segment - 1];
		const previousEnd = previous === undefined ? fallback : previous.sourceOffset + previous.length;
		if (current === undefined || index < current.textOffset) {
			return previousEnd;
		}
		return current.sourceOffset + (index - current.textOffset);
	};

	const nodes: BlockNode[] = [];
	let pos = 0;
	let line = block.startLine;
	let startOffset = block.startOffset;
	while (text.charCodeAt(pos) === C_OPEN_BRACKET) {
		const reference = parseReference(text, pos);
		if (reference === undefined) {
			break;
		}

		const end = pos + reference.length;
		const nodeStart = offsetAt(pos, startOffset);
		let linesConsumed = 0;
		for (let at = pos; at < end; at += 1) {
			if (text.charCodeAt(at) === 0x0a) linesConsumed += 1;
		}
		// The node ends at the definition's last content character. The parse
		// consumes trailing whitespace and the line ending to validate the
		// definition, but that consumption is not part of the node's span —
		// mdast-util ends definitions at content end, pinned by the interop
		// corpus.
		let contentEnd = end;
		while (contentEnd > pos && " \t\r\n".includes(text.charAt(contentEnd - 1))) contentEnd -= 1;
		const endOffset = offsetAt(contentEnd, nodeStart);
		let contentLines = 0;
		for (let at = pos; at < contentEnd; at += 1) {
			if (text.charCodeAt(at) === 0x0a) contentLines += 1;
		}

		const node = makeBlockNode("definition", nodeStart, line, block.depth);
		node.parent = parent;
		node.open = false;
		node.endOffset = endOffset;
		node.endLine = line + contentLines;
		node.data.definition = {
			key: reference.key,
			identifier: reference.identifier,
			label: reference.label,
			url: reference.url,
			...(reference.title === undefined ? {} : { title: reference.title }),
		};
		nodes.push(node);

		// Advance past what the definition took with it.
		pos = end;
		line += linesConsumed;
		startOffset = offsetAt(pos, endOffset);
	}

	if (nodes.length === 0) {
		return;
	}
	const at = parent.children.indexOf(block);
	parent.children.splice(at === -1 ? parent.children.length : at, 0, ...nodes);
	const remaining = sliceWithSegments(segments, pos, text.length);
	block.stringContent = text.slice(pos);
	block.segments.splice(0, block.segments.length, ...remaining);
	block.startLine = line;
	block.startOffset = remaining[0]?.sourceOffset ?? (nodes[nodes.length - 1] as BlockNode).endOffset;
};

/**
 * Definition: a node with no block start of its own — {@link extractDefinitions}
 * is the only thing that ever creates one, already closed.
 */
export const definitionConstruct: BlockConstruct = {
	type: "definition",
	acceptsLines: false,
	canContain: () => false,
	continue: () => 1,
	materialize: (block, _children, context) => {
		const definition = block.data.definition;
		if (definition === undefined) {
			return undefined;
		}
		return Definition.make({
			identifier: definition.identifier,
			label: definition.label,
			url: definition.url,
			position: context.position(block.startOffset, block.endOffset),
			...(definition.title === undefined ? {} : { title: definition.title }),
		});
	},
};
