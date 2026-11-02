import type { Distribution } from "@effected/kit";
import { McpStdio, McpToolkit } from "@effected/mcp-kit";
import type { Scope, Stdio } from "effect";
import { Layer } from "effect";
import type { McpServer } from "effect/ai";
import { McpProtocol, Toolkit } from "effect/ai";
import { handleIdentity, identity } from "./tools/identity.js";
import { MCP_VERSION } from "./version.js";

/**
 * Options `ServerLayer` accepts. `distribution` names the carrier
 * package the server was launched through; omitted for a direct install of
 * `@effected/mcp`.
 *
 * @public
 */
export interface ServerOptions {
	readonly distribution?: Distribution;
}

/**
 * Agent-facing orientation, surfaced as `instructions` in both the
 * `initialize` and `server/discover` results.
 *
 * @public
 */
export const SERVER_INSTRUCTIONS: string =
	"effected-mcp serves the effected tool. Call identity to learn the tool name, this server's version, the distribution it was launched through and the resolved effect version.";

/**
 * The whole server as one layer: the `identity` toolkit over the kit's
 * `McpStdio.layer`. The adapters are listed newest first, as the kit's
 * default lists them; a client that opens with `initialize` needs the
 * stateful ones.
 *
 * @public
 */
export const ServerLayer = (
	options: ServerOptions = {},
): Layer.Layer<McpServer.McpServer | McpServer.McpRequest<"Requires", Scope.Scope>, never, Stdio.Stdio> => {
	const EffectedToolkit = Toolkit.make(identity);
	const handlers = EffectedToolkit.toLayer({ identity: () => handleIdentity(options.distribution) });
	return McpStdio.layer({
		name: "effected",
		version: MCP_VERSION,
		instructions: SERVER_INSTRUCTIONS,
		protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
		registrations: McpToolkit.layer(EffectedToolkit).pipe(Layer.provide(handlers)),
	});
};
