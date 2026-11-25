import { assert, describe, it } from "vitest";
import {
	DEPTH_SUFFIXES,
	HOSTILE_SUFFIX,
	TIERS,
	parseDepth,
	parseTier,
	projectSelection,
	validateLists,
} from "../lib/scripts/test-tiers.js";

/**
 * The run each `EFFECTED_TEST_TIER` selects, derived from file names (#1415).
 *
 * @remarks
 * `vitest.config.ts` only wires these functions to the plugin's project discovery, so the rules are pinned here:
 * which files a tier includes or excludes, which projects it drops, and which mistakes stop the config loading.
 */
describe("the tier and depth variables", () => {
	it("names the four tiers and the suffixes that place a file", () => {
		assert.deepStrictEqual([...TIERS], ["fast", "slow", "hostile", "full"]);
		assert.strictEqual(HOSTILE_SUFFIX, ".hostile.test.ts");
		assert.deepStrictEqual([...DEPTH_SUFFIXES], [".parity.test.ts", ".corpus.test.ts", ".property.test.ts"]);
	});

	it("reads an unset or empty tier as none", () => {
		assert.strictEqual(parseTier(undefined), undefined);
		assert.strictEqual(parseTier(""), undefined);
		assert.strictEqual(parseTier("hostile"), "hostile");
	});

	it("refuses an unknown tier and an unknown depth", () => {
		assert.throws(() => parseTier("timing"), /EFFECTED_TEST_TIER must be one of fast, slow, hostile, full/);
		assert.throws(() => parseDepth("Full"), /EFFECTED_TEST_DEPTH/);
		// A workflow expression that expands to nothing must not read as a full run.
		assert.throws(() => parseDepth(""), /EFFECTED_TEST_DEPTH/);
		assert.strictEqual(parseDepth(undefined), "sample");
		assert.strictEqual(parseDepth("full"), "full");
	});
});

describe("validateLists", () => {
	const exists = (path: string): boolean => path !== "packages/a/__test__/gone.test.ts";

	it("accepts lists whose files exist", () => {
		validateLists({ slow: ["packages/a/__test__/s.test.ts"], legacyTiming: ["packages/a/__test__/s.test.ts"], exists });
	});

	it("refuses a slow path that is missing", () => {
		assert.throws(
			() => validateLists({ slow: ["packages/a/__test__/gone.test.ts"], legacyTiming: [], exists }),
			/do not exist[\s\S]*gone\.test\.ts/,
		);
	});

	// The suffix already places a hostile file; listed as slow too, it would run in two tiers.
	it("refuses a hostile file in the slow list", () => {
		assert.throws(
			() => validateLists({ slow: ["packages/a/__test__/a.hostile.test.ts"], legacyTiming: [], exists }),
			/hostile/,
		);
	});

	it("refuses a timing path outside the slow list", () => {
		assert.throws(
			() => validateLists({ slow: [], legacyTiming: ["packages/a/__test__/t.test.ts"], exists }),
			/SLOW_TESTS/,
		);
	});
});

describe("projectSelection", () => {
	const files = [
		"/r/p/__test__/a.test.ts",
		"/r/p/__test__/a.hostile.test.ts",
		"/r/p/__test__/a.parity.test.ts",
		"/r/p/__test__/s.e2e.test.ts",
		"/r/p/__test__/t.test.ts",
	];
	const slow = ["/r/p/__test__/s.e2e.test.ts"];
	const legacyTiming = ["/r/p/__test__/t.test.ts"];

	it("with no tier, excludes hostile files and legacy timing files only", () => {
		assert.deepStrictEqual(projectSelection({ tier: undefined, slow, legacyTiming, files }), {
			exclude: ["**/*.hostile.test.{ts,tsx}", "/r/p/__test__/t.test.ts"],
		});
	});

	it("fast also excludes the slow files", () => {
		assert.deepStrictEqual(projectSelection({ tier: "fast", slow, legacyTiming, files }), {
			exclude: ["**/*.hostile.test.{ts,tsx}", "/r/p/__test__/t.test.ts", "/r/p/__test__/s.e2e.test.ts"],
		});
	});

	it("slow includes only the slow files and drops a project with none", () => {
		assert.deepStrictEqual(projectSelection({ tier: "slow", slow, legacyTiming, files }), { include: slow });
		assert.isNull(projectSelection({ tier: "slow", slow: [], legacyTiming, files }));
	});

	it("hostile includes hostile-suffix and legacy timing files and drops a project with neither", () => {
		assert.deepStrictEqual(projectSelection({ tier: "hostile", slow, legacyTiming, files }), {
			include: ["/r/p/__test__/a.hostile.test.ts", "/r/p/__test__/t.test.ts"],
		});
		assert.isNull(projectSelection({ tier: "hostile", slow, legacyTiming: [], files: ["/r/p/__test__/a.test.ts"] }));
	});

	it("full includes the depth-aware files at full depth and drops a project with none", () => {
		assert.deepStrictEqual(projectSelection({ tier: "full", slow, legacyTiming, files }), {
			include: ["/r/p/__test__/a.parity.test.ts"],
			env: { EFFECTED_TEST_DEPTH: "full" },
		});
		assert.isNull(projectSelection({ tier: "full", slow, legacyTiming, files: ["/r/p/__test__/a.test.ts"] }));
	});

	it("places a .tsx file by the same suffixes", () => {
		assert.deepStrictEqual(
			projectSelection({ tier: "full", slow: [], legacyTiming: [], files: ["/r/p/__test__/v.property.test.tsx"] }),
			{ include: ["/r/p/__test__/v.property.test.tsx"], env: { EFFECTED_TEST_DEPTH: "full" } },
		);
	});
});
