import { AgentPlugin } from "@vitest-agent/plugin";

export function setup() {
	AgentPlugin.runScript("pnpm exec turbo run build:dev --output-logs=errors-only");
}
