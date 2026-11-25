// How splitting a stack frame grows on a long run of tabs before an unclosed parenthesis. `splitFrame.test.ts`
// holds what it returns.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Cause } from "effect";
import { CliFailure } from "../src/index.js";
import { splitFrame } from "../src/internal/splitFrame.js";

describe("splitFrame on a long run of tabs", () => {
	it("is linear in the run", () => {
		Growth.assertOrder(
			(count) => {
				const raw = `at x${"\t".repeat(count)}(a`;
				return () => splitFrame(raw);
			},
			{ from: 25_000, order: 1 },
		);
	});

	it("is linear through CliFailure.toDoc too", () => {
		Growth.assertOrder(
			(count) => {
				const error = new Error("m");
				error.stack = `Error: m\n    at x${"\t".repeat(count)}(a`;
				const cause = Cause.die(error);
				return () => CliFailure.toDoc(cause, { stackFrames: "all" });
			},
			{ from: 25_000, order: 1 },
		);
	});
});
