// How ShellScript.allCommands grows on hostile nesting, fan-out and overlap. `ShellScript.test.ts` holds what the
// walk returns; this file holds that its cost stays linear in the input for a fixed cap.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import type { ShellCommandWalk } from "../src/index.js";
import { ShellSyntax } from "../src/index.js";

const walk = (input: string, maxDepth?: number): ShellCommandWalk =>
	ShellSyntax.parse(input).allCommands(maxDepth === undefined ? undefined : { maxDepth });

const chain = (depth: number, inner = "git commit"): string => `echo ${"$(".repeat(depth)}${inner}${")".repeat(depth)}`;

/**
 * The growth ratio of a parse and walk from `build(start)` to `build(4 * start)`: linear is near 4, quadratic near
 * 16. `Growth.measure` times each size as the fastest of five CPU-time samples and repeats a run shorter than 5 ms,
 * so the small side measures real work and not timer noise.
 */
const growth = (build: (size: number) => string, start: number, maxDepth?: number): number =>
	Growth.measure(
		(size) => {
			const input = build(size);
			return () => walk(input, maxDepth);
		},
		{ from: start, bound: 8 },
	).ratio;

describe("ShellScript.allCommands on hostile input", () => {
	it("stays linear in the input over a deep $( chain at the default cap", () => {
		const ratio = growth((size) => chain(Math.floor(size / 2)), 16_384);
		assert.isBelow(ratio, 8);
	});

	it("stays linear in the input over a deep chain at a large cap", () => {
		const ratio = growth((size) => chain(Math.floor(size / 2)), 4096, 64);
		assert.isBelow(ratio, 8);
	});

	it("stays linear over thousands of substitutions in one command", () => {
		const ratio = growth((size) => `echo ${"$(a) ".repeat(Math.floor(size / 5))}`, 16_384);
		assert.isBelow(ratio, 8);
	});

	it("stays linear over fan-out at every depth", () => {
		const ratio = growth((size) => `echo ${"$(a $(b `c` <(d)) e) ".repeat(Math.floor(size / 26))}`, 16_384);
		assert.isBelow(ratio, 8);
	});
});
