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
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
				...(enforceCoverageThresholds ? { thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds } : {}),
				exclude: ["scratchpad/**"],
			},
		},
	});
};
