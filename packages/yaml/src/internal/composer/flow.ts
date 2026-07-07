/**
 * Flow-collection composition: flow mappings, flow sequences, and the
 * flow-children flattening walk. Imports the shared pair-building machinery
 * from `block.ts`; block composition reaches these composers through
 * `state.flow` so the import stays one-directional (flow → block).
 */

import type { CollectionStyle, ScalarStyle, YamlNode, YamlPair } from "../../YamlNode.js";
import { YamlMap, YamlScalar, YamlSeq } from "../../YamlNode.js";
import type { CstNode } from "../cst.js";
import { checkAnchorOnAlias, getAnchorName, makeAlias, registerAnchor } from "./anchors.js";
import type { SemanticItem } from "./block.js";
import { buildPairs, checkDuplicateKeys, checkMultilineImplicitKeys } from "./block.js";
import {
	collectMultilineKey,
	collectMultilinePlainScalar,
	getScalarStyle,
	hasValueSepThroughPlainScalars,
	makeScalar,
	resolveScalar,
} from "./scalars.js";
import type { ComposerState, NodeMeta } from "./state.js";
import { enterNesting, exitNesting, hasMeta } from "./state.js";

/**
 * Validate that flow collection entries are separated by commas.
 *
 * Detects the specific pattern: content, `:`, content, content (no comma).
 * This catches `{foo: 1 bar: 2}` while allowing multiline plain scalars
 * like `{multi\n  line: value}` (consecutive scalars without colon between).
 *
 * State machine: idle → saw-colon → saw-value → error-if-no-comma
 */
function validateFlowSeparators(
	children: readonly CstNode[],
	state: ComposerState,
	openBracket: string,
	closeBracket: string,
): void {
	// Track: after seeing "scalar : scalar", the next scalar without comma is an error
	let colonCount = 0; // number of colons seen since last comma
	let contentAfterColon = 0; // content tokens after the most recent colon

	for (const child of children) {
		if (child.type === "whitespace" && (child.source === openBracket || child.source === closeBracket)) continue;
		if (child.type === "newline") continue;
		if (child.type === "comment") {
			// A comment between content tokens in a flow collection breaks
			// plain scalar continuation — if content follows, it needs a comma.
			if (contentAfterColon > 0) {
				colonCount = 1;
				contentAfterColon = 1;
			}
			continue;
		}
		if (child.type === "whitespace" && child.source.trim() === "") continue;

		if (child.type === "whitespace" && child.source === ",") {
			colonCount = 0;
			contentAfterColon = 0;
			continue;
		}
		if (child.type === "whitespace" && child.source === ":") {
			colonCount++;
			contentAfterColon = 0;
			continue;
		}

		const isContent =
			child.type === "flow-scalar" ||
			child.type === "block-scalar" ||
			child.type === "flow-map" ||
			child.type === "flow-seq" ||
			child.type === "alias";

		if (isContent) {
			contentAfterColon++;
			// Error: we've seen at least one colon, a value after it, and now
			// another content token without a comma. This means something like
			// `key: value nextkey` (missing comma).
			if (colonCount > 0 && contentAfterColon > 1) {
				state.errors.push({
					code: "MalformedFlowCollection",
					message: "Missing comma between flow collection entries",
					offset: child.offset,
					length: child.length,
				});
			}
		}
	}
}

/**
 * 9C9N, VJP3/00: continuation lines of multi-line flow content must be
 * indented past the parent block context. Caller passes the parent block
 * column; for document-root flow content (no parent block) the caller
 * omits it and the check is skipped.
 */
function validateFlowContentIndent(cst: CstNode, state: ComposerState, parentBlockColumn?: number): void {
	if (parentBlockColumn === undefined || parentBlockColumn < 0) return;
	const text = state.text;
	const start = cst.offset;
	const end = cst.offset + cst.length;
	let i = start;
	let inLineStart = false;
	let lineStart = -1;
	while (i < end && i < text.length) {
		const ch = text[i];
		if (ch === "\n") {
			inLineStart = true;
			lineStart = i + 1;
			i++;
			continue;
		}
		if (inLineStart) {
			if (ch === " " || ch === "\t") {
				i++;
				continue;
			}
			const col = i - lineStart;
			if (col <= parentBlockColumn) {
				state.errors.push({
					code: "InvalidIndentation",
					message: "Flow content continuation line must be indented past the parent block",
					offset: i,
					length: 1,
				});
				return;
			}
			inLineStart = false;
		}
		i++;
	}
}

// ---------------------------------------------------------------------------
// Compose flow map
// ---------------------------------------------------------------------------

export function composeFlowMap(
	cst: CstNode,
	state: ComposerState,
	meta?: NodeMeta,
	parentBlockColumn?: number,
): YamlMap {
	// Nesting-depth guard: unbounded recursion is a stack-overflow DoS vector.
	if (!enterNesting(state, cst)) {
		return new YamlMap({ items: [], style: "flow", offset: cst.offset, length: cst.length });
	}
	try {
		return composeFlowMapInner(cst, state, meta, parentBlockColumn);
	} finally {
		exitNesting(state);
	}
}

function composeFlowMapInner(cst: CstNode, state: ComposerState, meta?: NodeMeta, parentBlockColumn?: number): YamlMap {
	const children = cst.children ?? [];
	const pairs: YamlPair[] = [];

	// Validate bracket balance
	const hasOpen = children.some((c) => c.type === "whitespace" && c.source === "{");
	const hasClose = children.some((c) => c.type === "whitespace" && c.source === "}");
	if (hasOpen && !hasClose) {
		state.errors.push({
			code: "MalformedFlowCollection",
			message: "Unclosed flow mapping (missing `}`)",
			offset: cst.offset,
			length: cst.length,
		});
	}

	// 9C9N, VJP3/00: continuation lines of multi-line flow content must be
	// indented past the parent block context.
	validateFlowContentIndent(cst, state, parentBlockColumn);

	// Validate that flow mapping entries are separated by commas.
	// Between consecutive content tokens (scalars, nested collections),
	// there must be a comma separator unless one is a value indicator (:).
	validateFlowSeparators(children, state, "{", "}");

	// Filter out brackets and blank whitespace, but KEEP commas and newlines
	// so that flattenFlowChildren can respect segment boundaries for multi-line keys.
	const content = children.filter(
		(c) => !(c.type === "whitespace" && (c.source === "{" || c.source === "}" || c.source.trim() === "")),
	);

	const items = flattenFlowChildren(content, state);
	buildPairs(items, pairs, state.text);

	if (state.options.uniqueKeys) checkDuplicateKeys(pairs, state);

	const map = new YamlMap({
		items: pairs,
		style: "flow" as CollectionStyle,
		offset: cst.offset,
		length: cst.length,
		...(meta?.tag !== undefined ? { tag: meta.tag } : {}),
		...(meta?.anchor !== undefined ? { anchor: meta.anchor } : {}),
		...(meta?.comment !== undefined ? { comment: meta.comment } : {}),
	});

	if (meta?.anchor) registerAnchor(map, meta.anchor, state, cst.offset);
	return map;
}

export function flattenFlowChildren(children: readonly CstNode[], state: ComposerState): SemanticItem[] {
	const items: SemanticItem[] = [];
	let pendingMeta: NodeMeta = {};

	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (!child) continue;
		if (child.type === "newline") continue;
		if (child.type === "whitespace") {
			// Comma separates flow-map / flow-seq items. If a tag/anchor is
			// pending here (e.g. `foo: !!str, !!str: bar` — the trailing
			// `!!str` belongs to the value of `foo`), flush it as an empty
			// scalar so it doesn't bleed into the next item.
			if (child.source === ",") {
				if (hasMeta(pendingMeta)) {
					const value = resolveScalar("", "plain", pendingMeta.tag, state);
					const scalar = new YamlScalar({
						value,
						style: "plain" as ScalarStyle,
						offset: child.offset,
						length: 0,
						...(pendingMeta.tag !== undefined ? { tag: pendingMeta.tag } : {}),
						...(pendingMeta.anchor !== undefined ? { anchor: pendingMeta.anchor } : {}),
					});
					if (pendingMeta.anchor) registerAnchor(scalar, pendingMeta.anchor, state, child.offset);
					pendingMeta = {};
					items.push({ kind: "node", node: scalar });
				}
				continue;
			}
			if (child.source === ":") {
				// Flush pending tag/anchor as empty scalar before value-sep
				if (hasMeta(pendingMeta)) {
					const value = resolveScalar("", "plain", pendingMeta.tag, state);
					const scalar = new YamlScalar({
						value,
						style: "plain" as ScalarStyle,
						offset: child.offset,
						length: 0,
						...(pendingMeta.tag !== undefined ? { tag: pendingMeta.tag } : {}),
						...(pendingMeta.anchor !== undefined ? { anchor: pendingMeta.anchor } : {}),
					});
					if (pendingMeta.anchor) registerAnchor(scalar, pendingMeta.anchor, state, child.offset);
					pendingMeta = {};
					items.push({ kind: "node", node: scalar });
				}
				items.push({ kind: "value-sep", offset: child.offset });
			}
			if (child.source === "?") {
				// Explicit key indicator in flow context (YAML 1.2 §7.4).
				// The ? marks the next content as an explicit key. If ? is
				// followed by nothing before , or }, it creates a null key.
				// We emit a "key" marker; buildPairs handles the pairing.
				items.push({ kind: "key" });
			}
			continue;
		}
		if (child.type === "comment") {
			items.push({
				kind: "comment",
				comment: child.source.startsWith("#") ? child.source.slice(1).trim() : child.source,
			});
			continue;
		}
		if (child.type === "error") {
			state.errors.push({
				code: "UnexpectedToken",
				message: `Unexpected content: ${child.source.trim() || "(empty)"}`,
				offset: child.offset,
				length: child.length,
			});
			continue;
		}
		if (child.type === "anchor") {
			pendingMeta.anchor = getAnchorName(child, state.text);
			continue;
		}
		if (child.type === "tag") {
			pendingMeta.tag = child.source;
			continue;
		}
		if (child.type === "flow-scalar" || child.type === "block-scalar") {
			// Check for # without preceding space — YAML 1.2 §6.6 requires
			// whitespace before # for it to be a comment indicator. When # appears
			// as a plain scalar immediately after , or ] or }, it means # wasn't
			// preceded by whitespace.
			if (
				child.type === "flow-scalar" &&
				getScalarStyle(child) === "plain" &&
				child.source.startsWith("#") &&
				child.offset > 0
			) {
				const prev = state.text[child.offset - 1];
				if (prev !== " " && prev !== "\t" && prev !== "\n" && prev !== "\r") {
					state.errors.push({
						code: "UnexpectedToken",
						message: "Comment must be preceded by whitespace",
						offset: child.offset,
						length: child.length,
					});
				}
			}
			// Validate: plain `-` or `?` alone in flow context is invalid.
			// These are block indicators that cannot be plain scalars in flow
			// context unless followed by a non-space safe character (§7.3.3).
			if (
				child.type === "flow-scalar" &&
				getScalarStyle(child) === "plain" &&
				(child.source === "-" || child.source === "?")
			) {
				state.errors.push({
					code: "UnexpectedToken",
					message: `Invalid plain scalar '${child.source}' in flow context`,
					offset: child.offset,
					length: child.length,
				});
			}
			if (child.type === "flow-scalar" && getScalarStyle(child) === "plain") {
				if (hasValueSepThroughPlainScalars(children, i + 1)) {
					// Plain scalar eventually followed by ":" (possibly through
					// continuation plain scalars) — merge as multi-line key
					const { value, nextIdx } = collectMultilineKey(children, i);
					const resolved = resolveScalar(value, "plain", pendingMeta.tag, state);
					const scalar = new YamlScalar({
						value: resolved,
						style: "plain" as ScalarStyle,
						offset: child.offset,
						length: child.length,
						...(pendingMeta.tag !== undefined ? { tag: pendingMeta.tag } : {}),
						...(pendingMeta.anchor !== undefined ? { anchor: pendingMeta.anchor } : {}),
					});
					if (pendingMeta.anchor) registerAnchor(scalar, pendingMeta.anchor, state, child.offset);
					pendingMeta = {};
					items.push({ kind: "node", node: scalar });
					i = nextIdx - 1;
					continue;
				}
				// Not followed by ":" — try multi-line value merging
				const { value, nextIdx } = collectMultilinePlainScalar(children, i, undefined, state.text);
				const resolved = resolveScalar(value, "plain", pendingMeta.tag, state);
				const scalar = new YamlScalar({
					value: resolved,
					style: "plain" as ScalarStyle,
					offset: child.offset,
					length: child.length,
					...(pendingMeta.tag !== undefined ? { tag: pendingMeta.tag } : {}),
					...(pendingMeta.anchor !== undefined ? { anchor: pendingMeta.anchor } : {}),
				});
				if (pendingMeta.anchor) registerAnchor(scalar, pendingMeta.anchor, state, child.offset);
				pendingMeta = {};
				items.push({ kind: "node", node: scalar });
				i = nextIdx - 1;
				continue;
			}
			const scalar = makeScalar(child, state, hasMeta(pendingMeta) ? pendingMeta : undefined);
			pendingMeta = {};
			items.push({ kind: "node", node: scalar });
			continue;
		}
		if (child.type === "alias") {
			checkAnchorOnAlias(pendingMeta, child, state);
			const alias = makeAlias(child, state);
			pendingMeta = {};
			items.push({ kind: "node", node: alias });
			continue;
		}
		if (child.type === "flow-map") {
			const map = composeFlowMap(child, state, hasMeta(pendingMeta) ? pendingMeta : undefined);
			pendingMeta = {};
			items.push({ kind: "node", node: map });
			continue;
		}
		if (child.type === "flow-seq") {
			const seq = composeFlowSeq(child, state, hasMeta(pendingMeta) ? pendingMeta : undefined);
			pendingMeta = {};
			items.push({ kind: "node", node: seq });
		}
	}
	// Flush trailing pending tag/anchor as empty scalar (e.g., !!str at end of flow)
	if (hasMeta(pendingMeta)) {
		const value = resolveScalar("", "plain", pendingMeta.tag, state);
		const scalar = new YamlScalar({
			value,
			style: "plain" as ScalarStyle,
			offset: 0,
			length: 0,
			...(pendingMeta.tag !== undefined ? { tag: pendingMeta.tag } : {}),
			...(pendingMeta.anchor !== undefined ? { anchor: pendingMeta.anchor } : {}),
		});
		if (pendingMeta.anchor) registerAnchor(scalar, pendingMeta.anchor, state, 0);
		items.push({ kind: "node", node: scalar });
	}
	return items;
}

// ---------------------------------------------------------------------------
// Compose flow seq
// ---------------------------------------------------------------------------

export function composeFlowSeq(
	cst: CstNode,
	state: ComposerState,
	meta?: NodeMeta,
	parentBlockColumn?: number,
): YamlSeq {
	// Nesting-depth guard: unbounded recursion is a stack-overflow DoS vector.
	if (!enterNesting(state, cst)) {
		return new YamlSeq({ items: [], style: "flow", offset: cst.offset, length: cst.length });
	}
	try {
		return composeFlowSeqInner(cst, state, meta, parentBlockColumn);
	} finally {
		exitNesting(state);
	}
}

function composeFlowSeqInner(cst: CstNode, state: ComposerState, meta?: NodeMeta, parentBlockColumn?: number): YamlSeq {
	const children = cst.children ?? [];
	const items: YamlNode[] = [];

	// 9C9N, VJP3/00: continuation lines of multi-line flow content must be
	// indented past the parent block context.
	validateFlowContentIndent(cst, state, parentBlockColumn);

	// Validate flow separators (commas between entries)
	validateFlowSeparators(children, state, "[", "]");

	// Validate bracket balance: check that the flow sequence has matching brackets.
	const hasOpen = children.some((c) => c.type === "whitespace" && c.source === "[");
	const hasClose = children.some((c) => c.type === "whitespace" && c.source === "]");
	if (hasOpen && !hasClose) {
		state.errors.push({
			code: "MalformedFlowCollection",
			message: "Unclosed flow sequence (missing `]`)",
			offset: cst.offset,
			length: cst.length,
		});
	}

	// Split children into comma-delimited segments, filtering out brackets.
	// Each segment is processed independently: if it contains a ":" value
	// separator, it's an implicit single-pair mapping (YAML 1.2 §7.4);
	// otherwise each node in the segment is a plain sequence entry.
	const segments: CstNode[][] = [];
	let current: CstNode[] = [];

	let seenContent = false;
	let lastWasComma = false;

	for (const child of children) {
		// Skip brackets
		if (child.type === "whitespace" && (child.source === "[" || child.source === "]")) continue;
		// Split on commas
		if (child.type === "whitespace" && child.source === ",") {
			// Detect leading comma or consecutive commas (empty flow entry)
			const hasContentInSegment = current.some(
				(c) => c.type !== "whitespace" && c.type !== "newline" && c.type !== "comment",
			);
			if (!hasContentInSegment && (lastWasComma || !seenContent)) {
				state.errors.push({
					code: "MalformedFlowCollection",
					message: "Empty entry in flow sequence",
					offset: child.offset,
					length: 1,
				});
			}
			if (current.length > 0) segments.push(current);
			current = [];
			lastWasComma = true;
			continue;
		}
		if (child.type !== "whitespace" && child.type !== "newline" && child.type !== "comment") {
			seenContent = true;
			lastWasComma = false;
		}
		current.push(child);
	}
	if (current.length > 0) segments.push(current);

	for (const segment of segments) {
		// Check if this segment contains a value separator (implicit mapping)
		const hasValueSep = segment.some((c) => c.type === "whitespace" && c.source === ":");

		if (hasValueSep) {
			// Process as a single-pair implicit mapping
			// Keep newlines so flattenFlowChildren can merge multi-line plain scalars
			const content = segment.filter((c) => !(c.type === "whitespace" && c.source.trim() === ""));
			const semItems = flattenFlowChildren(content, state);
			const pairs: YamlPair[] = [];
			buildPairs(semItems, pairs, state.text);
			// Only check multiline keys for implicit mappings (no `?` marker).
			// Explicit keys (with `?`) are allowed to span multiple lines.
			const hasExplicitKey = segment.some((c) => c.type === "whitespace" && c.source === "?");
			if (!hasExplicitKey) {
				checkMultilineImplicitKeys(pairs, state, semItems);
			}
			const firstPair = pairs[0];
			if (firstPair) {
				const map = new YamlMap({
					items: pairs,
					style: "flow" as CollectionStyle,
					offset: firstPair.key.offset,
					length: 0,
				});
				items.push(map);
			}
		} else {
			// Process as plain sequence items
			// Keep newlines so flattenFlowChildren can merge multi-line plain scalars
			const content = segment.filter((c) => !(c.type === "whitespace" && c.source.trim() === ""));
			const semItems = flattenFlowChildren(content, state);
			for (const si of semItems) {
				if (si.kind === "node" && si.node) {
					items.push(si.node);
				}
			}
		}
	}

	const seq = new YamlSeq({
		items,
		style: "flow" as CollectionStyle,
		offset: cst.offset,
		length: cst.length,
		...(meta?.tag !== undefined ? { tag: meta.tag } : {}),
		...(meta?.anchor !== undefined ? { anchor: meta.anchor } : {}),
		...(meta?.comment !== undefined ? { comment: meta.comment } : {}),
	});

	if (meta?.anchor) registerAnchor(seq, meta.anchor, state, cst.offset);
	return seq;
}
