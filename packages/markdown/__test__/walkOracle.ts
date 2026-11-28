// The walk oracle `visitor.test.ts` checks `MarkdownVisitor.walk` against over
// the CommonMark corpus, and `visitor.property.test.ts` over generated markdown.

import { assert } from "@effect/vitest";
import type { Root } from "../src/MarkdownNode.js";
import { MarkdownVisitor } from "../src/MarkdownVisitor.js";

/**
 * An independent oracle for the walk: an eager, hand-written recursive
 * pre-order over `children`, sharing no code with `MarkdownVisitor`. It
 * covers trees inside the depth cap only — every parsed tree is.
 */
export interface OracleEvent {
	readonly tag: "Enter" | "Exit";
	readonly node: unknown;
	readonly path: ReadonlyArray<number>;
	readonly depth: number;
}
export const oracle = (node: unknown, path: ReadonlyArray<number> = [], depth = 0): Array<OracleEvent> => {
	const children = (node as { readonly children?: unknown }).children;
	const inner = Array.isArray(children)
		? children.flatMap((child, index) => oracle(child, [...path, index], depth + 1))
		: [];
	return [{ tag: "Enter", node, path, depth }, ...inner, { tag: "Exit", node, path, depth }];
};

/** Compare a walk to the oracle event-for-event: tag, node identity, path, depth. */
export const assertMatchesOracle = (root: Root, label: string): void => {
	const walked = [...MarkdownVisitor.walk(root)];
	const expected = oracle(root);
	assert.strictEqual(walked.length, expected.length, `${label}: event count`);
	walked.forEach((event, index) => {
		const want = expected[index] as OracleEvent;
		if (event._tag === "Error") {
			assert.fail(`${label}: unexpected Error event at ${index}`);
		} else {
			assert.strictEqual(event._tag, want.tag, `${label}: tag at ${index}`);
			assert.strictEqual(event.node, want.node, `${label}: node identity at ${index}`);
			assert.deepStrictEqual(event.path, want.path, `${label}: path at ${index}`);
			assert.strictEqual(event.depth, want.depth, `${label}: depth at ${index}`);
		}
	});
};
