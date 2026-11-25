// How placeholder expansion grows on hostile input. `pnpmNpmrcPlaceholders.test.ts` holds what each expands to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { expandPlaceholders, hasPlaceholder } from "../src/internal/pnpmNpmrc.js";

const env = { A: "x", E: "", B: "b-c", N: "n" };

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
				{ from: 20_000, order: 1 },
			);
		});

		it(`looks for a placeholder in ${name} in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const input = make(count);
					return () => hasPlaceholder(input);
				},
				{ from: 20_000, order: 1 },
			);
		});
	}
});
