import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	// `@effected/ai-plugin`'s build:dev is `pluginfinity build`, which regenerates the committed
	// plugin/builds/{claude,copilot} trees. A test run must not rewrite committed files; `plugin:check`
	// stays the gate for that tree (effected#1084).
	AgentPlugin.runScript("pnpm exec turbo run build:dev --filter '!@effected/ai-plugin' --output-logs=errors-only");
}
