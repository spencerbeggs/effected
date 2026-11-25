// How SourceBoundary.check grows on a long run of whitespace after a binding's `=`. `SourceBoundary.test.ts` holds
// what it reports.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import type { BoundaryRule } from "../src/testing.js";
import { SourceBoundary } from "../src/testing.js";

describe("SourceBoundary promiseInExclusive on a long run of whitespace", () => {
	const rules: ReadonlyArray<BoundaryRule> = [{ promiseInExclusive: {} }];

	// The quadratic form took about 19 seconds at 200,000 tabs.
	it("stays linear in the run", () => {
		Growth.assertOrder(
			(count) => {
				const text = `const lane =${"\t".repeat(count)}x;`;
				return () => SourceBoundary.check("f.ts", text, [...rules]);
			},
			{ from: 20_000, order: 1 },
		);
	});
});
