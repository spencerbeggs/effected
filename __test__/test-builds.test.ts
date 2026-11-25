import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";
import { READS_OWN_BUILD, buildFilters } from "../lib/scripts/test-builds.js";

/**
 * Which packages a test tier builds before it runs (#1415).
 *
 * @remarks
 * Workspace links resolve to source, so most tests need nothing built. The list here was measured, not reasoned:
 * with every `dist/prod` removed and the pre-test build off, the fast tier failed in exactly these packages, and
 * with only these built it, the hostile tier and the full tier pass. The slow tier's packed-install e2e packs the
 * plugin with everything it depends on, so it alone needs that whole closure.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceNames = new Set(
	readdirSync(join(ROOT, "packages")).flatMap((dir) => {
		try {
			return [(JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")) as { name: string }).name];
		} catch {
			return [];
		}
	}),
);

describe("the packages a test tier builds", () => {
	it("names only workspace packages, each once", () => {
		assert.isAbove(READS_OWN_BUILD.length, 0);
		assert.strictEqual(new Set(READS_OWN_BUILD).size, READS_OWN_BUILD.length);
		for (const name of READS_OWN_BUILD) assert.isTrue(workspaceNames.has(name), `${name} is not a workspace package`);
	});

	it("builds the listed packages alone for the fast, hostile and full tiers", () => {
		const expected = READS_OWN_BUILD.map((name) => `--filter=${name}`);
		for (const tier of ["fast", "hostile", "full"] as const) {
			assert.deepStrictEqual(buildFilters(tier), expected, tier);
		}
		// No dependency closure: a `...` filter is what made the fast tier build 41 packages.
		assert.isFalse(buildFilters("fast").some((filter) => filter.includes("...")));
	});

	it("adds the plugin's whole closure for the slow tier, and for a run with no tier, which includes it", () => {
		for (const tier of ["slow", undefined] as const) {
			const filters = buildFilters(tier);
			assert.include(filters, "--filter=@effected/plugin...");
			for (const name of READS_OWN_BUILD) assert.include(filters, `--filter=${name}`);
		}
	});

	// The published agent plugin's build rewrites the committed plugin/builds trees; a test run must never do that.
	it("never builds the agent plugin", () => {
		for (const tier of ["fast", "slow", "hostile", "full", undefined] as const) {
			assert.isFalse(buildFilters(tier).some((filter) => filter.includes("ai-plugins")));
		}
	});
});
