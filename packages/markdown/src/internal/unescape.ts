// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// `lib/common.js` `unescapeString`: resolve backslash escapes and character
// references into the literal characters they stand for. Used by link
// destinations, link titles and fenced-code info strings.

import { decodeEntity } from "./entities.js";
import { ENTITY, ESCAPABLE } from "./grammar.js";

const reBackslashOrAmp = /[\\&]/;
const reEntityOrEscapedChar = new RegExp(`\\\\${ESCAPABLE}|${ENTITY}`, "gi");

const unescapeChar = (source: string): string => {
	if (source.charCodeAt(0) === 0x5c) {
		return source.charAt(1);
	}
	// An entity this engine cannot decode yet stays literal (see entities.ts).
	return decodeEntity(source) ?? source;
};

/** Replace every backslash escape and character reference with its literal. */
export const unescapeString = (source: string): string =>
	reBackslashOrAmp.test(source) ? source.replace(reEntityOrEscapedChar, unescapeChar) : source;
