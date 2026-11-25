// How registryHost grows on a pathological path. `RegistryKind.test.ts` holds what it answers.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { registryHost } from "../src/RegistryKind.js";

describe("registryHost on a pathological path", () => {
	// The obvious `.replace(/\/.*$/, "")` is a polynomial-backtracking regex over a value this package does not
	// control (registry strings come from npmrc and package.json). CodeQL flagged it on exactly that line. The
	// scan-based form answers the same thing without the exposure.
	//
	// The run alone does not show it: `.*$` matches from the first slash at once. A line break after the run does,
	// since `.` stops at it and `$` is not there, so the pattern fails from every slash in turn. Both are held.
	for (const [name, make] of [
		["a long run of slashes", (count: number) => `evil.test/${"/".repeat(count)}`],
		["a long run of slashes before a line break", (count: number) => `evil.test/${"/".repeat(count)}\n`],
	] as const) {
		it(`stays linear on ${name}, with no regex backtracking`, () => {
			assert.strictEqual(registryHost(make(20_000)), "evil.test");
			Growth.assertOrder(
				(count) => {
					const pathological = make(count);
					return () => registryHost(pathological);
				},
				{ from: 20_000, order: 1 },
			);
		});
	}
});
