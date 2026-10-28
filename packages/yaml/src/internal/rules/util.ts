// Shared rule helpers: span queries over the eager token array, the
// scalar walk the style rules share, and the bounded numeric option schema.

import { Schema } from "effect";
import type { LintContext, LintLine } from "../../YamlLintRule.js";
import type { YamlNode, YamlScalar } from "../../YamlNode.js";
import { YamlScalar as Scalar, YamlMap, YamlSeq } from "../../YamlNode.js";
import type { YamlToken } from "../../YamlToken.js";
import { composeAllDocuments } from "../composer/document.js";

/**
 * Whether `text` ends in a line break. A bare `\r` counts, as it does
 * everywhere positions are computed (YAML 1.2 `b-break`, the lexer's
 * `newline` token, `LintLine` splitting): a bare-CR document lints the way
 * its LF twin does.
 */
export const endsWithLineBreak = (text: string): boolean => text.endsWith("\n") || text.endsWith("\r");

/**
 * A non-negative integer — the shape every numeric rule option takes.
 * Rejects NaN, negatives and fractions with a message naming the constraint;
 * the config layer's wrapper names the rule and the field.
 */
export const nonNegativeIntegerOption = Schema.Number.check(
	Schema.makeFilter((n) => (Number.isInteger(n) && n >= 0 ? undefined : "Expected a non-negative integer")),
);

/**
 * A positive integer — for the `maxSpacesAfter` options, where `0` would make
 * the fix delete the separation space after an indicator and fuse it with its
 * content (`- item` → `-item`, `a: val` → `a:val` — different tokens, not a
 * spacing change).
 */
export const positiveIntegerOption = Schema.Number.check(
	Schema.makeFilter((n) =>
		Number.isInteger(n) && n >= 1 ? undefined : "Expected an integer greater than or equal to 1",
	),
);

/** Where a scalar sits in its parent construct. */
export type ScalarRole = "key" | "value" | "item" | "root";

/** Depth-first walk over every scalar node with its structural role. */
export function walkScalars(
	node: YamlNode | null,
	role: ScalarRole,
	visit: (scalar: YamlScalar, role: ScalarRole) => void,
): void {
	if (node === null) return;
	if (node instanceof Scalar) {
		visit(node, role);
		return;
	}
	if (node instanceof YamlMap) {
		for (const pair of node.items) {
			walkScalars(pair.key, "key", visit);
			walkScalars(pair.value, "value", visit);
		}
		return;
	}
	if (node instanceof YamlSeq) {
		for (const item of node.items) walkScalars(item, "item", visit);
	}
}

/**
 * True when the first content of a line is the CONTINUATION of a scalar
 * token that began on an earlier line — block-scalar bodies and multi-line
 * plain/quoted scalars. The indentation rule skips such lines: their layout
 * is the value's, not block structure's.
 */
export function isScalarContinuationLine(
	tokens: ReadonlyArray<YamlToken>,
	lineOffset: number,
	probeOffset: number,
): boolean {
	const token = coveringToken(tokens, probeOffset);
	return token !== undefined && token.kind === "scalar" && token.offset < lineOffset;
}

/** The token whose span covers `offset`, when one does. */
export function coveringToken(tokens: ReadonlyArray<YamlToken>, offset: number): YamlToken | undefined {
	let lo = 0;
	let hi = tokens.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const token = tokens[mid] as YamlToken;
		if (offset < token.offset) {
			hi = mid - 1;
		} else if (offset >= token.offset + token.length) {
			lo = mid + 1;
		} else {
			return token;
		}
	}
	return undefined;
}

/**
 * True when `offset` falls inside a scalar token's span. Layout rules use
 * this to stay off scalar CONTENT — trailing whitespace or blank lines
 * inside a block scalar are part of the parsed value, and a lint layer that
 * edits content under the banner of layout is corrupting, not fixing.
 */
export function insideScalarSpan(tokens: ReadonlyArray<YamlToken>, offset: number): boolean {
	return coveringToken(tokens, offset)?.kind === "scalar";
}

/**
 * The line containing `offset` and the character index within it — a binary
 * search over the ordered `LintLine` array (lines are ordered by `offset`,
 * the same invariant {@link coveringToken} rests on for tokens).
 */
export function positionAt(
	lines: ReadonlyArray<LintLine>,
	offset: number,
): { readonly line: number; readonly character: number } {
	let lo = 0;
	let hi = lines.length - 1;
	let found: LintLine | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const line = lines[mid] as LintLine;
		if (line.offset <= offset) {
			found = line;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found === undefined ? { line: 0, character: 0 } : { line: found.number, character: offset - found.offset };
}

/** One composed scalar's source span, its structural role and its style. */
export interface ComposedScalar {
	readonly offset: number;
	readonly end: number;
	readonly role: ScalarRole;
	readonly style: YamlScalar["style"];
}

const composedScalarsCache = new WeakMap<LintContext, ReadonlyArray<ComposedScalar>>();
const composedContentsCache = new WeakMap<LintContext, ReadonlyArray<YamlNode | null>>();

/**
 * The composed contents of every document in the context's text. The lint
 * context carries only the FIRST document, and a fix in a later one must be
 * judged against what the composer reads there too.
 */
function composedContents(ctx: LintContext): ReadonlyArray<YamlNode | null> {
	const cached = composedContentsCache.get(ctx);
	if (cached !== undefined) return cached;
	const contents = composeAllDocuments(ctx.text, { uniqueKeys: false }).documents.map((d) => d.contents);
	composedContentsCache.set(ctx, contents);
	return contents;
}

/**
 * Every scalar the COMPOSER reads in the context's text, across all of its
 * documents, ordered by offset. Built once per lint context, on first use.
 *
 * Tokens are the lexer's view and can disagree with the composer: on
 * `"b\n -  a"` the lexer emits a `block-seq-entry` for the `-` while the
 * composer folds the second line into the plain scalar `"b -  a"`. A fix
 * keyed on that token edits scalar content and changes the parsed value, so
 * a fix that must stay off content asks the composer instead.
 */
export function composedScalars(ctx: LintContext): ReadonlyArray<ComposedScalar> {
	const cached = composedScalarsCache.get(ctx);
	if (cached !== undefined) return cached;
	const out: Array<ComposedScalar> = [];
	for (const contents of composedContents(ctx)) {
		walkScalars(contents, "root", (scalar, role) => {
			out.push({ offset: scalar.offset, end: scalar.offset + scalar.length, role, style: scalar.style });
		});
	}
	out.sort((a, b) => a.offset - b.offset);
	composedScalarsCache.set(ctx, out);
	return out;
}

/**
 * True when `offset` is CONTENT of a scalar the composer reads: inside its
 * span `[offset, end)` and past its first character. Scalars never nest, so
 * the spans are disjoint and a binary search finds the only candidate.
 */
export function insideComposedScalar(ctx: LintContext, offset: number): boolean {
	const scalars = composedScalars(ctx);
	let lo = 0;
	let hi = scalars.length - 1;
	let found: ComposedScalar | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const scalar = scalars[mid] as ComposedScalar;
		if (scalar.offset <= offset) {
			found = scalar;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found !== undefined && offset > found.offset && offset < found.end;
}

/**
 * True when a later line of the same construct starts in the column window
 * `[lo, hi]` — the columns a spacing fix moves content across when it
 * shifts that content from column `hi` to column `lo` on line `line`.
 *
 * Block structure is read off columns, so a line indented into that window
 * can change parents when the content moves: it sat left of the content
 * (a sibling or a parent's entry) and ends up at or right of it (a child),
 * or the reverse. Lines are scanned until the first one indented at or left
 * of `stop`, the column of the indicator that owns the construct, which
 * ends it. Blank and comment-only lines carry no structure and are skipped.
 */
export function laterLineInWindow(ctx: LintContext, line: number, stop: number, lo: number, hi: number): boolean {
	for (let n = line + 1; n < ctx.lines.length; n++) {
		const text = (ctx.lines[n] as LintLine).text;
		let indent = 0;
		while (indent < text.length && text[indent] === " ") indent++;
		if (indent === text.length || text[indent] === "#") continue;
		if (indent <= stop) return false;
		if (indent >= lo && indent <= hi) return true;
	}
	return false;
}
