// `relativeTo` without a `Path` trims the caller's root of trailing separators. `displayPath.hostile.test.ts` holds
// that the trim is linear in a long run of separators inside the root.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { relativeTo } from "../src/internal/displayPath.js";

describe("relativeTo without Path", () => {
	it("trims a root holding a long separator run", () => {
		const root = `a${"/".repeat(200_000)}b`;
		assert.strictEqual(relativeTo(root, Option.none())(`${root}/x.ts`), "x.ts");
	});

	it("trims a trailing run of mixed separators, and only the trailing run", () => {
		assert.strictEqual(relativeTo("/repo/\\//", Option.none())("/repo/src/a.ts"), "src/a.ts");
		assert.strictEqual(relativeTo("/repo//x", Option.none())("/repo//x/a.ts"), "a.ts");
		assert.strictEqual(relativeTo("/repo", Option.none())("/repo//x/a.ts"), "/x/a.ts");
	});
});
