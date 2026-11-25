// How asciiTrim grows on a long whitespace run. `asciiTrim.test.ts` holds what it returns.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { asciiTrim } from "../../src/internal/checkout/asciiTrim.js";

describe("asciiTrim on a long whitespace run", () => {
	// A run the trim strips, followed by a character it keeps: a pattern such as `\s+$` retries from every space of
	// the run before giving up at that character, which is quadratic. An interior run (`x`, spaces, `y`) is not
	// measured: the trim reads only the ends, so its cost does not grow with the run at all.
	it("is linear in a leading run, which it strips", () => {
		Growth.assertOrder(
			(count) => {
				const input = `${" ".repeat(count)}y`;
				return () => asciiTrim(input);
			},
			{ from: 20_000, order: 1 },
		);
	});
});
