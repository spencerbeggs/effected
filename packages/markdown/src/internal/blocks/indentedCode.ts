// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Port notes: this module owns the shared `code` construct as well as the
// indented block start, mirroring upstream's single `code_block` entry serving
// both spellings. Task 7's fenced-code start opens a `code` block with
// `data.isFenced` set and extends the branches marked below; the absence of
// `fenceChar`/`fenceLength` on the materialized node is what tells an indented
// block from a fenced one on the way back out, so the indented branch must
// never set them.

import { Code } from "../../MarkdownNode.js";
import type { BlockConstruct, BlockNode, BlockStart } from "../blockTypes.js";
import { CODE_INDENT } from "../preprocess.js";

const reBlankLine = /^[ \t]*$/;

/**
 * Drop the trailing blank lines an indented code block accumulates, and pull
 * the block's end back to the last line that survived.
 */
const finalizeIndented = (block: BlockNode): void => {
	const lines = block.stringContent.split("\n");
	while (lines.length > 0 && reBlankLine.test(lines[lines.length - 1] ?? "")) {
		lines.pop();
	}

	block.stringContent = lines.length === 0 ? "" : `${lines.join("\n")}\n`;

	const lastSegment = block.segments[lines.length - 1];
	if (lastSegment !== undefined) {
		block.endOffset = lastSegment.sourceOffset + lastSegment.length;
		block.endLine = block.startLine + lines.length - 1;
	}
};

/** Code: absorbs lines verbatim, contains nothing. */
export const codeConstruct: BlockConstruct = {
	type: "code",
	acceptsLines: true,
	canContain: () => false,
	continue: (scanner) => {
		// Task 7 branches here on `block.data.isFenced` for the closing fence.
		if (scanner.indent >= CODE_INDENT) {
			scanner.advanceOffset(CODE_INDENT, true);
		} else if (scanner.blank) {
			scanner.advanceNextNonspace();
		} else {
			return 1;
		}
		return 0;
	},
	finalize: (_scanner, block) => {
		// Task 7 branches here on `block.data.isFenced` for the info string.
		finalizeIndented(block);
	},
	materialize: (block, _children, context) =>
		Code.make({
			value: block.stringContent,
			position: context.position(block.startOffset, block.endOffset),
		}),
};

/** The indented-code block start: four columns of indentation. */
export const indentedCodeStart: BlockStart = {
	name: "indentedCode",
	trigger: (scanner) => {
		if (!scanner.indented || scanner.tip.type === "paragraph" || scanner.blank) {
			return 0;
		}

		scanner.advanceOffset(CODE_INDENT, true);
		scanner.closeUnmatchedBlocks();
		scanner.addChild("code", scanner.offset);
		return 2;
	},
};
