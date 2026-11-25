// How Sgr.strip grows on a parameter run that never ends in `m`. `Sgr.test.ts` holds what it returns.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Sgr } from "../src/Sgr.js";

const ESC = "\u001b";

describe("Sgr.strip on a parameter run that never ends in m", () => {
	it("is linear in one long run", () => {
		Growth.assertOrder(
			(count) => {
				const input = `${ESC}[${"1;".repeat(count)}`;
				return () => Sgr.strip(input);
			},
			{ from: 25_000, order: 1 },
		);
	});

	it("is linear in a run of unfinished sequences", () => {
		Growth.assertOrder(
			(count) => {
				const input = `${ESC}[1;`.repeat(count);
				return () => Sgr.strip(input);
			},
			{ from: 12_500, order: 1 },
		);
	});
});
