// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Port notes: upstream's `blocks` object and `blockStarts` array are module
// globals. Here they are per-dialect tables, which is the whole point of the
// restructuring — a dialect is a registry composition and nothing else, so
// GFM (P2) and a future `obsidian` dialect land as new construct modules with
// no change to any public API.
//
// THE ORDER OF `starts` IS THE ALGORITHM. Upstream's order is blockquote, ATX
// heading, fenced code, HTML block, setext heading, thematic break, list item,
// indented code. P1 Task 6 registers the three it implements at their
// upstream positions; Task 7 inserts the rest into the gaps, it does not
// append them.

import { atxHeadingStart, headingConstruct } from "./blocks/atxHeading.js";
import { documentConstruct } from "./blocks/document.js";
import { codeConstruct, indentedCodeStart } from "./blocks/indentedCode.js";
import { paragraphConstruct } from "./blocks/paragraph.js";
import { thematicBreakConstruct, thematicBreakStart } from "./blocks/thematicBreak.js";
import type { BlockConstruct, BlockDialect, BlockType } from "./blockTypes.js";

/** The dialects the block pass can be keyed by. P2 widens this union. */
export type MarkdownDialect = "commonmark";

const constructTable = (constructs: ReadonlyArray<BlockConstruct>): ReadonlyMap<BlockType, BlockConstruct> =>
	// A real Map, not an object literal: construct names are engine-controlled
	// here, but the house rule is that no lookup table keyed by parsed content
	// is ever a bare object, and keeping every table a Map removes the question.
	new Map(constructs.map((construct) => [construct.type, construct]));

const commonmarkDialect: BlockDialect = {
	constructs: constructTable([
		documentConstruct,
		paragraphConstruct,
		headingConstruct,
		thematicBreakConstruct,
		codeConstruct,
	]),
	starts: [
		// blockquote — Task 7
		atxHeadingStart,
		// fencedCode — Task 7
		// htmlBlock — Task 7
		// setextHeading — Task 7
		thematicBreakStart,
		// listItem — Task 7
		indentedCodeStart,
	],
};

const dialects: ReadonlyMap<MarkdownDialect, BlockDialect> = new Map([["commonmark", commonmarkDialect]]);

/**
 * The block tables for `dialect`.
 *
 * An unknown dialect cannot arrive through the schema-typed public surface,
 * so it is programmer error and dies as a defect.
 */
export const blockDialect = (dialect: MarkdownDialect): BlockDialect => {
	const found = dialects.get(dialect);
	if (found === undefined) {
		throw new TypeError(`unknown markdown dialect: ${String(dialect)}`);
	}
	return found;
};
