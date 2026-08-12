// Comment-fidelity helpers shared by the block and flow composers: blank-line
// detection between source spans, and immutable node rebuilds that merge the
// comment field triple (`commentBefore` / `comment` / `spaceBefore`) onto an
// already-composed node.
//
// Attribution semantics (the #127 model, prior art: the `yaml` npm package):
// an own-line comment attaches FORWARD to the following pair/item as
// `commentBefore`; a comment on the same line as the end of a pair/item
// attaches to it as the trailing `comment`; own-line comments after a
// collection's last entry become the collection's `comment` when at (or
// beyond) the collection's content column and escape to the outer scope when
// shallower; `spaceBefore` is set when a blank line precedes the entry (and
// its `commentBefore` block); blank lines within/after a comment run embed
// as extra `\n`s in the joined string; comment text is the RAW post-`#`
// slice (see `rawCommentText`).
//
// ── Recorded divergences from the reference `yaml` npm package ─────────────
//
// The one place the divergences live; each is deliberate, and the emitted
// bytes remain reparse-stable in every case.
//
// 1. PAIR-LEVEL fields. `commentBefore`/`comment`/`spaceBefore` live on
//    `YamlPair` (plus the three value node classes); the reference attaches
//    them to the key/value NODES and `Pair` carries none. One consequence: a
//    key-line comment and an inline value's trailing comment are the same
//    field here, so `a: # kc\n  1` re-emits as `a: 1 # kc` (relocation
//    ratified in review) and a key comment never forces explicit-key form
//    on a null-value pair (the reference's `? a # kc` spelling).
// 2. ALIAS comments drop. `YamlAlias` carries no comment fields (the #127
//    split covers the four classes); a comment attributed to an alias node
//    is dropped.
// 3. TRAILING-comment drop on block-scalar values and multi-line complex
//    keys: neither shape has a line that can carry a `#` comment without
//    changing what reparses (a block-scalar body would absorb it; a
//    multi-line key would swallow it into the key content), so the comment
//    is dropped rather than relocated.
// 4. FLOW comment layout normalizes. A comment-carrying flow collection
//    re-emits in multi-line flow layout (single-line flow cannot carry `#`
//    without swallowing the closing bracket); byte-stable from the second
//    format pass. The reference makes the same one-line-per-entry choice.
// 5. PRE-`#` spacing normalizes to one space on trailing comments
//    (`a: 1   # t` → `a: 1 # t`) — the post-`#` storage form cannot carry
//    it. The reference behaves identically.
// 6. DOCUMENT comment naming. `RawYamlDocument.comment` is the LEADING
//    header block and `commentAfter` the trailing block (after content or
//    `...`); the reference spells these `commentBefore`/`comment`. The
//    pre-existing `comment`-as-header field stays stable. Comments after a
//    `...` marker in a MULTI-document stream may attach to the following
//    document's header rather than the preceding document's trailer,
//    depending on CST document splitting.

import type { YamlNode } from "../../YamlNode.js";
import { YamlMap, YamlScalar, YamlSeq } from "../../YamlNode.js";

/** The comment field triple accepted by {@link withCommentFields}. */
export interface CommentFields {
	commentBefore?: string;
	comment?: string;
	spaceBefore?: boolean;
}

/**
 * True when the source text between `start` (exclusive of its line) and `end`
 * contains at least one blank line (a newline followed, after optional
 * horizontal whitespace, by another newline).
 */
export function hasBlankLineBetween(text: string, start: number, end: number): boolean {
	if (start < 0) return false;
	const gap = text.slice(Math.max(0, start), Math.max(0, end));
	return /\n[ \t\r]*\n/.test(gap);
}

/** True when there is no line break between `start` and `end` in `text`. */
export function sameLineSpan(text: string, start: number, end: number): boolean {
	if (start < 0) return false;
	return !text.slice(Math.max(0, start), Math.max(0, end)).includes("\n");
}

/**
 * True when only horizontal whitespace precedes `offset` on its line — i.e.
 * the token at `offset` starts its own line. Purely local, so it stays
 * correct even when a preceding node's span over-extends past line ends.
 */
export function isOwnLineAt(text: string, offset: number): boolean {
	let i = offset - 1;
	while (i >= 0) {
		const ch = text[i];
		if (ch === " " || ch === "\t") {
			i--;
			continue;
		}
		return ch === "\n" || ch === "\r";
	}
	return true;
}

/**
 * True when the line immediately above the line containing `offset` is blank
 * (empty or horizontal whitespace only). Purely local — see
 * {@link isOwnLineAt} for why span-based gap checks are not used.
 */
export function hasBlankLineAbove(text: string, offset: number): boolean {
	const lineBreak = text.lastIndexOf("\n", Math.max(0, offset - 1));
	if (lineBreak < 0) return false;
	const prevBreak = text.lastIndexOf("\n", lineBreak - 1);
	const prevLine = text.slice(prevBreak + 1, lineBreak);
	return prevLine.trim() === "";
}

/**
 * The stored text of a comment token: the RAW post-`#` slice, reference
 * parity with the `yaml` npm package — `# section` stores `" section"`,
 * `#no-space` stores `"no-space"`, `#   aligned` keeps its alignment.
 *
 * The one reserved string is `""`, which encodes an embedded blank line
 * inside a joined comment run — so a spaces-only raw slice stores with ONE
 * extra trailing space and the renderers strip it back off. A bare `#`
 * (raw `""`) stores `" "`, `# ` (raw `" "`) stores `"  "`, and so on; the
 * escape is injective, so every comment spelling roundtrips byte-intact.
 * Raw storage is what makes byte-intact roundtrip possible; trimming would
 * canonicalize every comment to `# text`.
 */
export function rawCommentText(source: string): string {
	const raw = source.startsWith("#") ? source.slice(1) : source;
	return /^ *$/.test(raw) ? `${raw} ` : raw;
}

/** Join two optional comment blocks with a newline. */
export function joinComments(a: string | undefined, b: string): string {
	return a === undefined ? b : `${a}\n${b}`;
}

/** Zero-based column of `offset` within its line. */
export function columnAt(text: string, offset: number): number {
	if (offset <= 0) return 0;
	return offset - (text.lastIndexOf("\n", offset - 1) + 1);
}

/**
 * A comment that outlived its collection: it sat after the collection's last
 * entry at a column SHALLOWER than the collection's content, so it belongs
 * to an outer scope (reference parity — a column-0 `# tail` between a nested
 * block and the next root key documents the next root key, not the nested
 * block). Escaped comments ride `ComposerState` up one level, where the
 * enclosing composer re-injects them into its own item stream.
 */
export interface EscapedComment {
	readonly text: string;
	readonly offset: number;
}

/**
 * Rebuild `node` with the given comment fields merged in (existing fields are
 * kept unless overridden; `commentBefore`/`comment` join with a newline when
 * both sides are present). Aliases are returned unchanged — they carry no
 * comment fields.
 */
export function withCommentFields(node: YamlNode, fields: CommentFields): YamlNode {
	if (node instanceof YamlScalar) {
		return new YamlScalar({
			value: node.value,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...mergedCommentFields(node, fields),
			...(node.chomp !== undefined ? { chomp: node.chomp } : {}),
			...(node.raw !== undefined ? { raw: node.raw } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlMap) {
		return new YamlMap({
			items: node.items,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...mergedCommentFields(node, fields),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlSeq) {
		return new YamlSeq({
			items: node.items,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...mergedCommentFields(node, fields),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	return node;
}

function mergedCommentFields(existing: CommentFields, incoming: CommentFields): CommentFields {
	const commentBefore =
		incoming.commentBefore !== undefined
			? existing.commentBefore !== undefined
				? `${existing.commentBefore}\n${incoming.commentBefore}`
				: incoming.commentBefore
			: existing.commentBefore;
	const comment =
		incoming.comment !== undefined
			? existing.comment !== undefined
				? `${existing.comment}\n${incoming.comment}`
				: incoming.comment
			: existing.comment;
	const spaceBefore = incoming.spaceBefore ?? existing.spaceBefore;
	return {
		...(commentBefore !== undefined ? { commentBefore } : {}),
		...(comment !== undefined ? { comment } : {}),
		...(spaceBefore !== undefined ? { spaceBefore } : {}),
	};
}
