// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Port notes: upstream keeps the block-construct table (`blocks`), the
// block-start array (`blockStarts`) and the parser itself in one file, with
// each construct reaching into parser internals by name. Here the vocabulary
// the two sides share is extracted into this leaf so the registry can import
// the construct modules and the construct modules can import these types
// without closing an import cycle (`noImportCycles` is error-level).
//
// The mutable `BlockNode` is upstream's `Node` during the block pass only. It
// never leaves the engine: `blockParser.ts` materializes the immutable,
// mdast-shaped `MarkdownNode` classes from it once the tree is closed. Two
// fields have no upstream counterpart, both serving the offset delta —
// `startOffset`/`endOffset`, and the `segments` that map accumulated string
// content back to the source it was copied from.

import type {
	BulletChar,
	FenceChar,
	FlowContent,
	Heading,
	HeadingDepth,
	HeadingStyle,
	ListDelimiter,
	Paragraph,
	PhrasingContent,
	Position,
	Root,
	ThematicBreakChar,
} from "../MarkdownNode.js";

/**
 * The block constructs the engine knows. Keys of a dialect's construct table;
 * `definition` is absent because definitions are produced during a
 * paragraph's finalize rather than opened as a block.
 */
export type BlockType =
	| "document"
	| "blockquote"
	| "list"
	| "listItem"
	| "paragraph"
	| "heading"
	| "thematicBreak"
	| "code"
	| "html";

/**
 * A run of characters copied verbatim from the source into a leaf block's
 * accumulated content.
 *
 * The block pass strips container prefixes and expands tabs, so a leaf's
 * content is not a contiguous source slice. Each segment pins one run that
 * IS contiguous, which is what lets the inline pass (Task 8) give its nodes
 * absolute source positions instead of guessing. Characters the engine
 * injects — the `\n` between lines, the spaces a partially consumed tab
 * expands to — lie between segments and belong to no source range.
 */
export interface RawInlineSegment {
	/** Index into the block's accumulated content where this run starts. */
	readonly textOffset: number;
	/** Absolute source offset of that same character. */
	readonly sourceOffset: number;
	/** Length of the run, in characters. */
	readonly length: number;
}

/**
 * A leaf block's raw inline text, handed to the inline pass.
 *
 * `parent` is the materialized node the parsed children belong to; `text` is
 * the trimmed content; `startOffset` is where `text` begins in the source,
 * and `segments` maps the rest of it (see {@link RawInlineSegment}).
 */
export interface RawInlineSlice {
	readonly parent: Paragraph | Heading;
	readonly text: string;
	readonly startOffset: number;
	readonly segments: ReadonlyArray<RawInlineSegment>;
}

/** A leaf's inline text prepared for materialization, before it has a parent. */
export interface PreparedInline {
	readonly text: string;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly segments: ReadonlyArray<RawInlineSegment>;
	/** The temporary passthrough children (see `rawInline.ts`). */
	readonly children: ReadonlyArray<PhrasingContent>;
}

/**
 * Construct-specific state carried on a {@link BlockNode} during the pass —
 * upstream's `_level`, `_isFenced`, `_listData` and friends, gathered into one
 * bag. Every field is optional and none is ever assigned `undefined`
 * explicitly (`exactOptionalPropertyTypes` is on).
 */
export interface BlockData {
	/** Heading depth, set by the ATX and setext starts. */
	level?: HeadingDepth;
	/** Which spelling produced a heading. */
	headingStyle?: HeadingStyle;
	/** Which character drew a thematic break. */
	markerChar?: ThematicBreakChar;
	/** Fenced code: set by the fenced-code start, absent for indented code. */
	isFenced?: boolean;
	fenceChar?: FenceChar;
	fenceLength?: number;
	fenceOffset?: number;
	/** Fenced code info string, split at finalize. */
	lang?: string;
	meta?: string;
	/** HTML block kind, 1 through 7. */
	htmlBlockType?: number;
	/** List and list-item bookkeeping. */
	listData?: ListData;
}

/** A list marker's parsed shape, upstream's `_listData`. */
export interface ListData {
	type: "bullet" | "ordered";
	tight: boolean;
	bulletChar?: BulletChar;
	start?: number;
	delimiter?: ListDelimiter;
	padding: number;
	markerOffset: number;
}

/**
 * A block under construction. Mutable by design — the block pass appends
 * lines and children to it across the line loop — and engine-private.
 */
export interface BlockNode {
	readonly type: BlockType;
	parent: BlockNode | undefined;
	readonly children: BlockNode[];
	/** False once the block has been finalized. */
	open: boolean;
	/** Accumulated line content, for constructs whose `acceptsLines` is true. */
	stringContent: string;
	/** Source provenance of `stringContent` (see {@link RawInlineSegment}). */
	readonly segments: RawInlineSegment[];
	startOffset: number;
	endOffset: number;
	startLine: number;
	endLine: number;
	readonly data: BlockData;
}

/**
 * A construct's `continue` verdict for the current line.
 *
 * - `0` — the block continues.
 * - `1` — it does not; close it.
 * - `2` — the line is fully consumed (a fence close); go to the next line.
 */
export type BlockContinueResult = 0 | 1 | 2;

/**
 * A block start's verdict.
 *
 * - `0` — no match.
 * - `1` — a container opened; keep looking for starts inside it.
 * - `2` — a leaf opened; stop looking.
 */
export type BlockStartResult = 0 | 1 | 2;

/**
 * The parser surface a construct may drive: upstream's scanner state and the
 * handful of parser methods its `blockStarts` functions call, as an
 * interface so constructs never import the parser (and cannot cycle).
 */
export interface BlockScanner {
	/** The current line, terminator stripped. */
	readonly currentLine: string;
	/** Absolute source offset of `currentLine[0]`. */
	readonly lineStart: number;
	/** 1-based number of the current line. */
	readonly lineNumber: number;
	/** Character index into `currentLine` of the scan position. */
	readonly offset: number;
	/** Tab-expanded column of the scan position. */
	readonly column: number;
	/** Character index of the next non-whitespace character. */
	readonly nextNonspace: number;
	/** Tab-expanded column of that character. */
	readonly nextNonspaceColumn: number;
	/** Columns of indentation between the scan position and `nextNonspace`. */
	readonly indent: number;
	/** Whether `indent` reaches the code-indent threshold. */
	readonly indented: boolean;
	/** Whether the rest of the line is blank. */
	readonly blank: boolean;
	/** The deepest open block. */
	readonly tip: BlockNode;
	/** Whether every open block matched this line. */
	readonly allClosed: boolean;
	/** Advance `count` characters, or `count` columns when `columns` is true. */
	advanceOffset(count: number, columns?: boolean): void;
	/** Jump the scan position to `nextNonspace`. */
	advanceNextNonspace(): void;
	/** Finalize every open block that failed to match this line. */
	closeUnmatchedBlocks(): void;
	/** Open a block of `type` as a child of the tip, starting at `offsetInLine`. */
	addChild(type: BlockType, offsetInLine: number): BlockNode;
	/** Close `block`, ending it at the end of `lineNumber`. */
	finalizeBlock(block: BlockNode, lineNumber: number): void;
	/** Append the rest of the current line to the tip's content. */
	addLine(): void;
}

/** What a construct materializes into: a flow node, or the document's root. */
export type MaterializedBlock = Root | FlowContent;

/** Services a construct needs to turn its {@link BlockNode} into a real node. */
export interface MaterializeContext {
	/** Build a {@link Position} from an absolute source range. */
	position(startOffset: number, endOffset: number): Position;
	/** Trim and prepare a leaf's accumulated content for the inline pass. */
	inlineSlice(block: BlockNode): PreparedInline;
	/** Record a leaf's raw inline text against the node that will own it. */
	registerInline(parent: Paragraph | Heading, prepared: PreparedInline): void;
}

/**
 * One block construct: upstream's entry in the `blocks` table, plus the
 * `materialize` step this port adds (upstream renders its own node type, so
 * it has no equivalent).
 */
export interface BlockConstruct {
	readonly type: BlockType;
	/** Whether the construct absorbs line content (upstream's `acceptsLines`). */
	readonly acceptsLines: boolean;
	/** Whether a block of `child` may be opened inside this one. */
	canContain(child: BlockType): boolean;
	/** Whether this block continues on the scanner's current line. */
	continue(scanner: BlockScanner, block: BlockNode): BlockContinueResult;
	/** Post-processing when the block closes. */
	finalize?(scanner: BlockScanner, block: BlockNode): void;
	/**
	 * Build the immutable node. Returning `undefined` drops the block from the
	 * tree (an emptied paragraph, for instance).
	 */
	materialize(
		block: BlockNode,
		children: ReadonlyArray<FlowContent>,
		context: MaterializeContext,
	): MaterializedBlock | undefined;
}

/** One entry of a dialect's ordered block-start table. */
export interface BlockStart {
	/** Diagnostic name; the table's order is what the algorithm depends on. */
	readonly name: string;
	trigger(scanner: BlockScanner, container: BlockNode): BlockStartResult;
}

/** A dialect: a construct table plus an ordered block-start table, nothing more. */
export interface BlockDialect {
	readonly constructs: ReadonlyMap<BlockType, BlockConstruct>;
	readonly starts: ReadonlyArray<BlockStart>;
}

/** Open a fresh {@link BlockNode}. */
export const makeBlockNode = (type: BlockType, startOffset: number, startLine: number): BlockNode => ({
	type,
	parent: undefined,
	children: [],
	open: true,
	stringContent: "",
	segments: [],
	startOffset,
	endOffset: startOffset,
	startLine,
	endLine: startLine,
	data: {},
});
