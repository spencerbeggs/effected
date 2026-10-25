// Iterative depth probe for the `canonical: true` stringify path. The
// canonicalizing walk is plain recursion, so a tree deeper than the stack
// would throw a RangeError before the stringifier's own depth guard ran.
// This walk uses an explicit stack, so it always terminates, and raises the
// same `GuardExceeded` carrier at the same `MAX_NESTING_DEPTH` the
// stringifier uses.

import type { MarkdownNode } from "../MarkdownNode.js";
import { GuardExceeded } from "./carriers.js";
import { MAX_NESTING_DEPTH } from "./limits.js";

/**
 * Throws {@link GuardExceeded} when `node` nests deeper than `MAX_NESTING_DEPTH`;
 * returns otherwise. Never recurses, so it is safe on a tree of any depth.
 *
 * @internal
 */
export const assertWithinNestingDepth = (node: MarkdownNode): void => {
	const stack: Array<[MarkdownNode, number]> = [[node, 0]];
	while (stack.length > 0) {
		const [current, depth] = stack.pop() as [MarkdownNode, number];
		if (current.type !== "root" && depth > MAX_NESTING_DEPTH) {
			throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth, current.position.start.offset);
		}
		if ("children" in current) {
			for (const child of current.children as ReadonlyArray<MarkdownNode>) {
				stack.push([child, depth + 1]);
			}
		}
	}
};
