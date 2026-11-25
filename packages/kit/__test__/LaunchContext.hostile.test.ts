// How LaunchContext.isUnsubstituted grows on a long run of unclosed openers. `LaunchContext.test.ts` holds what it
// answers.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { LaunchContext } from "../src/index.js";

describe("LaunchContext.isUnsubstituted on a long run of unclosed openers", () => {
	// The check is two `indexOf` calls. Given one fixed string, the optimizer can fold both to a constant once the
	// loop is hot, and the call then times as nothing; two inputs taken in turn keep the argument from being one.
	it("stays linear in the run", () => {
		Growth.assertOrder(
			(count) => {
				const inputs = ["${{".repeat(count), `x${"${{".repeat(count)}`];
				let turn = 0;
				return () => {
					turn += 1;
					return LaunchContext.isUnsubstituted(inputs[turn & 1] as string);
				};
			},
			{ from: 20_000, order: 1 },
		);
	});
});
