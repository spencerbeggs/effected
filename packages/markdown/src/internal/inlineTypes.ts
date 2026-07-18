// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// The vocabulary the inline constructs and the inline parser share, extracted
// into a leaf for the same reason `blockTypes.ts` is one: the registry imports
// the construct modules, so the constructs cannot import the registry.
//
// Upstream dispatches on a character in a `switch` inside `parseInline`. Here
// the same dispatch is a per-dialect table keyed by trigger character, which
// is what lets P2's GFM constructs (autolink literals, strikethrough) register
// without touching the parser.

import type { PhrasingContent, Position, Text } from "../MarkdownNode.js";
import type { RawInlineSegment } from "./blockTypes.js";

/**
 * A leaf block's raw text with the provenance needed to position what the
 * inline pass builds out of it.
 *
 * `RawInlineSlice` widens this with the node that will own the children;
 * a slice is therefore usable wherever a source is.
 */
export interface InlineSource {
	readonly text: string;
	readonly startOffset: number;
	readonly segments: ReadonlyArray<RawInlineSegment>;
}

/**
 * The cursor and output surface an inline construct drives.
 *
 * Positions are the reason this is not just a string and an index: every
 * local index maps back through the segment table to an absolute source
 * offset, so a node built here is positioned in the ORIGINAL document rather
 * than in the stripped, tab-expanded content the block pass accumulated.
 */
export interface InlineScanner {
	/** The content being parsed — a leaf block's trimmed text. */
	readonly subject: string;
	/** The cursor. */
	pos: number;
	/** The char code at the cursor, or `-1` at the end. */
	peek(): number;
	/** Match `pattern` AT the cursor, advancing past it on success. */
	match(pattern: RegExp): string | undefined;
	/**
	 * Scan forward for `pattern`, advancing past it on success.
	 *
	 * Only the code span's search for its closing backtick run wants this;
	 * everything else asks whether a construct begins at the cursor, and a
	 * match found further along is not one.
	 */
	matchAhead(pattern: RegExp): string | undefined;
	/** The absolute source offset of a local index. */
	offsetAt(index: number): number;
	/** A {@link Position} from a local index range. */
	position(from: number, to: number): Position;
	/**
	 * Append literal text spanning local `[from, to)`. Merges into the
	 * preceding {@link Text} when there is one, which is what keeps a soft
	 * line break a `\n` inside one text value rather than a node boundary.
	 */
	appendText(value: string, from: number, to: number): void;
	/** Append a node. */
	append(node: PhrasingContent): void;
	/** The trailing {@link Text}, if the last child is one. */
	lastText(): Text | undefined;
	/**
	 * Strip trailing spaces from the trailing {@link Text}, pulling its end
	 * position back, and report how many were removed. Removes the node if
	 * nothing survives.
	 */
	trimTrailingSpaces(): number;
}

/** One inline construct: upstream's `parse*` methods, one per module. */
export interface InlineConstruct {
	readonly name: string;
	/**
	 * The character codes that give this construct a chance. A construct with
	 * no triggers is the fallback that consumes ordinary text.
	 */
	readonly triggers: ReadonlyArray<number>;
	/** Try to parse at the cursor; `false` leaves the cursor untouched. */
	parse(scanner: InlineScanner): boolean;
}

/** A dialect: a trigger table plus the text fallback, nothing more. */
export interface InlineDialect {
	readonly byTrigger: ReadonlyMap<number, ReadonlyArray<InlineConstruct>>;
	readonly text: InlineConstruct;
}
