// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// `parseHtmlTag`: raw inline HTML, kept verbatim.
//
// Port note: upstream has two node types, `html_inline` and `html_block`.
// mdast has one `html` node for both, which is what this emits — a renderer
// tells them apart by where the node sits, as the test writer does.

import { reHtmlTag } from "../htmlTags.js";
import { makeInlineNode } from "../inlineNode.js";
import type { InlineConstruct } from "../inlineTypes.js";

const C_LESSTHAN = 0x3c;

/** A raw HTML tag, comment, processing instruction, declaration or CDATA. */
export const rawHtmlConstruct: InlineConstruct = {
	name: "rawHtml",
	triggers: [C_LESSTHAN],
	parse: (scanner) => {
		const from = scanner.pos;
		const matched = scanner.match(reHtmlTag);
		if (matched === undefined) {
			return false;
		}
		scanner.append(makeInlineNode("html", from, scanner.pos, matched));
		return true;
	},
};
