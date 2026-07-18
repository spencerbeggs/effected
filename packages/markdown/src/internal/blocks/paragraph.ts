// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Port notes: a paragraph has no block start of its own — the line loop opens
// one for any line no other construct claimed, which is upstream's structure
// too. Task 7 adds the link-reference-definition split to `finalize`; here it
// is absent, so P1 Task 6 paragraphs keep their whole content.

import { Paragraph } from "../../MarkdownNode.js";
import type { BlockConstruct } from "../blockTypes.js";

/** Paragraph: absorbs lines until a blank one, and contains nothing. */
export const paragraphConstruct: BlockConstruct = {
	type: "paragraph",
	acceptsLines: true,
	canContain: () => false,
	continue: (scanner) => (scanner.blank ? 1 : 0),
	materialize: (block, _children, context) => {
		const inline = context.inlineSlice(block);
		// A paragraph whose content trimmed away renders nothing; dropping it
		// keeps `<p></p>` out of the tree. Task 7's definition split is the
		// case that makes this reachable.
		if (inline.text.length === 0) {
			return undefined;
		}

		const node = Paragraph.make({
			children: inline.children,
			position: context.position(block.startOffset, block.endOffset),
		});
		context.registerInline(node, inline);
		return node;
	},
};
