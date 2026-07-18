// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// The indented-code block start. The construct both code spellings share
// lives in `code.ts`.

import type { BlockStart } from "../blockTypes.js";
import { CODE_INDENT } from "../preprocess.js";

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
