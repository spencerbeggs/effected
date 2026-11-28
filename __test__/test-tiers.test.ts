import { assert, describe, it } from "vitest";
import {
	DEPTH_SUFFIXES,
	HOSTILE_SUFFIX,
	NEEDS_FRESH_PROCESS,
	TIERS,
	isolatesFiles,
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

	it("reads an unset tier as none", () => {
		assert.strictEqual(parseTier(undefined), undefined);
		assert.strictEqual(parseTier("hostile"), "hostile");
	});

	it("refuses an unknown tier and an unknown depth", () => {
		assert.throws(() => parseTier("timing"), /EFFECTED_TEST_TIER must be one of fast, slow, hostile, full/);
		// A workflow expression that expands to nothing must not read as a local run, which drops the slow exclusion.
		assert.throws(() => parseTier(""), /EFFECTED_TEST_TIER/);
		assert.throws(() => parseDepth("Full"), /EFFECTED_TEST_DEPTH/);
		// A workflow expression that expands to nothing must not read as a full run.
		assert.throws(() => parseDepth(""), /EFFECTED_TEST_DEPTH/);
		assert.strictEqual(parseDepth(undefined), "sample");
		assert.strictEqual(parseDepth("full"), "full");
	});
});

describe("validateLists", () => {
	const exists = (path: string): boolean => path !== "packages/a/__test__/gone.test.ts";

	it("accepts a list whose files exist", () => {
		validateLists({ slow: ["packages/a/__test__/s.test.ts"], exists });
	});

	it("refuses a slow path that is missing", () => {
		assert.throws(
			() => validateLists({ slow: ["packages/a/__test__/gone.test.ts"], exists }),
			/do not exist[\s\S]*gone\.test\.ts/,
		);
	});

	// The suffix already places a hostile file; listed as slow too, it would run in two tiers.
	it("refuses a hostile file in the slow list", () => {
		assert.throws(() => validateLists({ slow: ["packages/a/__test__/a.hostile.test.ts"], exists }), /hostile/);
	});
});

describe("isolatesFiles", () => {
	// Starting a process for every test file was 38% of the pull request run's worker time (#1415): a thousand
	// files each loading the same modules. Files of one project now share a process in the runs with a coverage
	// gate to hold, unless the project's tests assert on what a fresh process has or has not loaded.
	it("shares a process between a project's files in the fast tier and in a run with no tier", () => {
		for (const tier of ["fast", undefined] as const) {
			assert.isFalse(isolatesFiles(tier, "@effected/glob"), String(tier));
		}
	});

	it("keeps a file to its own process in the projects that need a fresh one", () => {
		assert.isAbove(NEEDS_FRESH_PROCESS.size, 0);
		for (const project of NEEDS_FRESH_PROCESS) {
			for (const tier of ["fast", undefined] as const) assert.isTrue(isolatesFiles(tier, project), project);
		}
	});

	// A growth check reads the CPU time of its process, so nothing else may run in that process; the slow tier's
	// e2es spawn and pack; the full tier is rare and long. None of them is worth the risk for the time.
	it("keeps a file to its own process in the hostile, slow and full tiers", () => {
		for (const tier of ["hostile", "slow", "full"] as const) {
			assert.isTrue(isolatesFiles(tier, "@effected/glob"), tier);
		}
	});
});

describe("projectSelection", () => {
	const files = [
		"/r/p/__test__/a.test.ts",
		"/r/p/__test__/a.hostile.test.ts",
		"/r/p/__test__/a.parity.test.ts",
		"/r/p/__test__/s.e2e.test.ts",
	];
	const slow = ["/r/p/__test__/s.e2e.test.ts"];

	it("with no tier, excludes hostile files only", () => {
		assert.deepStrictEqual(projectSelection({ tier: undefined, slow, files }), {
			exclude: ["**/*.hostile.test.{ts,tsx}"],
		});
	});

	it("fast also excludes the slow files", () => {
		assert.deepStrictEqual(projectSelection({ tier: "fast", slow, files }), {
			exclude: ["**/*.hostile.test.{ts,tsx}", "/r/p/__test__/s.e2e.test.ts"],
		});
	});

	it("slow includes only the slow files and drops a project with none", () => {
		assert.deepStrictEqual(projectSelection({ tier: "slow", slow, files }), { include: slow });
		assert.isNull(projectSelection({ tier: "slow", slow: [], files }));
	});

	it("hostile includes the hostile-suffix files and drops a project with none", () => {
		assert.deepStrictEqual(projectSelection({ tier: "hostile", slow, files }), {
			include: ["/r/p/__test__/a.hostile.test.ts"],
		});
		assert.isNull(projectSelection({ tier: "hostile", slow, files: ["/r/p/__test__/a.test.ts"] }));
	});

	it("full includes the depth-aware files at full depth and drops a project with none", () => {
		assert.deepStrictEqual(projectSelection({ tier: "full", slow, files }), {
			include: ["/r/p/__test__/a.parity.test.ts"],
			env: { EFFECTED_TEST_DEPTH: "full" },
		});
		assert.isNull(projectSelection({ tier: "full", slow, files: ["/r/p/__test__/a.test.ts"] }));
	});

	it("places a .tsx file by the same suffixes", () => {
		assert.deepStrictEqual(projectSelection({ tier: "full", slow: [], files: ["/r/p/__test__/v.property.test.tsx"] }), {
			include: ["/r/p/__test__/v.property.test.tsx"],
			env: { EFFECTED_TEST_DEPTH: "full" },
		});
	});
});
