// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Port notes: upstream's `document` finalize runs
// `removeLinkReferenceDefinitions`, which strips definitions out of the tree.
// This package keeps definitions as nodes (the design's third port delta), so
// that step becomes Task 7's paragraph finalize and this construct's finalize
// is a no-op.

import { Root } from "../../MarkdownNode.js";
import type { BlockConstruct } from "../blockTypes.js";

/** The document root: contains everything except a bare list item. */
export const documentConstruct: BlockConstruct = {
	type: "document",
	acceptsLines: false,
	canContain: (child) => child !== "listItem",
	continue: () => 0,
	materialize: (block, children, context) =>
		Root.make({ children, position: context.position(block.startOffset, block.endOffset) }),
};
