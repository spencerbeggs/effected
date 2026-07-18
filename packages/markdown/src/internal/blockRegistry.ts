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
// THE ORDER OF `starts` IS THE ALGORITHM, and it is upstream's order exactly.

import { atxHeadingStart, headingConstruct } from "./blocks/atxHeading.js";
import { blockquoteConstruct, blockquoteStart } from "./blocks/blockquote.js";
import { codeConstruct } from "./blocks/code.js";
import { documentConstruct } from "./blocks/document.js";
import { fencedCodeStart } from "./blocks/fencedCode.js";
import { htmlBlockConstruct, htmlBlockStart } from "./blocks/htmlBlock.js";
import { indentedCodeStart } from "./blocks/indentedCode.js";
import { definitionConstruct } from "./blocks/linkReferenceDefinition.js";
import { listConstruct, listItemConstruct, listItemStart } from "./blocks/list.js";
import { paragraphConstruct } from "./blocks/paragraph.js";
import { setextHeadingStart } from "./blocks/setextHeading.js";
import { thematicBreakConstruct, thematicBreakStart } from "./blocks/thematicBreak.js";
import type { BlockConstruct, BlockDialect, BlockType } from "./blockTypes.js";

/**
 * The dialects the block pass can be keyed by.
 *
 * The name doubles as the inline pass's dialect key (`InlineDialectName`), so
 * one string selects both registries.
 */
export type MarkdownDialect = "commonmark" | "gfm";

const constructTable = (constructs: ReadonlyArray<BlockConstruct>): ReadonlyMap<BlockType, BlockConstruct> =>
	// A real Map, not an object literal: construct names are engine-controlled
	// here, but the house rule is that no lookup table keyed by parsed content
	// is ever a bare object, and keeping every table a Map removes the question.
	new Map(constructs.map((construct) => [construct.type, construct]));

const commonmarkDialect: BlockDialect = {
	constructs: constructTable([
		documentConstruct,
		blockquoteConstruct,
		listConstruct,
		listItemConstruct,
		paragraphConstruct,
		headingConstruct,
		thematicBreakConstruct,
		codeConstruct,
		htmlBlockConstruct,
		definitionConstruct,
	]),
	starts: [
		blockquoteStart,
		atxHeadingStart,
		fencedCodeStart,
		htmlBlockStart,
		setextHeadingStart,
		thematicBreakStart,
		listItemStart,
		indentedCodeStart,
	],
};

// GFM's BLOCK grammar is CommonMark's until tables, task-list items and
// footnote definitions land (P2 Tasks 4-6). Its inline grammar already
// differs, and the dialect name is what selects that — so the entry has to
// exist now even though the two tables are the same object.
const gfmDialect: BlockDialect = commonmarkDialect;

const dialects: ReadonlyMap<MarkdownDialect, BlockDialect> = new Map([
	["commonmark", commonmarkDialect],
	["gfm", gfmDialect],
]);

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
