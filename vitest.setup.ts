import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	// `AgentPlugin.runScript` skips its command outright when the done-marker it wrote on the last
	// success is younger than VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS (30 s by default). That
	// short-circuit is meant for a concurrent waiter trusting the winner's build, but it applies to
	// the NEXT sequential run too: a src edit between two runs inside the window never reached
	// `dist/dev`, and the downstream tests read the stale build (effected#1084). A 1 ms window keeps
	// the lock's serialization and drops the trust; turbo's cache makes the re-run a fast no-op.
	process.env.VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS ??= "1";
	// `@effected/ai-plugin`'s build:dev is `pluginfinity build`, which regenerates the committed
	// plugin/builds/{claude,copilot} trees. A test run must not rewrite committed files; `plugin:check`
	// stays the gate for that tree (effected#1084).
	AgentPlugin.runScript("pnpm exec turbo run build:dev --filter '!@effected/ai-plugin' --output-logs=errors-only");
}
