import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	// `AgentPlugin.runScript` skips its command outright when the done-marker it wrote on the last
	// success is younger than VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS (30 s by default). That
	// short-circuit is meant for a concurrent waiter trusting the winner's build, but it applies to
	// the NEXT sequential run too: a src edit between two runs inside the window never reached
	// `dist/prod`, and the downstream tests read the stale build (effected#1084). A 1 ms window keeps
	// the lock's serialization and drops the trust; turbo's cache makes the re-run a fast no-op.
	process.env.VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS ??= "1";
	// Workspace links resolve to source, so only the packages whose tests read their own `dist` build here. The
	// filter is named rather than the whole workspace because `@effected/ai-plugins`'s build rewrites the committed
	// plugin/builds trees, and a test run must not rewrite committed files (effected#1084).
	AgentPlugin.runScript(
		"pnpm exec turbo run build --filter '@effected/plugin...' --filter @effected/pnpm-plugin-effected --filter @effected/cli-kit --filter @effected/config-file --filter @effected/kit --filter @effected/commands --filter @effected/npm --output-logs=errors-only",
	);
}
