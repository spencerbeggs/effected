/**
 * The assembled `effected-mcp` server program.
 *
 * @packageDocumentation
 */

import type { Distribution } from "@effected/kit";
import { McpGuard } from "@effected/mcp-kit/guard";

/**
 * Options a carrier's bin shim passes to `main`. `distribution` names
 * the package the `effected-mcp` bin was installed through; omitted for a
 * direct install of `@effected/mcp`.
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/**
 * Run the `effected-mcp` server over stdio. Owns the process.
 *
 * `McpGuard.run` installs the crash guards before `load` evaluates the server
 * graph, so a throw during module evaluation is still reported on stderr; this
 * module therefore carries no static runtime import (`Distribution` is
 * type-only). Policy is `exitBeforeConnect` for both events: the one tool is
 * read-only and stateless, so a stray error while serving has no state to
 * corrupt and the guard logs and keeps serving, while the same error before
 * serving means a broken boot and exits `1`. Nothing here writes to stdout;
 * it is the JSON-RPC wire.
 *
 * @public
 */
export const main = (options: MainOptions = {}): Promise<void> =>
	McpGuard.run({
		label: "effected-mcp",
		host: process,
		policy: { onUncaught: "exitBeforeConnect", onRejection: "exitBeforeConnect" },
		load: async () => {
			// No static imports of the server graph above this line.
			const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
			const NodeStdio = await import("@effect/platform-node/NodeStdio");
			const { Layer } = await import("effect");
			const { ServerLayer } = await import("./server.js");

			const layer = ServerLayer(options).pipe(Layer.provide(NodeStdio.layer));
			return { layer, runMain: NodeRuntime.runMain };
		},
	});
