// Scanner-based path navigation for the modifier. Private implementation.
//
// Resolution is structural, through the scanner's tokens, rather than a
// string search that breaks on keys containing quote characters: the matching
// property's key offset is captured directly from the key token, never
// guessed from the source text. `navigate` returns a plain structural result;
// `JsoncModifier` synthesizes edits and constructs `JsoncModificationError`
// from it, so this module never imports the facade or the edit vocabulary.

import type { JsoncPath } from "../JsoncNode.js";
import { createScanner } from "./scanner.js";
import type { SkipCursor } from "./skip.js";
import { skipBalancedValue } from "./skip.js";

/** The target property/element was located. */
export interface Located {
	readonly _tag: "Located";
	readonly container: "object" | "array";
	/** Start offset of the property key (object) or the element value (array). */
	readonly keyStart: number;
	/** Start offset of the value token. */
	readonly valueStart: number;
	/** Tight end offset of the value (excludes trailing whitespace/comments). */
	readonly valueEnd: number;
	/**
	 * Offset of the separator comma preceding this entry in its container, or
	 * undefined when the entry is first. Captured from the comma token itself so
	 * edit synthesis never searches raw text (commas inside comments are
	 * invisible here).
	 */
	readonly commaBefore?: number | undefined;
	/** Offset of the comma token immediately following the value, if any. */
	readonly commaAfter?: number | undefined;
	/** Leading whitespace of the line holding `keyStart`. */
	readonly lineIndent: string;
	/** Offset of the container's opening token. */
	readonly open: number;
	/**
	 * Offset of the container's closing token when this entry is the container's
	 * last, or undefined when another entry follows it.
	 */
	readonly close?: number | undefined;
}

/** The target does not exist; an insertion point was resolved instead. */
export interface Insert {
	readonly _tag: "Insert";
	readonly container: "object" | "array";
	/**
	 * Tight end offset of the entry the new one follows, or where the first entry
	 * goes when the container is empty.
	 */
	readonly at: number;
	/** Offset of the comma token immediately following that entry, if any. */
	readonly commaAfter?: number | undefined;
	/** Whether the container is empty (affects surrounding punctuation). */
	readonly isFirst: boolean;
	/** Offset of the container's opening token. */
	readonly open: number;
	/** Leading whitespace of the line holding the container's opening token. */
	readonly parentIndent: string;
	/**
	 * Leading whitespace of that entry's line, the column a new entry lines up
	 * with. Undefined when the container is empty or that entry still sits on
	 * the line of the opening token, where the indent says nothing about members.
	 */
	readonly memberIndent?: string | undefined;
}

/**
 * An object on the way to the target lacks the next key. Distinct from
 * {@link Mismatch}, where the key exists and holds the wrong type: this one can
 * be repaired by creating the missing object at the insertion point it carries.
 */
export interface MissingAncestor extends Omit<Insert, "_tag" | "container"> {
	readonly _tag: "MissingAncestor";
	/** Index into the path of the segment the object lacks. */
	readonly segmentIndex: number;
}

/** A structural type mismatch: expected an object or array but found otherwise. */
export interface Mismatch {
	readonly _tag: "Mismatch";
	readonly depth: number;
	readonly expected: "object" | "array";
}

/** Nothing to resolve (e.g. navigating an empty path segment set). */
export interface NoOp {
	readonly _tag: "NoOp";
}

/** The outcome of navigating a {@link JsoncPath} through JSONC source. */
export type NavigateResult = Located | Insert | MissingAncestor | Mismatch | NoOp;

export const isLineBreak = (char: string): boolean => char === "\n" || char === "\r";

export const isBlank = (char: string): boolean => char === " " || char === "\t";

/** Offset of the first character of the line holding `offset`. */
const lineStart = (text: string, offset: number): number => {
	let start = offset;
	while (start > 0 && !isLineBreak(text.charAt(start - 1))) start--;
	return start;
};

/** The spaces and tabs that open the line holding `offset`. */
const lineIndent = (text: string, offset: number): string => {
	const start = lineStart(text, offset);
	let end = start;
	while (isBlank(text.charAt(end))) end++;
	return text.slice(start, end);
};

/**
 * Resolve `path` against `text`, returning where the target is (or where it
 * would be inserted). `path` must be non-empty — the whole-document case is
 * handled by the caller. A new object member goes after the key `insertAfter`
 * when the object receiving it holds that key, and after the last member
 * otherwise. Under a missing ancestor, that object is the deepest one existing.
 */
export function navigate(text: string, path: JsoncPath, insertAfter?: string): NavigateResult {
	if (path.length === 0) {
		return { _tag: "NoOp" };
	}

	const scanner = createScanner(text, true);
	let currentToken = scanner.scan();

	// Tight end-of-token offset for the CURRENT token. Because this scanner
	// ignores trivia, scan() silently skips whitespace when advancing, so
	// getTokenOffset() after advancing is the start of the NEXT token; capture
	// this value before advancing.
	function tokenEnd(): number {
		return scanner.getTokenOffset() + scanner.getTokenLength();
	}

	// Cursor adapter for the shared iterative bracket-balance skip (see
	// internal/skip.ts). Being non-recursive, the skip cannot overflow the
	// stack on hostile deeply-nested input, so `navigate` (and `JsoncModifier`)
	// need no separate depth cap. Malformed input can route a non-value token
	// here (JsoncModifier.modify passes raw text straight to navigate(), so a
	// value slot may hold a closer, e.g. `{"k":}`) — the helper's guard leaves
	// the cursor untouched in that case.
	const skipCursor: SkipCursor = {
		getToken: () => currentToken,
		advance: () => {
			currentToken = scanner.scan();
		},
		tokenStart: () => scanner.getTokenOffset(),
		tokenEnd,
	};

	// Skip the value starting at currentToken and return its tight end offset.
	function skipValue(): number {
		return skipBalancedValue(skipCursor);
	}

	// Complete a Located result from the token just past the value. Reading the
	// token after a comma is safe: every caller returns straight away.
	function located(
		container: "object" | "array",
		open: number,
		keyStart: number,
		valueStart: number,
		commaBefore: number | undefined,
	): Located {
		const valueEnd = skipValue();
		let commaAfter: number | undefined;
		if (currentToken === "Comma") {
			commaAfter = scanner.getTokenOffset();
			currentToken = scanner.scan();
		}
		const closes = currentToken === (container === "object" ? "CloseBrace" : "CloseBracket");
		return {
			_tag: "Located",
			container,
			keyStart,
			valueStart,
			valueEnd,
			commaBefore,
			commaAfter,
			lineIndent: lineIndent(text, keyStart),
			open,
			close: closes ? scanner.getTokenOffset() : undefined,
		};
	}

	function insertionPoint(
		at: number,
		commaAfter: number | undefined,
		isFirst: boolean,
		open: number,
		entryStart: number | undefined,
	): Omit<Insert, "_tag" | "container"> {
		const onOwnLine = entryStart !== undefined && lineStart(text, entryStart) > open;
		return {
			at,
			commaAfter,
			isFirst,
			open,
			parentIndent: lineIndent(text, open),
			memberIndent: onOwnLine ? lineIndent(text, entryStart) : undefined,
		};
	}

	// The comma token at the cursor, just past a value that was skipped.
	function commaHere(): number | undefined {
		return currentToken === "Comma" ? scanner.getTokenOffset() : undefined;
	}

	let depth = 0;
	for (const segment of path) {
		depth++;
		if (typeof segment === "string") {
			if (currentToken !== "OpenBrace") {
				return { _tag: "Mismatch", depth, expected: "object" };
			}
			const open = scanner.getTokenOffset();
			currentToken = scanner.scan();
			let found = false;
			let lastValueEnd = scanner.getTokenOffset();
			let isFirst = true;
			let lastComma: number | undefined;
			let lastKeyStart: number | undefined;
			let lastCommaAfter: number | undefined;
			let anchor: { readonly keyStart: number; readonly end: number; readonly comma: number | undefined } | undefined;

			while (currentToken !== "CloseBrace" && currentToken !== "EOF") {
				if (!isFirst && currentToken === "Comma") {
					lastComma = scanner.getTokenOffset();
					currentToken = scanner.scan();
					// A trailing comma: the closer ends the scan, it is not an entry.
					if (currentToken === "CloseBrace") break;
				}
				if (currentToken === "String") {
					const keyStart = scanner.getTokenOffset();
					lastKeyStart = keyStart;
					const key = scanner.getTokenValue();
					currentToken = scanner.scan(); // skip key
					if (currentToken === "Colon") {
						currentToken = scanner.scan(); // skip colon
					}
					if (key === segment) {
						found = true;
						if (depth === path.length) {
							return located("object", open, keyStart, scanner.getTokenOffset(), lastComma);
						}
						break; // descend into this value on the next segment
					}
					lastValueEnd = skipValue();
					lastCommaAfter = commaHere();
					// Last one wins, as it does when a duplicated key is parsed.
					if (key === insertAfter) {
						anchor = { keyStart, end: lastValueEnd, comma: lastCommaAfter };
					}
				} else {
					currentToken = scanner.scan();
					lastValueEnd = scanner.getTokenOffset();
					lastCommaAfter = undefined;
				}
				isFirst = false;
			}

			if (!found) {
				const point =
					anchor !== undefined
						? insertionPoint(anchor.end, anchor.comma, false, open, anchor.keyStart)
						: insertionPoint(lastValueEnd, lastCommaAfter, isFirst, open, lastKeyStart);
				return depth === path.length
					? { _tag: "Insert", container: "object", ...point }
					: { _tag: "MissingAncestor", segmentIndex: depth - 1, ...point };
			}
		} else {
			if (currentToken !== "OpenBracket") {
				return { _tag: "Mismatch", depth, expected: "array" };
			}
			const open = scanner.getTokenOffset();
			currentToken = scanner.scan();
			let idx = 0;
			let lastEnd = scanner.getTokenOffset();
			let lastComma: number | undefined;
			let lastElementStart: number | undefined;
			let lastCommaAfter: number | undefined;

			while (currentToken !== "CloseBracket" && currentToken !== "EOF") {
				if (idx > 0 && currentToken === "Comma") {
					lastComma = scanner.getTokenOffset();
					currentToken = scanner.scan();
					// A trailing comma: the closer ends the scan, it is not an element.
					if (currentToken === "CloseBracket") break;
				}
				if (idx === segment) {
					if (depth === path.length) {
						const valueStart = scanner.getTokenOffset();
						return located("array", open, valueStart, valueStart, lastComma);
					}
					break; // descend into this element on the next segment
				}
				lastElementStart = scanner.getTokenOffset();
				lastEnd = skipValue();
				lastCommaAfter = commaHere();
				idx++;
			}

			if (idx <= segment && depth === path.length) {
				return {
					_tag: "Insert",
					container: "array",
					...insertionPoint(lastEnd, lastCommaAfter, idx === 0, open, lastElementStart),
				};
			}
		}
	}

	return { _tag: "NoOp" };
}
