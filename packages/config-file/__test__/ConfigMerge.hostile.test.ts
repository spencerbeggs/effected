// How ConfigMerge.deep grows when two keys reach the same child at every level. `ConfigMerge.test.ts` holds what
// it merges to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { ConfigMerge } from "../src/ConfigMerge.js";

type Rec = Record<string, unknown>;

/** `depth` levels, each holding the level below under two keys: one node per level, and 2^depth paths to the leaf. */
const shared = (depth: number): Rec => {
	let node: Rec = { v: 1 };
	for (let level = 0; level < depth; level += 1) node = { x: node, y: node };
	return node;
};

describe("ConfigMerge.deep over a child shared by two keys at every level", () => {
	// Without per-pair memoization the merge recurses into both keys at every level, about 2^depth calls: 4x the
	// depth here is 2^15 times the work, and it fails in seconds. Memoized, it is one merge per level.
	it("merges each pair once: linear in the depth", () => {
		Growth.assertOrder(
			(depth) => {
				const base = shared(depth);
				const override = shared(depth);
				return () => ConfigMerge.deep<Rec>(base, override);
			},
			{ from: 5, order: 1 },
		);
	});
});
