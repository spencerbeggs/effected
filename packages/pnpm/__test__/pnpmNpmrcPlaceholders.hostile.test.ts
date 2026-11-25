// How placeholder expansion grows on hostile input. `pnpmNpmrcPlaceholders.test.ts` holds what each expands to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { expandPlaceholders, hasPlaceholder } from "../src/internal/pnpmNpmrc.js";

const env = { A: "x", E: "", B: "b-c", N: "n" };

// The small size of each growth check. It was 20,000, and one read 7.4x on a Linux runner against the bound of 10,
// where it reads about 4x on macOS: at 80,000 characters the memory an expansion holds had started to cost.
const SMALL = 5_000;

describe("pnpmNpmrc placeholders on hostile input", () => {
	for (const [name, make] of [
		["a run of ${{", (count: number) => "${{".repeat(count)],
		["a long backslash run before an unclosed ${", (count: number) => `${"\\".repeat(count)}\${`],
		["a long backslash run before a closed placeholder", (count: number) => `${"\\".repeat(count)}\${A}`],
		["an opener followed by a long body with no closer", (count: number) => `\${${"a".repeat(count)}`],
		["many empty placeholders then a closed one", (count: number) => `${"${}".repeat(count)}\${A}`],
	] as const) {
		it(`expands ${name} in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const input = make(count);
					return () => expandPlaceholders(input, env);
				},
				{ from: SMALL, order: 1 },
			);
		});

		it(`looks for a placeholder in ${name} in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const input = make(count);
					return () => hasPlaceholder(input);
				},
				{ from: SMALL, order: 1 },
			);
		});
	}
});
