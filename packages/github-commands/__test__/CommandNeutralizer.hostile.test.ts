// Matching is linear, so a hostile line cannot stall the job that logs it: a backtracking pattern takes years on
// these lengths. `CommandNeutralizer.test.ts` holds what each line is turned into.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { CommandNeutralizer } from "../src/index.js";

const BOM = String.fromCodePoint(0xfeff);
const ZWSP = String.fromCodePoint(0x200b);

describe("CommandNeutralizer: matching is linear in a hostile line", () => {
	for (const [name, make, from] of [
		["a run of BOMs with no command", (count: number) => `${BOM.repeat(count)}x`, 2_500],
		["a run of BOMs in front of a command", (count: number) => `${BOM.repeat(count)}::add-mask::x`, 2_500],
		[
			"a run mixing every kind of leading character the V2 rule skips",
			(count: number) => `${` \t\u0085${BOM}${ZWSP}\u0301`.repeat(count)}x`,
			500,
		],
		["a run of #-and-ignorable pairs with no [", (count: number) => `#${ZWSP}`.repeat(count), 1_250],
	] as const) {
		it(`neutralizes ${name} in time linear in the run`, () => {
			Growth.assertOrder(
				(count) => {
					const text = make(count);
					return () => CommandNeutralizer.text(text);
				},
				{ from, order: 1 },
			);
		});
	}
});
