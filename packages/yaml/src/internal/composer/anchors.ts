// Anchor/alias machinery: alias node construction, anchor registration and
// name scanning, plus the anchor-map/value-extraction helpers the facade and
// compliance harness drive (`buildAnchorMap`, `getNodeValue`).

import type { YamlNode } from "../../YamlNode.js";
import { YamlAlias, YamlMap, YamlScalar, YamlSeq } from "../../YamlNode.js";
import type { CstNode } from "../cst.js";
import type { ComposerState, NodeMeta } from "./state.js";

/**
 * Check if a pending anchor is being applied to an alias node (invalid in YAML 1.2 §3.2.2).
 * Aliases represent references to existing anchored nodes and cannot have their own anchors.
 *
 * Uses `DuplicateAnchor` error code as a pragmatic reuse — semantically this is
 * "anchor on alias" rather than "same anchor name defined twice", but adding a
 * dedicated `AnchorOnAlias` code would be a public API change. The error message
 * distinguishes the two cases for consumers inspecting the message text.
 */
export function checkAnchorOnAlias(pendingMeta: NodeMeta, cst: CstNode, state: ComposerState): void {
	if (pendingMeta.anchor !== undefined) {
		state.errors.push({
			code: "DuplicateAnchor",
			message: `Anchor &${pendingMeta.anchor} cannot be applied to alias *${getAliasName(cst, state.text)}`,
			offset: cst.offset,
			length: cst.length,
		});
	}
}

export function makeAlias(cst: CstNode, state: ComposerState): YamlAlias {
	const name = getAliasName(cst, state.text);

	// Check existence first — an undefined alias is a more specific error
	// than a count exceeded error.
	if (!state.anchors.has(name)) {
		state.errors.push({
			code: "UndefinedAlias",
			message: `Undefined alias: *${name}`,
			offset: cst.offset,
			length: cst.length,
		});
	} else {
		// Only count valid (defined) aliases toward the limit.
		state.aliasCount++;
		if (state.aliasCount > state.options.maxAliasCount) {
			state.errors.push({
				code: "AliasCountExceeded",
				message: `Alias count exceeded maximum of ${state.options.maxAliasCount}`,
				offset: cst.offset,
				length: cst.length,
			});
		}
	}

	return new YamlAlias({ name, offset: cst.offset, length: cst.length });
}

export function registerAnchor(node: YamlNode, anchor: string, state: ComposerState, offset: number): void {
	if (state.anchors.has(anchor)) {
		state.warnings.push({
			code: "DuplicateAnchor",
			message: `Duplicate anchor: &${anchor}`,
			offset,
			length: anchor.length + 1,
		});
	}
	state.anchors.set(anchor, node);
}

export function getAnchorName(cst: CstNode, text: string): string {
	// The CST anchor node has offset and length from the lexer token.
	// The lexer's anchor token has value = name (without &), and the CST's
	// makeLeafNode uses token.offset and token.length. But token.length
	// equals the value length (without &), so CST source = text.slice(offset, offset+length)
	// which starts with "&" but is one char short. We read from original text
	// starting after the "&" for the correct name.
	// The raw text at offset starts with "&", so the name is text[offset+1 .. offset+length+1]
	const rawStart = text[cst.offset];
	if (rawStart === "&") {
		// Length in the token is the name length, but the offset includes the "&"
		// So the name goes from offset+1 to offset+1+length, but we can also
		// scan forward from offset+1 until we hit whitespace/flowIndicator/etc
		return scanName(text, cst.offset + 1);
	}
	return cst.source;
}

export function getAliasName(cst: CstNode, text: string): string {
	const rawStart = text[cst.offset];
	if (rawStart === "*") {
		return scanName(text, cst.offset + 1);
	}
	return cst.source;
}

export function scanName(text: string, start: number): string {
	let end = start;
	// YAML 1.2 ns-anchor-char: any non-whitespace char except c-flow-indicator
	while (end < text.length) {
		const ch = text[end];
		if (
			ch === " " ||
			ch === "\t" ||
			ch === "\n" ||
			ch === "\r" ||
			ch === "{" ||
			ch === "}" ||
			ch === "[" ||
			ch === "]" ||
			ch === "," ||
			ch === undefined
		) {
			break;
		}
		end++;
	}
	return text.slice(start, end);
}

// ---------------------------------------------------------------------------
// Anchor map / value extraction
// ---------------------------------------------------------------------------

/**
 * Build an anchor map by walking the AST, collecting nodes that have anchors.
 * Used to resolve aliases when extracting plain JavaScript values from
 * parsed YAML documents.
 */
export function buildAnchorMap(node: YamlNode | null): Map<string, YamlNode> {
	const anchors = new Map<string, YamlNode>();
	collectAnchors(node, anchors);
	return anchors;
}

function collectAnchors(node: YamlNode | null, anchors: Map<string, YamlNode>): void {
	if (node === null) return;
	if (node instanceof YamlScalar) {
		if (node.anchor !== undefined) anchors.set(node.anchor, node);
	} else if (node instanceof YamlMap) {
		if (node.anchor !== undefined) anchors.set(node.anchor, node);
		for (const pair of node.items) {
			collectAnchors(pair.key, anchors);
			collectAnchors(pair.value, anchors);
		}
	} else if (node instanceof YamlSeq) {
		if (node.anchor !== undefined) anchors.set(node.anchor, node);
		for (const item of node.items) {
			collectAnchors(item, anchors);
		}
	}
	// YamlAlias has no anchor field — it references one.
}

/**
 * Extract a plain JavaScript value from a YAML AST node. Delegates to the
 * single implementation on the public node classes (`YamlNode.toValue`),
 * which resolves aliases through the optional anchor map with incremental
 * registration and handles `__proto__` keys as own data properties.
 */
export function getNodeValue(node: YamlNode | null, anchors?: Map<string, YamlNode>): unknown {
	return node === null ? null : node.toValue(anchors);
}
