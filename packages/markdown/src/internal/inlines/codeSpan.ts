// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// `parseBackticks`: a run of backticks opens a code span that the next run of
// exactly the same length closes. Line endings inside become spaces, and one
// space of padding on each side is stripped when the content is not all
// spaces.

import { InlineCode } from "../../MarkdownNode.js";
import type { InlineConstruct } from "../inlineTypes.js";

const C_BACKTICK = 0x60;

const reTicksHere = /^`+/;
const reTicks = /`+/;
const reNewline = /\n/gm;
const reNonSpace = /[^ ]/;

/** A code span. */
export const codeSpanConstruct: InlineConstruct = {
	name: "codeSpan",
	triggers: [C_BACKTICK],
	parse: (scanner) => {
		const from = scanner.pos;
		const ticks = scanner.match(reTicksHere);
		if (ticks === undefined) {
			return false;
		}

		const afterOpenTicks = scanner.pos;
		let matched = scanner.matchAhead(reTicks);
		while (matched !== undefined) {
			if (matched === ticks) {
				const contents = scanner.subject.slice(afterOpenTicks, scanner.pos - ticks.length).replace(reNewline, " ");
				const stripped =
					contents.length > 0 && reNonSpace.test(contents) && contents.startsWith(" ") && contents.endsWith(" ")
						? contents.slice(1, -1)
						: contents;

				scanner.append(InlineCode.make({ value: stripped, position: scanner.position(from, scanner.pos) }));
				return true;
			}
			matched = scanner.matchAhead(reTicks);
		}

		// No closing run of the same length: the opening ticks are literal.
		scanner.pos = afterOpenTicks;
		scanner.appendText(ticks, from, scanner.pos);
		return true;
	},
};
