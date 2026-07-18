// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// `parseString`: the fallback that consumes a run of ordinary characters.
// Upstream's smart-punctuation branch is deliberately not ported (the design
// declines the `smart` option outright).

import type { InlineConstruct } from "../inlineTypes.js";

// Every character that can start some other construct, so a text run stops
// before it. `'` and `"` are in the set because upstream's smart punctuation
// triggers on them; without smart punctuation they simply fall through to the
// single-character fallback, which is the same result.
//
// Upstream carries an `m` flag here, which is inert for it: its `switch`
// reaches `parseString` only when the character at the cursor is outside this
// set, so `^` always matches at the cursor. This parser tries the text
// construct for every character no construct claimed, including the excluded
// ones — and under `m`, `^` would then match at the NEXT line start and the
// run in between would be skipped. The flag is dropped, and `match` requires
// the match to sit at the cursor besides.
const reMain = /^[^\n`[\]\\!<&*_'"]+/;

/** Ordinary text: the fallback construct, with no trigger of its own. */
export const textConstruct: InlineConstruct = {
	name: "text",
	triggers: [],
	parse: (scanner) => {
		const from = scanner.pos;
		const matched = scanner.match(reMain);
		if (matched === undefined) {
			return false;
		}
		scanner.appendText(matched, from, scanner.pos);
		return true;
	},
};
