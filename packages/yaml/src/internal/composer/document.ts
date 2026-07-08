// Document-level composition: the per-CST-document compose walk, directive
// validation (per-document and cross-document), the sourceMultiline
// decoration post-pass, and the two engine entry points the facade and the
// compliance harness drive (`composeFirstDocument`, `composeAllDocuments`).
//
// This module wires the flow-composer dispatch into state (see `state.ts`)
// — it is the only composer module that imports both `block.ts` and
// `flow.ts`, and nothing in the engine imports it back.

import type { YamlNode } from "../../YamlNode.js";
import { YamlAlias, YamlMap, YamlPair, YamlScalar, YamlSeq } from "../../YamlNode.js";
import type { CstNode } from "../cst.js";
import { parseCSTAll } from "../cst-parser.js";
import type { RawDiagnostic } from "../diagnostics.js";
import type { ParseOptionsInput } from "../options.js";
import type { RawDirective, RawYamlDocument } from "../raw-document.js";
import { checkAnchorOnAlias, getAnchorName, makeAlias, registerAnchor } from "./anchors.js";
import { composeBlockMap, composeBlockSeq, composeFlatBlockMap } from "./block.js";
import { composeFlowMap, composeFlowSeq } from "./flow.js";
import {
	collectMultilinePlainScalar,
	findNextContentChild,
	getScalarStyle,
	hasBlockMapAfterInList,
	hasValueSepAfter,
	indexOfChild,
	makeScalar,
	resolveScalar,
} from "./scalars.js";
import type { ComposerState, FlowComposers, NodeMeta } from "./state.js";
import { clearMeta, createState, hasMeta, sameLine } from "./state.js";
import { parseDirective, validateTagHandlesInDocument } from "./tags.js";

/** The flow-composer dispatch wired into every state this module creates. */
const FLOW: FlowComposers = { composeFlowMap, composeFlowSeq };

// ---------------------------------------------------------------------------
// Document-level validation helpers
// ---------------------------------------------------------------------------

/**
 * SY6V: at document level, an anchor or tag must not be followed by a
 * block-sequence entry indicator "-" on the same line. The anchor/tag
 * applies to the next node, but a "-" on the same line means the parser
 * is interpreting it as a sequence start without proper structure.
 */
function validateAnchorTagNotFollowedBySeqDashOnSameLine(
	meta: CstNode,
	children: readonly CstNode[],
	idx: number,
	state: ComposerState,
): void {
	for (let j = idx + 1; j < children.length; j++) {
		const c = children[j];
		if (!c) continue;
		if (c.type === "newline") return; // ok — anchor on its own line
		if (c.type === "whitespace") {
			// Structural indicators ("-", ":", "?", "---", "...") are typed as
			// `whitespace` CST nodes at the document/block level — see also
			// `checkDocumentMarkerSameLine` which tests the same shape for
			// `---`/`...`. We're looking for a "-" on the same line as the meta.
			if (c.source === "-" && sameLine(state.text, meta.offset, c.offset)) {
				state.errors.push({
					code: "UnexpectedToken",
					message: "Block sequence entry indicator '-' cannot follow an anchor or tag on the same line",
					offset: c.offset,
					length: c.length,
				});
				return;
			}
			continue;
		}
		// Empty placeholder block-seq with length 0 — keep scanning past it.
		if (c.type === "block-seq" && c.length === 0) continue;
		return;
	}
}

/**
 * Validate that document markers (--- and ...) are not followed by content
 * on the same line. YAML 1.2 §9.1.4/§9.2 require these markers to be on
 * their own line (followed only by whitespace/comments).
 *
 * Checks within a single document's children AND across document boundaries
 * (e.g. `... invalid` where `...` ends doc 1 and `invalid` starts doc 2).
 */
function checkDocumentMarkerSameLine(
	children: readonly CstNode[],
	state: ComposerState,
	nextDocChildren?: readonly CstNode[],
): void {
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (!child) continue;
		// Document markers appear as "whitespace"-typed CST nodes with source "---" or "..."
		if (child.type !== "whitespace") continue;
		const src = child.source;
		// Only check "..." — "---" CAN be followed by content on the same line
		if (src !== "...") continue;

		// Find next non-whitespace, non-newline sibling in same document
		let found = false;
		for (let j = i + 1; j < children.length; j++) {
			const next = children[j];
			if (!next) continue;
			if (next.type === "newline") break;
			if (next.type === "whitespace" && next.source.trim() === "") continue;
			if (next.type === "comment") break; // comments are allowed after ...
			// Non-trivial content found — check if it's on the same line
			if (sameLine(state.text, child.offset, next.offset)) {
				state.errors.push({
					code: "UnexpectedToken",
					message: "Content on same line as document-end marker",
					offset: next.offset,
					length: next.length,
				});
			}
			found = true;
			break;
		}

		// For "..." at end of document, check first content of next document
		if (!found && nextDocChildren) {
			for (const next of nextDocChildren) {
				if (!next) continue;
				if (next.type === "newline") break;
				if (next.type === "whitespace" && next.source.trim() === "") continue;
				if (sameLine(state.text, child.offset, next.offset)) {
					state.errors.push({
						code: "UnexpectedToken",
						message: "Content on same line as document-end marker",
						offset: next.offset,
						length: next.length,
					});
				}
				break;
			}
		}
	}
}

/**
 * Check for trailing content after a complete value at document level.
 * After a flow collection or scalar at the top level, only trivia and
 * document markers should follow. Skips if next meaningful content is ":"
 * (the flow collection is being used as a mapping key).
 */
function checkTrailingContentAfterDocValue(
	children: readonly CstNode[],
	startIdx: number,
	state: ComposerState,
	allowMappingKey = true,
): void {
	for (let j = startIdx; j < children.length; j++) {
		const next = children[j];
		if (!next) continue;
		if (next.type === "newline" || next.type === "comment") continue;
		if (next.type === "whitespace") {
			// Document markers (---, ...) are OK
			if (next.source === "---" || next.source === "...") break;
			// ":" means this value is a mapping key — not trailing content
			if (next.source === ":") break;
			if (next.source.trim() === "") continue;
		}
		// Non-trivial content after a complete document value.
		// If allowed, check if this content looks like a mapping key (followed by
		// ":" or a block-map) — it's a sibling mapping pair, not trailing content.
		if (
			allowMappingKey &&
			(next.type === "flow-scalar" ||
				next.type === "block-scalar" ||
				next.type === "flow-map" ||
				next.type === "flow-seq")
		) {
			const afterNode = findNextContentChild(children, j + 1);
			if (hasValueSepAfter(children, j + 1) || (afterNode !== null && afterNode.type === "block-map")) {
				break;
			}
		}
		if (
			next.type === "flow-scalar" ||
			next.type === "block-scalar" ||
			next.type === "block-map" ||
			next.type === "block-seq" ||
			next.type === "flow-map" ||
			next.type === "flow-seq" ||
			next.type === "anchor" ||
			next.type === "tag" ||
			next.type === "alias"
		) {
			state.errors.push({
				code: "UnexpectedToken",
				message: "Trailing content after document value",
				offset: next.offset,
				length: next.length,
			});
		}
		break;
	}
}

// ---------------------------------------------------------------------------
// Compose document
// ---------------------------------------------------------------------------

export function composeDocument(
	cst: CstNode,
	state: ComposerState,
	hasSubsequentDocuments = false,
	nextDocCst?: CstNode,
): RawYamlDocument {
	// Hardening: unescaped C0 control characters (other than tab/LF/CR) are
	// not c-printable (YAML 1.2 §5.1) and are invalid anywhere in the stream.
	// Escaped forms in double-quoted scalars never appear raw in the source,
	// so scanning the document's raw span is sufficient.
	const spanEnd = Math.min(cst.offset + cst.length, state.text.length);
	for (let ci = cst.offset; ci < spanEnd; ci++) {
		const cc = state.text.charCodeAt(ci);
		if (cc < 0x20 && cc !== 0x09 && cc !== 0x0a && cc !== 0x0d) {
			state.errors.push({
				code: "UnexpectedCharacter",
				message: `Unescaped control character U+${cc.toString(16).toUpperCase().padStart(4, "0")}`,
				offset: ci,
				length: 1,
			});
			break;
		}
	}

	const children = cst.children ?? [];
	const directives: RawDirective[] = [];
	let contents: YamlNode | null = null;
	let documentComment: string | undefined;

	// Whether this document has a `---` marker — used to determine if
	// metadata (tag/anchor) applies to the root mapping or the first key.
	const hasDocStart = children.some((c) => c.type === "whitespace" && c.source === "---");

	let i = 0;
	const meta: NodeMeta = {};
	// Track meta carried across a newline. When the doc-level processor sees
	// `&a !!t1\n&b !!t2 key: ...`, the first meta belongs to the outer container
	// (root map) and the second to the inner first key. Without this split, the
	// later meta would silently overwrite the earlier one.
	const outerMeta: NodeMeta = {};
	let sawNewlineSinceMeta = false;
	const commitMetaAcrossNewline = () => {
		if (sawNewlineSinceMeta && hasMeta(meta)) {
			if (meta.tag !== undefined) outerMeta.tag = meta.tag;
			if (meta.anchor !== undefined) outerMeta.anchor = meta.anchor;
			if (meta.comment !== undefined) outerMeta.comment = meta.comment;
			clearMeta(meta);
		}
		sawNewlineSinceMeta = false;
	};

	while (i < children.length) {
		const child = children[i];
		if (!child) {
			i++;
			continue;
		}

		// Directives
		if (child.type === "directive") {
			const directive = parseDirective(child.source);
			if (directive) {
				directives.push(directive);
				// Populate tag map from %TAG directives
				if (directive.name === "TAG" && directive.parameters.length >= 2) {
					const handle = directive.parameters[0];
					const prefix = directive.parameters[1];
					if (handle && prefix) {
						state.tagMap.set(handle, prefix);
					}
				}
			}
			i++;
			continue;
		}

		// Trivia
		if (child.type === "newline" && hasMeta(meta)) {
			sawNewlineSinceMeta = true;
		}
		if (child.type === "whitespace" || child.type === "newline") {
			// Detect stray flow-closing brackets at document level
			if (child.type === "whitespace" && (child.source === "]" || child.source === "}")) {
				state.errors.push({
					code: "MalformedFlowCollection",
					message: `Unexpected flow indicator '${child.source}' at document level`,
					offset: child.offset,
					length: child.length,
				});
			}
			i++;
			continue;
		}

		// Comments (before content)
		if (child.type === "comment" && contents === null) {
			documentComment = child.source.startsWith("#") ? child.source.slice(1).trim() : child.source;
			i++;
			continue;
		}

		// Error nodes from the lexer/parser (e.g. tab indentation)
		if (child.type === "error") {
			state.errors.push({
				code: "UnexpectedToken",
				message: `Unexpected content: ${child.source.trim() || "(empty)"}`,
				offset: child.offset,
				length: child.length,
			});
			i++;
			continue;
		}

		// Anchor/tag metadata. When a newline preceded the new meta and meta was
		// already set, the existing meta belongs to the outer container.
		if (child.type === "anchor") {
			// SY6V: anchor followed by a block-seq entry indicator "-" on the
			// SAME line is invalid. Anchors must be followed by a node, not a
			// new block-seq indicator on the same line.
			validateAnchorTagNotFollowedBySeqDashOnSameLine(child, children, i, state);
			commitMetaAcrossNewline();
			meta.anchor = getAnchorName(child, state.text);
			i++;
			continue;
		}
		if (child.type === "tag") {
			validateAnchorTagNotFollowedBySeqDashOnSameLine(child, children, i, state);
			commitMetaAcrossNewline();
			meta.tag = child.source;
			i++;
			continue;
		}

		if (child.type === "flow-scalar" || child.type === "block-scalar") {
			// Check if next meaningful child is a block-map (this scalar is a key)
			const nextContent = findNextContentChild(children, i + 1);
			if (nextContent && nextContent.type === "block-map") {
				// A mapping cannot start on the `---` line. The `---` directive end
				// is followed by a single value (or anchor+value), but a mapping
				// pattern (key:) on the same line as `---` is malformed (9KBC, CXX2).
				if (hasDocStart) {
					const docStartChild = children.find((c) => c.type === "whitespace" && c.source === "---");
					if (docStartChild && sameLine(state.text, docStartChild.offset, child.offset)) {
						state.errors.push({
							code: "UnexpectedToken",
							message: "Mapping cannot start on document-start (---) line",
							offset: child.offset,
							length: child.length,
						});
					}
				}
				// Resolve which meta attaches to the root map vs. the first key.
				// - If outer meta exists (collected across a newline), it belongs to
				//   the map. The current `meta` belongs to the key.
				// - Otherwise, with `hasDocStart`, the current meta is map-level
				//   (preserves prior behavior — no key-level metadata possible).
				// - Otherwise, the current meta belongs to the key.
				let mapMeta: NodeMeta | undefined;
				let keyMeta: NodeMeta | undefined;
				if (hasMeta(outerMeta)) {
					mapMeta = { ...outerMeta };
					keyMeta = hasMeta(meta) ? { ...meta } : undefined;
				} else if (hasDocStart && hasMeta(meta)) {
					mapMeta = { ...meta };
					keyMeta = undefined;
				} else {
					keyMeta = hasMeta(meta) ? { ...meta } : undefined;
				}
				const key = makeScalar(child, state, keyMeta);
				clearMeta(meta);
				clearMeta(outerMeta);
				sawNewlineSinceMeta = false;
				contents = composeBlockMap(nextContent, state, key, mapMeta);
				i = indexOfChild(children, nextContent) + 1;
				continue;
			}
			// Check if followed by ":" (value-sep) — flat mapping without block-map wrapper
			if (hasValueSepAfter(children, i + 1)) {
				let mapMeta: NodeMeta | undefined;
				let keyMeta: NodeMeta | undefined;
				if (hasMeta(outerMeta)) {
					mapMeta = { ...outerMeta };
					keyMeta = hasMeta(meta) ? { ...meta } : undefined;
				} else if (hasDocStart && hasMeta(meta)) {
					mapMeta = { ...meta };
					keyMeta = undefined;
				} else {
					keyMeta = hasMeta(meta) ? { ...meta } : undefined;
				}
				const key = makeScalar(child, state, keyMeta);
				clearMeta(meta);
				clearMeta(outerMeta);
				sawNewlineSinceMeta = false;
				contents = composeFlatBlockMap(children, i + 1, cst, state, key, mapMeta);
				break; // consumed all remaining children
			}
			// Standalone scalar — try multi-line plain scalar merging
			if (child.type === "flow-scalar" && getScalarStyle(child) === "plain") {
				const { value, nextIdx, partsCount } = collectMultilinePlainScalar(children, i, undefined, state.text);
				// Combine outer + inner meta — for a scalar root, both apply to it.
				const combined: NodeMeta = { ...outerMeta };
				if (meta.tag !== undefined) combined.tag = meta.tag;
				if (meta.anchor !== undefined) combined.anchor = meta.anchor;
				const resolved = resolveScalar(value, "plain", combined.tag, state);
				// Span the full source range when multi-line plain folding merged
				// multiple children. `nextIdx` is the index after the last
				// consumed child; walk back to find the last child with a
				// non-trivial offset (skip newline/whitespace) and extend the
				// span to its end. Includes directives and other non-scalar
				// continuations the lexer mis-tokenised on a folded line.
				let scalarLength = child.length;
				if (partsCount > 1) {
					for (let li = nextIdx - 1; li > i; li--) {
						const last = children[li];
						if (!last) continue;
						if (last.type === "newline") continue;
						if (last.type === "whitespace" && last.source.trim() === "") continue;
						scalarLength = last.offset + last.length - child.offset;
						break;
					}
				}
				contents = new YamlScalar({
					value: resolved,
					style: "plain",
					offset: child.offset,
					length: scalarLength,
					...(combined.tag !== undefined ? { tag: combined.tag } : {}),
					...(combined.anchor !== undefined ? { anchor: combined.anchor } : {}),
				});
				if (combined.anchor) registerAnchor(contents, combined.anchor, state, child.offset);
				clearMeta(meta);
				clearMeta(outerMeta);
				sawNewlineSinceMeta = false;
				// If the multiline scalar merged multiple parts and the remaining
				// content forms a mapping, that mapping is trailing garbage (2CMS).
				if (partsCount > 1) {
					const nextContent2 = findNextContentChild(children, nextIdx);
					if (nextContent2) {
						const isTrailing =
							(nextContent2.type === "flow-scalar" &&
								hasValueSepAfter(children, indexOfChild(children, nextContent2) + 1)) ||
							nextContent2.type === "block-map" ||
							// Also catch: flow-scalar followed by a block-map sibling
							// (the scalar+block-map pattern that forms an implicit mapping).
							// Without this, 2CMS slips through after `hasBlockMapAfterInList`
							// stops the merge before reaching the trailing scalar.
							(nextContent2.type === "flow-scalar" &&
								hasBlockMapAfterInList(children, indexOfChild(children, nextContent2) + 1));
						if (isTrailing) {
							state.errors.push({
								code: "UnexpectedToken",
								message: "Trailing content after document value",
								offset: nextContent2.offset,
								length: nextContent2.length,
							});
						}
					}
				} else {
					// BS4K: a single-line plain scalar followed by another plain
					// scalar (with a comment in between, breaking multi-line merge)
					// is invalid trailing content.
					checkTrailingContentAfterDocValue(children, nextIdx, state, false);
				}
				i = nextIdx;
				continue;
			}
			// Combine outer + inner meta for scalar root.
			const combined: NodeMeta = { ...outerMeta };
			if (meta.tag !== undefined) combined.tag = meta.tag;
			if (meta.anchor !== undefined) combined.anchor = meta.anchor;
			contents = makeScalar(child, state, hasMeta(combined) ? combined : undefined);
			clearMeta(meta);
			clearMeta(outerMeta);
			sawNewlineSinceMeta = false;
			i++;
			continue;
		}

		if (child.type === "block-map") {
			// Outer meta belongs to the map; remaining `meta` would belong to the
			// first key inside, but block-map's own children carry that context.
			const combined: NodeMeta = { ...outerMeta };
			if (meta.tag !== undefined) combined.tag = meta.tag;
			if (meta.anchor !== undefined) combined.anchor = meta.anchor;
			contents = composeBlockMap(child, state, undefined, hasMeta(combined) ? combined : undefined);
			clearMeta(meta);
			clearMeta(outerMeta);
			sawNewlineSinceMeta = false;
			i++;
			continue;
		}

		if (child.type === "block-seq") {
			const isRootSeq = contents === null;
			const combined: NodeMeta = { ...outerMeta };
			if (meta.tag !== undefined) combined.tag = meta.tag;
			if (meta.anchor !== undefined) combined.anchor = meta.anchor;
			contents = composeBlockSeq(child, state, hasMeta(combined) ? combined : undefined);
			clearMeta(meta);
			clearMeta(outerMeta);
			sawNewlineSinceMeta = false;
			i++;
			// Only check for trailing content when the block-seq is the root document
			// value (BD7L, TD5N). When it's a value inside a mapping (57H4), the
			// remaining children are sibling mapping pairs.
			if (isRootSeq) {
				checkTrailingContentAfterDocValue(children, i, state, false);
			}
			continue;
		}

		if (child.type === "flow-map") {
			const nextAfterFlowMap0 = findNextContentChild(children, i + 1);
			const flowIsKey = !!nextAfterFlowMap0 && nextAfterFlowMap0.type === "block-map";
			let flowMeta: NodeMeta | undefined;
			let mapMeta: NodeMeta | undefined;
			if (flowIsKey && hasMeta(outerMeta)) {
				mapMeta = { ...outerMeta };
				flowMeta = hasMeta(meta) ? { ...meta } : undefined;
			} else {
				const combined: NodeMeta = { ...outerMeta };
				if (meta.tag !== undefined) combined.tag = meta.tag;
				if (meta.anchor !== undefined) combined.anchor = meta.anchor;
				flowMeta = hasMeta(combined) ? combined : undefined;
			}
			const flowMap = composeFlowMap(child, state, flowMeta);
			clearMeta(meta);
			clearMeta(outerMeta);
			sawNewlineSinceMeta = false;
			i++;
			if (flowIsKey && nextAfterFlowMap0) {
				const map = composeBlockMap(nextAfterFlowMap0, state, flowMap, mapMeta);
				contents = map;
				while (i < children.length && children[i] !== nextAfterFlowMap0) i++;
				i++;
			} else {
				contents = flowMap;
				checkTrailingContentAfterDocValue(children, i, state);
			}
			continue;
		}

		if (child.type === "flow-seq") {
			const nextAfterFlowSeq0 = findNextContentChild(children, i + 1);
			const flowIsKey = !!nextAfterFlowSeq0 && nextAfterFlowSeq0.type === "block-map";
			let flowMeta: NodeMeta | undefined;
			let mapMeta: NodeMeta | undefined;
			if (flowIsKey && hasMeta(outerMeta)) {
				mapMeta = { ...outerMeta };
				flowMeta = hasMeta(meta) ? { ...meta } : undefined;
			} else {
				const combined: NodeMeta = { ...outerMeta };
				if (meta.tag !== undefined) combined.tag = meta.tag;
				if (meta.anchor !== undefined) combined.anchor = meta.anchor;
				flowMeta = hasMeta(combined) ? combined : undefined;
			}
			const flowSeq = composeFlowSeq(child, state, flowMeta);
			clearMeta(meta);
			clearMeta(outerMeta);
			sawNewlineSinceMeta = false;
			i++;
			// Check if flow collection is a mapping key (followed by block-map with ":")
			const nextAfterFlowSeq = findNextContentChild(children, i);
			if (nextAfterFlowSeq && nextAfterFlowSeq.type === "block-map") {
				// Flow seq is a key — compose the block-map with this as the first key
				const map = composeBlockMap(nextAfterFlowSeq, state, flowSeq, mapMeta);
				contents = map;
				// Skip past the block-map node
				while (i < children.length && children[i] !== nextAfterFlowSeq) i++;
				i++;
			} else {
				contents = flowSeq;
				checkTrailingContentAfterDocValue(children, i, state);
			}
			continue;
		}

		if (child.type === "alias") {
			checkAnchorOnAlias(meta, child, state);
			contents = makeAlias(child, state);
			i++;
			continue;
		}

		i++;
	}

	// Validate directive rules
	validateDirectives(directives, cst, state, hasSubsequentDocuments);

	// Validate document marker same-line content
	checkDocumentMarkerSameLine(children, state, nextDocCst?.children);

	// Detect whether `...` document end marker was present in the CST
	const hasDocEnd = children.some((c) => c.type === "whitespace" && c.source === "...");

	// Detect whether `---` was followed by a tab (K54U). Scan children for the
	// document-start marker; if the immediately-following character in the
	// source is a tab, set the flag so the stringifier can emit `...` for
	// libyaml-compatible canonical output.
	let hasDocStartTab = false;
	for (let ci = 0; ci < children.length; ci++) {
		const c = children[ci];
		if (c && c.type === "whitespace" && c.source === "---") {
			const after = state.text[c.offset + c.length];
			if (after === "\t") hasDocStartTab = true;
			break;
		}
	}

	return {
		contents,
		errors: [...state.errors],
		warnings: [...state.warnings],
		directives,
		hasDocumentStart: hasDocStart,
		hasDocumentEnd: hasDocEnd,
		hasDocumentStartTab: hasDocStartTab,
		...(documentComment !== undefined ? { comment: documentComment } : {}),
	};
}

// ---------------------------------------------------------------------------
// Directive validation
// ---------------------------------------------------------------------------

/**
 * Validate YAML directive rules within a single document's CST.
 * Pushes errors into state.errors for any violations found.
 */
function validateDirectives(
	directives: RawDirective[],
	cst: CstNode,
	state: ComposerState,
	hasSubsequentDocuments = false,
): void {
	const children = cst.children ?? [];

	// Check for duplicate %YAML directives
	const yamlDirectives = directives.filter((d) => d.name === "YAML");
	if (yamlDirectives.length > 1) {
		// Find the second directive's offset in the CST
		let directiveCount = 0;
		for (const child of children) {
			if (child.type === "directive" && child.source.trim().startsWith("%YAML")) {
				directiveCount++;
				if (directiveCount === 2) {
					state.errors.push({
						code: "InvalidDirective",
						message: "Duplicate %YAML directive",
						offset: child.offset,
						length: child.length,
					});
					break;
				}
			}
		}
	}

	// Validate %YAML directive parameters
	for (const child of children) {
		if (child.type !== "directive") continue;
		const src = child.source.trim();
		if (!src.startsWith("%YAML")) continue;

		// Check for comment without preceding whitespace (e.g., %YAML 1.1#...)
		// The lexer consumes the entire line, so we check the raw source
		const hashIdx = src.indexOf("#");
		if (hashIdx > 0) {
			const before = src[hashIdx - 1];
			if (before !== " " && before !== "\t") {
				state.errors.push({
					code: "InvalidDirective",
					message: "Comment in directive requires preceding whitespace",
					offset: child.offset,
					length: child.length,
				});
				continue;
			}
		}

		// Strip inline comment before checking parameters
		const withoutComment = hashIdx > 0 ? src.slice(0, hashIdx).trimEnd() : src;
		const parts = withoutComment.slice(1).split(/\s+/);
		// parts[0] = "YAML", rest are parameters
		const params = parts.slice(1);
		if (params.length !== 1) {
			state.errors.push({
				code: "InvalidDirective",
				message:
					params.length === 0
						? "%YAML directive requires a version parameter"
						: `%YAML directive has extra parameters: ${params.slice(1).join(" ")}`,
				offset: child.offset,
				length: child.length,
			});
		}
	}

	// Check that directives are followed by a document-start marker (---)
	let hasDirective = false;
	let hasDocumentStart = false;
	for (const child of children) {
		if (child.type === "directive") {
			hasDirective = true;
		}
		// document-start markers are consumed as "whitespace" type with source "---"
		if (child.type === "whitespace" && child.source === "---") {
			hasDocumentStart = true;
		}
	}
	if (hasDirective && !hasDocumentStart) {
		// Find the first directive for error position
		for (const child of children) {
			if (child.type === "directive") {
				state.errors.push({
					code: "InvalidDirective",
					message: "Directive must be followed by a document-start marker (---)",
					offset: child.offset,
					length: child.length,
				});
				break;
			}
		}
	}

	// Check that directives don't appear after content within the same document.
	// Only flag this when there are subsequent documents — otherwise the lexer
	// may have incorrectly tokenized plain scalar content (e.g. "%YAML 1.2" as
	// a continuation line) as a directive token.
	if (hasSubsequentDocuments) {
		let hasContent = false;
		for (const child of children) {
			if (
				child.type === "flow-scalar" ||
				child.type === "block-scalar" ||
				child.type === "block-map" ||
				child.type === "block-seq" ||
				child.type === "flow-map" ||
				child.type === "flow-seq" ||
				child.type === "alias" ||
				child.type === "anchor" ||
				child.type === "tag"
			) {
				hasContent = true;
			}
			if (child.type === "directive" && hasContent) {
				state.errors.push({
					code: "InvalidDirective",
					message: "Directive after content requires a document-end marker (...) first",
					offset: child.offset,
					length: child.length,
				});
			}
			// Recursively check for directives inside content nodes (e.g. block-map)
			if (hasContent && child.children) {
				const nested = findNestedDirective(child);
				if (nested) {
					state.errors.push({
						code: "InvalidDirective",
						message: "Directive after content requires a document-end marker (...) first",
						offset: nested.offset,
						length: nested.length,
					});
				}
			}
		}
	}
}

/** Recursively find the first directive node within a CST subtree. */
function findNestedDirective(node: CstNode): CstNode | null {
	if (node.type === "directive") return node;
	if (node.children) {
		for (const child of node.children) {
			const found = findNestedDirective(child);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Validate directive placement across a multi-document CST stream.
 *
 * YAML 1.2 requires that directives appearing between documents must be
 * preceded by a document-end marker (`...`). This function checks each
 * CST document node after the first: if it contains directives, the
 * preceding document must have ended with `...`.
 */
export function validateCrossDocumentDirectives(cstNodes: readonly CstNode[], state: ComposerState): void {
	for (let docIdx = 1; docIdx < cstNodes.length; docIdx++) {
		const cst = cstNodes[docIdx];
		if (!cst) continue;
		const children = cst.children ?? [];

		// QLJ7: directives are local to a single document. Subsequent
		// documents do not inherit %TAG handles from earlier documents,
		// so a `!handle!` reference here without a local %TAG is unresolved.
		// Run this for every doc >= 1 — even docs that DO declare directives
		// can reference handles those directives didn't define.
		validateTagHandlesInDocument(cst, state);

		// Check if this document has directives
		const hasDirectives = children.some((c) => c.type === "directive");
		if (!hasDirectives) continue;

		// Check if the previous document ended with "..."
		const prevCst = cstNodes[docIdx - 1];
		if (!prevCst) continue;
		const prevChildren = prevCst.children ?? [];
		let prevEndedWithDocEnd = false;
		for (let i = prevChildren.length - 1; i >= 0; i--) {
			const c = prevChildren[i];
			if (!c) continue;
			// Document-end markers are stored as whitespace type with source "..."
			if (c.source === "...") {
				prevEndedWithDocEnd = true;
				break;
			}
			if (c.type === "newline" || c.type === "whitespace" || c.type === "comment") continue;
			break;
		}

		if (!prevEndedWithDocEnd) {
			// Find the first directive in this document for error positioning
			for (const child of children) {
				if (child.type === "directive") {
					state.errors.push({
						code: "InvalidDirective",
						message: "Directive between documents requires a document-end marker (...) after the previous document",
						offset: child.offset,
						length: child.length,
					});
					break;
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// sourceMultiline decoration
// ---------------------------------------------------------------------------

/**
 * Walk the AST and stamp `sourceMultiline: true` on every YamlScalar/Map/Seq
 * whose source span (offset..offset+length in `text`) contains a newline.
 *
 * The composer uses this single post-pass instead of threading the flag
 * through dozens of construction sites. Nodes whose span is single-line are
 * returned unchanged (no copy) to avoid unnecessary allocation.
 */
function isSourceMultiline(text: string, offset: number, length: number): boolean {
	if (length <= 0) return false;
	const end = Math.min(offset + length, text.length);
	for (let i = offset; i < end; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 0x0a /* \n */ || ch === 0x0d /* \r */) return true;
	}
	return false;
}

function decorateSourceMultiline(node: YamlNode | null, text: string): YamlNode | null {
	if (node === null || node instanceof YamlAlias) return node;
	if (node instanceof YamlScalar) {
		if (!isSourceMultiline(text, node.offset, node.length)) return node;
		return new YamlScalar({
			value: node.value,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(node.chomp !== undefined ? { chomp: node.chomp } : {}),
			...(node.raw !== undefined ? { raw: node.raw } : {}),
			sourceMultiline: true,
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlMap) {
		const newItems = node.items.map(
			(pair) =>
				new YamlPair({
					key: decorateSourceMultiline(pair.key, text) ?? pair.key,
					value: pair.value === null ? null : decorateSourceMultiline(pair.value, text),
					...(pair.comment !== undefined ? { comment: pair.comment } : {}),
				}),
		);
		const multiline = isSourceMultiline(text, node.offset, node.length);
		return new YamlMap({
			items: newItems,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(multiline ? { sourceMultiline: true } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlSeq) {
		const newItems = node.items.map((item) => decorateSourceMultiline(item, text) ?? item);
		const multiline = isSourceMultiline(text, node.offset, node.length);
		return new YamlSeq({
			items: newItems,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(multiline ? { sourceMultiline: true } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	return node;
}

function decorateDocumentSourceMultiline(doc: RawYamlDocument, text: string): RawYamlDocument {
	const decorated = decorateSourceMultiline(doc.contents ?? null, text);
	if (decorated === doc.contents) return doc;
	return {
		contents: decorated,
		errors: doc.errors,
		warnings: doc.warnings,
		directives: doc.directives,
		...(doc.comment !== undefined ? { comment: doc.comment } : {}),
		hasDocumentStart: doc.hasDocumentStart,
		hasDocumentEnd: doc.hasDocumentEnd,
		hasDocumentStartTab: doc.hasDocumentStartTab,
	};
}

// ---------------------------------------------------------------------------
// Engine entry points
// ---------------------------------------------------------------------------

const EMPTY_DOCUMENT: RawYamlDocument = {
	contents: null,
	errors: [],
	warnings: [],
	directives: [],
	hasDocumentStart: false,
	hasDocumentEnd: false,
	hasDocumentStartTab: false,
};

/**
 * Compose the first document of `text` with full error recovery — v3
 * `parseDocument` semantics minus the Effect wrapper and minus fatal-code
 * filtering (the facade applies `isFatalCode` to the returned diagnostics).
 * Cross-document directive-placement errors are validated into the same
 * state and therefore appear in the returned document's `errors`.
 */
export function composeFirstDocument(text: string, options?: ParseOptionsInput): RawYamlDocument {
	const cstNodes = parseCSTAll(text);
	const state = createState(text, FLOW, options);

	// Validate cross-document directive placement
	validateCrossDocumentDirectives(cstNodes, state);

	const doc = cstNodes[0];
	if (!doc) {
		return EMPTY_DOCUMENT;
	}

	const result = composeDocument(doc, state, cstNodes.length > 1, cstNodes[1]);
	return decorateDocumentSourceMultiline(result, text);
}

/**
 * Compose every document of `text` with full error recovery — v3
 * `parseAllDocuments` semantics minus the Effect wrapper and minus
 * fatal-code filtering. Each document is composed with a fresh state; the
 * cross-document directive validation runs in its own state whose errors
 * are returned unfiltered as `streamErrors` (v3 filtered these to
 * `InvalidDirective` before failing — the facade applies that filter).
 */
export function composeAllDocuments(
	text: string,
	options?: ParseOptionsInput,
): { readonly documents: ReadonlyArray<RawYamlDocument>; readonly streamErrors: ReadonlyArray<RawDiagnostic> } {
	const cstNodes = parseCSTAll(text);
	const documents: RawYamlDocument[] = [];

	// Validate cross-document directive placement in an isolated state.
	const crossDocState = createState(text, FLOW, options);
	validateCrossDocumentDirectives(cstNodes, crossDocState);

	for (let i = 0; i < cstNodes.length; i++) {
		const cst = cstNodes[i];
		if (!cst) continue;
		const state = createState(text, FLOW, options);
		const doc = composeDocument(cst, state, i < cstNodes.length - 1, cstNodes[i + 1]);
		documents.push(decorateDocumentSourceMultiline(doc, text));
	}

	return { documents, streamErrors: crossDocState.errors };
}
