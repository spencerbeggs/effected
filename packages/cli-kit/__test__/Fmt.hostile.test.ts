// How Fmt's scans grow on hostile input. `Fmt.test.ts` holds what they return.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Fmt } from "../src/index.js";

describe("Fmt.stripAnsi on an unterminated sequence", () => {
	// A quadratic regex took minutes on a million characters; each of these is one pass.
	for (const [name, make] of [
		["an operating system command", (count: number) => `\u001b]${"a".repeat(count)}`],
		["a device control string", (count: number) => `\u001bP${"a".repeat(count)}`],
		["a control sequence of parameters", (count: number) => `\u001b[${"1;".repeat(count / 2)}`],
		["a run of two-byte escapes", (count: number) => "\u001b ".repeat(count / 2)],
	] as const) {
		it(`strips ${name} in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const input = make(count);
					return () => Fmt.stripAnsi(input);
				},
				{ from: 250_000, order: 1 },
			);
		});
	}
});

describe("Fmt.suggest on a long typed value", () => {
	it("stays linear in the value against short names", () => {
		Growth.assertOrder(
			(count) => {
				const long = "x".repeat(count);
				return () => Fmt.suggest(long, ["build", "test"]);
			},
			{ from: 50_000, order: 1 },
		);
	});

	// Against names as long as the value the edit distance is bounded by the suggestion threshold, not by the
	// product of the two lengths.
	it("stays linear in the value against names as long", () => {
		Growth.assertOrder(
			(count) => {
				const long = "x".repeat(count);
				const names = [`${long}yyy`, long.slice(1)];
				return () => Fmt.suggest(long, names);
			},
			{ from: 50_000, order: 1 },
		);
	});
});
