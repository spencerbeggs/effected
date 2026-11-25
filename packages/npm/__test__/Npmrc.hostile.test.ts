// How parseNpmrc grows on long input. `Npmrc.test.ts` holds what it parses to.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { parseNpmrc } from "../src/Npmrc.js";

const ref = (name: string): string => `$\{${name}}`;

describe("parseNpmrc on long input", () => {
	for (const [name, make] of [
		["many lines", (count: number) => Array.from({ length: count }, (_, i) => `k${i}=${ref("V")}`).join("\n")],
		["a long backslash run before a placeholder", (count: number) => `x=${"\\".repeat(count)}${ref("V")}`],
		["a long run of unclosed openers", (count: number) => `x=${"${".repeat(count)}`],
	] as const) {
		it(`stays linear on ${name}`, () => {
			Growth.assertOrder(
				(count) => {
					const text = make(count);
					return () => parseNpmrc(text, { V: "x" });
				},
				{ from: 5_000, order: 1 },
			);
		});
	}
});
