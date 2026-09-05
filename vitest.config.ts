import { fileURLToPath } from "node:url";
import { AgentPlugin, DefaultDiscoverStrategy } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

// Global coverage thresholds are enforced on CI and on an explicit `--coverage`
// run, and nowhere else. They measure the whole repo, so a filtered run
// (`vitest run <path>`, `--project <name>`) fails them by construction even when
// every test it selected passed — which makes the exit code carry no information
// on exactly the runs developers and agents make most often. Once "a subset run
// always exits 1" is learned, the only remaining signal is the `Tests:` line,
// where a zero-collection run reads as `0/0 passed` and looks like success.
// Enforcing here restores the exit code as a real signal locally; `ci:test` runs
// the whole suite with CI set, so nothing is weakened where it counts.
const enforceCoverageThresholds = Boolean(process.env.CI) || process.argv.includes("--coverage");

export default async () => {
	// Scratchpad is a local-only probe venue: discovered as a normal project on
	// dev machines, invisible to ci:test.
	const strategy = new DefaultDiscoverStrategy().extend({
		buildProject: async (input, inherited) => (input.name === "scratchpad" && process.env.CI ? null : inherited),
	});
	const { projects, tags } = await AgentPlugin.discover(strategy);
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: {
					human: "stream",
					agent: "agent",
				},
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.basic.coverageTargets,
			}),
		],
		test: {
			...(projects ? { projects } : {}),
			tags,
			pool: "forks",
			// Resolved against THIS file, not the cwd. A bare relative path here
			// resolves against wherever vitest was invoked, so running from inside
			// a package died with `Failed to load url .../packages/<pkg>/vitest.setup.ts`
			// — an error that reads as a missing file you were meant to create,
			// whose tempting "fix" is to create a per-package setup and fork it
			// permanently (effected#455).
			//
			// Vitest walks up from the cwd to find this config and anchors its
			// root here, so far less is cwd-sensitive than the folklore claims.
			// Measured from inside `packages/lockfiles`:
			//   vitest run                        -> the WHOLE repo, 12298/12298, exit 0
			//   vitest run --project @effected/lockfiles -> 143/143, exit 0
			//   vitest run --project @effected/walker    -> 75/75,  exit 0  (a DIFFERENT
			//        package, so this is config-root anchoring, not the filter
			//        happening to match the directory you stand in)
			//   vitest run packages/lockfiles     -> 0/0 collected, exit 1
			//   vitest run __test__               -> the WHOLE repo, exit 0
			// Only POSITIONAL filters are cwd-sensitive, and not as a path: they
			// are matched as a substring of each test file's path as rendered
			// from the cwd. `packages/<pkg>` therefore matches from the root and
			// matches nothing from inside that package, while `__test__` matches
			// every project from anywhere. Prefer `--project <name>`.
			globalSetup: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))],
			coverage: {
				enabled: true,
				provider: "v8",
				...(enforceCoverageThresholds ? { thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds } : {}),
				exclude: ["scratchpad/**"],
			},
		},
	});
};
