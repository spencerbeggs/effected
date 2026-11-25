// How the globstar section walk grows when every section fails. `globstar.test.ts` holds the answers.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Minimatch } from "../src/internal/minimatch.js";

const rep = (unit: string, count: number): string => Array.from({ length: count }, () => unit).join("/");

describe("hostility: globstar sections that all fail", () => {
	// Twelve `**/a` sections can each start at every `a`, and every walk ends at the same dot portion. Trying each
	// combination is exponential in the sections: at 30 `a` portions these took over nine seconds each. The `tried`
	// set stops a walk at a place already tried, which leaves work that grows with the path alone, so 4x the `a`
	// portions is bounded here and the combinations are not: C(32, 12) against C(8, 8).
	const walk =
		(pattern: string, tail: string, options: { readonly partial?: boolean }) =>
		(portions: number): (() => unknown) => {
			const m = new Minimatch(pattern, options);
			const path = `${rep("a", portions)}/.x/${rep("q", 14)}${tail}`;
			return () => m.match(path);
		};

	it("grows with the path, not with the combinations, under partial", () => {
		Growth.assertOrder(walk(rep("**/a", 12), "", { partial: true }), { from: 8, order: 2 });
	});

	it("grows with the path, not with the combinations, without partial", () => {
		Growth.assertOrder(walk(`${rep("**/a", 12)}/**/z`, "/z", {}), { from: 8, order: 2 });
	});

	it("still answers no match at the measured sizes", () => {
		assert.isFalse(walk(rep("**/a", 12), "", { partial: true })(32)());
		assert.isFalse(walk(`${rep("**/a", 12)}/**/z`, "/z", {})(32)());
	});
});
