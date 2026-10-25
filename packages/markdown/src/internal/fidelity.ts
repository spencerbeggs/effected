// The one table of fidelity fields: the optional extras a node carries to
// record its author's spelling. `MarkdownTransform.canonicalize` and the
// `canonical` stringify option both derive from it, so the two cannot drift.
// `Text.escapeStyle` is deliberately absent — it is an emitter instruction,
// not a source spelling, and the Mdast boundary keeps it too.

import type { MarkdownNode, MarkdownNodeType } from "../MarkdownNode.js";

/** Node type to the fidelity keys that node may carry. */
export const FIDELITY_FIELDS: { readonly [T in MarkdownNodeType]?: ReadonlyArray<string> } = {
	heading: ["headingStyle"],
	emphasis: ["markerChar"],
	strong: ["markerChar"],
	thematicBreak: ["markerChar"],
	code: ["fenceChar", "fenceLength"],
	list: ["bulletChar", "delimiter"],
	break: ["breakStyle"],
};

/**
 * Return `node` without its fidelity keys; the same instance when it carries
 * none, so structural sharing holds.
 */
export const clearFidelity = (node: MarkdownNode): MarkdownNode => {
	const keys = FIDELITY_FIELDS[node.type];
	if (keys === undefined || !keys.some((key) => key in node)) return node;
	const rest: Record<string, unknown> = { ...node };
	for (const key of keys) delete rest[key];
	const ctor = node.constructor as new (input: unknown, options: { readonly disableChecks: true }) => MarkdownNode;
	return new ctor(rest, { disableChecks: true });
};
