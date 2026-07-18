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

import type { Definition } from "../MarkdownNode.js";
import type { RawInlineSegment } from "./blockTypes.js";
import type { InlineNode } from "./inlineNode.js";

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
 * One entry of the delimiter stack: a run of `*` or `_` that might open or
 * close emphasis, and the text node holding those characters.
 */
export interface Delimiter {
	/** The delimiter character's code. */
	readonly cc: number;
	/** How many delimiters are still unused. */
	numdelims: number;
	/** How many there were to begin with — the multiple-of-three rule reads this. */
	readonly origdelims: number;
	/** The text node carrying the run; emphasis truncates it in place. */
	readonly node: InlineNode;
	previous: Delimiter | undefined;
	next: Delimiter | undefined;
	readonly canOpen: boolean;
	readonly canClose: boolean;
}

/** One entry of the bracket stack: an unmatched `[` or `![`. */
export interface Bracket {
	/** The text node carrying the bracket. */
	readonly node: InlineNode;
	previous: Bracket | undefined;
	/** The delimiter stack top when this bracket opened. */
	readonly previousDelimiter: Delimiter | undefined;
	/** Where the bracket's content starts. */
	readonly index: number;
	/** Whether this opener was `![`. */
	readonly image: boolean;
	/** Cleared when an enclosing link forms — links do not nest. */
	active: boolean;
	/** Whether another bracket opened after this one. */
	bracketAfter?: boolean;
}

/**
 * The cursor, output list and stacks an inline construct drives — upstream's
 * `InlineParser` object, as the interface its constructs see.
 *
 * Positions are the reason the source is here: every local index maps back
 * through the segment table to an absolute source offset, so a node built
 * here is positioned in the ORIGINAL document rather than in the stripped,
 * tab-expanded content the block pass accumulated.
 */
export interface InlineScanner {
	/** The content being parsed — a leaf block's trimmed text. */
	readonly subject: string;
	/** The cursor. */
	pos: number;
	/** The definitions a reference may resolve against. */
	readonly refmap: ReadonlyMap<string, Definition>;
	/** The delimiter stack top. */
	delimiters: Delimiter | undefined;
	/** The bracket stack top. */
	brackets: Bracket | undefined;

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

	/** Append a node to the output list. */
	append(node: InlineNode): void;
	/** Append a literal text node spanning local `[from, to)`. */
	appendText(value: string, from: number, to: number): InlineNode;
	/** The last node appended, if any. */
	lastChild(): InlineNode | undefined;
	/**
	 * Strip trailing spaces from the trailing text node, pulling its end back,
	 * and report how many were removed. Removes the node if nothing survives.
	 */
	trimTrailingSpaces(): number;

	/** Drop `delimiter` from the stack. */
	removeDelimiter(delimiter: Delimiter): void;
	/** Push a bracket opener. */
	addBracket(node: InlineNode, index: number, image: boolean): void;
	/** Pop the top bracket opener. */
	removeBracket(): void;
	/** Run the emphasis algorithm down to `stackBottom`. */
	processEmphasis(stackBottom: Delimiter | undefined): void;
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
