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
import { footnoteDefinitionConstruct, footnoteDefinitionStart } from "./blocks/footnoteDefinition.js";
import { htmlBlockConstruct, htmlBlockStart } from "./blocks/htmlBlock.js";
import { indentedCodeStart } from "./blocks/indentedCode.js";
import { definitionConstruct } from "./blocks/linkReferenceDefinition.js";
import { listConstruct, listItemConstruct, listItemStart } from "./blocks/list.js";
import { paragraphConstruct } from "./blocks/paragraph.js";
import { setextHeadingStart } from "./blocks/setextHeading.js";
import {
	tableCellConstruct,
	tableConstruct,
	tableHeaderStart,
	tableRowConstruct,
	tableRowStart,
} from "./blocks/table.js";
import { taskListItemStart } from "./blocks/taskListItem.js";
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

// GFM's block grammar is CommonMark's plus tables, task-list items and
// footnote definitions.
//
// The extension starts sit LAST, after every CommonMark start, because that is
// where cmark-gfm runs its extensions: `open_new_blocks` tries the core
// constructs first and only reaches `try_opening_block` when none of them
// claimed the line. The ordering is load-bearing rather than cosmetic — it is
// what makes `---` under a paragraph a setext heading instead of a one-column
// table, and `> quoted` under a table a blockquote instead of a row.
//
// The footnote definition is the exception, and deliberately so: it is not an
// extension at all. cmark-gfm keeps footnotes in its core, gated by
// `CMARK_OPT_FOOTNOTES`, and its branch of `open_new_blocks` sits between the
// thematic break and the list marker. It is registered at that same core
// position rather than with the extensions, because a `[^a]: ...` line has to
// beat the list-item start that would otherwise claim what follows.
const gfmDialect: BlockDialect = {
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
		footnoteDefinitionConstruct,
		tableConstruct,
		tableRowConstruct,
		tableCellConstruct,
	]),
	starts: [
		blockquoteStart,
		atxHeadingStart,
		fencedCodeStart,
		htmlBlockStart,
		setextHeadingStart,
		thematicBreakStart,
		footnoteDefinitionStart,
		listItemStart,
		indentedCodeStart,
		taskListItemStart,
		tableHeaderStart,
		tableRowStart,
	],
	// commonmark.js's `reMaybeSpecial` fast path knows nothing of tables, task
	// lists or footnotes: a delimiter row can begin with `|` or `:`, a table
	// row can begin with any character at all, and both a task-list checkbox
	// and a footnote definition begin with `[`. cmark-gfm has no such filter,
	// so this restores the lines it would hide — and only those.
	mayStartBlock: (rest, container) =>
		container.type === "table" || rest.startsWith("[") || rest.startsWith("|") || rest.startsWith(":"),
};

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
