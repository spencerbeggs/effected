import { fileURLToPath } from "node:url";
import { AgentPlugin, DefaultDiscoverStrategy } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

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
			// resolves against wherever vitest was invoked, so a run from inside a
			// package that points `--config` here dies with
			// `Failed to load url .../packages/<pkg>/vitest.setup.ts`
			// — an error that reads as a missing file you were meant to create,
			// whose tempting "fix" is to create a per-package setup and fork it
			// permanently (effected#455).
			//
			// Vitest does NOT walk up to this config: run from inside a package it
			// uses that directory as its root with no repo config. Measured from
			// inside `packages/lockfiles`:
			//   vitest run                               -> that package only, default reporter, exit 0
			//   vitest run --project @effected/lockfiles -> "No projects matched the filter", exit 1
			//   vitest run packages/lockfiles            -> "No test files found", exit 1
			// From the repo root, `--project <name>` selects one project, and a
			// POSITIONAL filter is a substring of each test file's path (`ckfiles`
			// selects lockfiles). Run from the root; prefer `--project <name>`.
			globalSetup: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))],
			coverage: {
				enabled: true,
				provider: "v8",
				thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds,
				exclude: ["scratchpad/**"],
			},
		},
	});
};
