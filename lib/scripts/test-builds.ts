/**
 * Which packages a test tier builds before it runs, and the command that builds them (#1415).
 *
 * @remarks
 * Workspace links resolve to source, so a test sees a sibling's edit with nothing built. Only a test that reads
 * built output needs a build, and only of the package it reads. The fast tier once built the plugin and everything
 * it depends on, 41 packages and six minutes on a runner, for tests that read twelve.
 *
 * `READS_OWN_BUILD` was measured, not reasoned: with every `dist/prod` removed and the pre-test build off, the fast
 * tier failed in exactly these packages, and with only these built it, the hostile tier and the full tier pass. To
 * measure it again, remove the build output, run a tier with `EFFECTED_TEST_NO_BUILD=1`, and read what fails. A
 * runner starts from a clean checkout, so a test that comes to read a build this list does not name fails there.
 *
 * Run as a script it builds a tier's packages through turbo: `tsx lib/scripts/test-builds.ts fast`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Tier } from "./test-tiers.js";
import { parseTier } from "./test-tiers.js";

/** The packages with a test, in some tier, that reads the package's own built output. */
export const READS_OWN_BUILD = [
	"@effected/cli",
	"@effected/cli-kit",
	"@effected/commands",
	"@effected/config-file",
	// Not for its own tests: the plugin's entry test loads the engine's built build entry.
	"@effected/engine",
	"@effected/kit",
	"@effected/markdown-lint",
	"@effected/mcp",
	"@effected/npm",
	"@effected/plugin",
	"@effected/pnpm",
	"@effected/pnpm-plugin-effected",
] as const;

/**
 * The plugin with everything it depends on: the slow tier's packed-install e2e packs and installs them all.
 * Named, never the whole workspace, because the agent plugin's build rewrites the committed `plugin/builds` trees
 * and a test run must not rewrite committed files (#1084).
 */
const PACKED_INSTALL_CLOSURE = "@effected/plugin...";

/**
 * The `turbo run build` filters for `tier`. The slow tier, and a run with no tier, which includes the slow files,
 * add the packed-install closure.
 */
export const buildFilters = (tier: Tier | undefined): ReadonlyArray<string> => {
	const own = READS_OWN_BUILD.map((name) => `--filter=${name}`);
	return tier === "slow" || tier === undefined ? [`--filter=${PACKED_INSTALL_CLOSURE}`, ...own] : own;
};

/** The whole build command for `tier`, as arguments to `pnpm exec`. */
export const buildCommand = (tier: Tier | undefined): ReadonlyArray<string> => [
	"turbo",
	"run",
	"build",
	...buildFilters(tier),
	"--output-logs=errors-only",
	"--log-prefix=none",
];

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const tier = parseTier(process.argv[2]);
		const built = spawnSync("pnpm", ["exec", ...buildCommand(tier)], { stdio: "inherit" });
		process.exitCode = built.status ?? 1;
	} catch (error) {
		process.stderr.write(`test-builds: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
