// How diffing grows when no line is shared, the worst case for a diff. `LineDiff.test.ts` holds what it computes.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { LineDiff } from "../src/index.js";

const manyLines = (prefix: string, count: number): string =>
	Array.from({ length: count }, (_, index) => `${prefix}${index}`).join("\n");

describe("LineDiff.compute on a wholly replaced document", () => {
	it("is linear in the lines", () => {
		Growth.assertOrder(
			(count) => {
				const before = manyLines("a", count);
				const after = manyLines("b", count);
				return () => LineDiff.compute(before, after);
			},
			{ from: 25_000, order: 1 },
		);
	});
});
