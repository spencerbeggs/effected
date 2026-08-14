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
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
				thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds,
				exclude: ["scratchpad/**"],
			},
		},
	});
};
