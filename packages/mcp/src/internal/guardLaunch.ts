import { Effect } from "effect";
import type { McpGuardedServer } from "../McpGuard.js";
import { McpStdio } from "../McpStdio.js";

/**
 * The server half of `McpGuard.run`, reached only through a dynamic import so
 * the guard module itself evaluates nothing but its own code.
 *
 * @internal
 */
export const launchGuarded = <ROut, E>(server: McpGuardedServer<ROut, E>, onReady: () => void): void =>
	server.runMain(McpStdio.launch(server.layer, { onReady: Effect.sync(onReady) }), {
		teardown: McpStdio.teardown,
	});
