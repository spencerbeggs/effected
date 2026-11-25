import { AgentPlugin } from "@vitest-agent/plugin";
import { buildCommand } from "./lib/scripts/test-builds.js";
import { parseTier } from "./lib/scripts/test-tiers.js";

export function setup() {
	// The way to measure which packages a tier reads built output from (see lib/scripts/test-builds.ts): with this
	// set and the build output removed, whatever fails is what needs building. Never set it to make a run faster.
	if (process.env.EFFECTED_TEST_NO_BUILD === "1") return;
	// `AgentPlugin.runScript` skips its command outright when the done-marker it wrote on the last
	// success is younger than VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS (30 s by default). That
	// short-circuit is meant for a concurrent waiter trusting the winner's build, but it applies to
	// the NEXT sequential run too: a src edit between two runs inside the window never reached
	// `dist/prod`, and the downstream tests read the stale build (effected#1084). A 1 ms window keeps
	// the lock's serialization and drops the trust; turbo's cache makes the re-run a fast no-op.
	process.env.VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS ??= "1";
	// Workspace links resolve to source, so only the packages whose tests read their own built output build here:
	// the measured list for the tier this run selects, and the packed-install closure too when the run includes the
	// slow files. The list and why it is what it is live in lib/scripts/test-builds.ts.
	AgentPlugin.runScript(`pnpm exec ${buildCommand(parseTier(process.env.EFFECTED_TEST_TIER)).join(" ")}`);
}
