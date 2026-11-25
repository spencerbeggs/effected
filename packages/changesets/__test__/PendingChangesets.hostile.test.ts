// How PendingChangesets.readSync grows on a root holding a long run of separators. `PendingChangesets.test.ts`
// holds what it answers.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { PendingChangesets } from "../src/PendingChangesets.js";

describe("PendingChangesets.readSync on a long run of separators", () => {
	// A run that does not end the string is the backtracking case for a `[\\/]+$` trim.
	it("trims the run in time linear in its length", () => {
		Growth.assertOrder(
			(count) => {
				const root = `/r${"/".repeat(count)}x`;
				return () => PendingChangesets.readSync(root);
			},
			{ from: 20_000, order: 1 },
		);
	});
});
