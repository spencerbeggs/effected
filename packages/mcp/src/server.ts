import type { Distribution } from "@effected/kit";
import { McpStdio, McpToolkit } from "@effected/mcp-kit";
import type { FileSystem, Path, Scope, Stdio } from "effect";
import { Effect, Layer } from "effect";
import type { McpServer } from "effect/ai";
import { McpProtocol, Toolkit } from "effect/ai";
import { handleIdentity, identity } from "./tools/identity.js";
import type { SchemaToolOptions } from "./tools/schema.js";
import { makeSchemaHandlers, schemaBuild, schemaCheck, schemaValidate } from "./tools/schema.js";
import { MCP_VERSION } from "./version.js";

/**
 * Options `ServerLayer` accepts. `distribution` names the carrier
 * package the server was launched through; omitted for a direct install of
 * `@effected/mcp`. The rest is what the schema tools take from the process.
 *
 * @public
 */
export interface ServerOptions extends SchemaToolOptions {
	readonly distribution?: Distribution;
}

/**
 * Agent-facing orientation, surfaced as `instructions` in both the
 * `initialize` and `server/discover` results.
 *
 * @public
 */
export const SERVER_INSTRUCTIONS: string =
	"effected-mcp serves the effected tool. Call identity to learn the tool name, this server's version, the distribution it was launched through and the resolved effect version. schema_check reports whether the generated schema documents match the config and writes nothing, schema_build writes them, and schema_validate checks a JSON payload against one. Drift, staleness and a failed validation arrive as results (a verdict, or valid: false), not as errors; an error means the config could not be found or loaded, a path was outside the workspace root, or the run could not finish. Each call reloads the config and the TypeScript and JSON it imports, but an imported .mjs, .cjs or built .js under type: module stays cached, so restart this server after rebuilding a sibling package the config uses.";

/**
 * The whole server as one layer: the toolkit over the kit's `McpStdio.layer`,
 * its schema handlers capturing `FileSystem` and `Path` when they are built.
 * The adapters are listed newest first, as the kit's
 * default lists them; a client that opens with `initialize` needs the
 * stateful ones.
 *
 * @public
 */
export const ServerLayer = (
	options: ServerOptions = {},
): Layer.Layer<
	McpServer.McpServer | McpServer.McpRequest<"Requires", Scope.Scope>,
	never,
	Stdio.Stdio | FileSystem.FileSystem | Path.Path
> => {
	const EffectedToolkit = Toolkit.make(identity, schemaCheck, schemaBuild, schemaValidate);
	const handlers = EffectedToolkit.toLayer(
		Effect.map(makeSchemaHandlers(options), (schema) => ({
			identity: () => handleIdentity(options.distribution),
			...schema,
		})),
	);
	return McpStdio.layer({
		name: "effected",
		version: MCP_VERSION,
		instructions: SERVER_INSTRUCTIONS,
		// Fixed for the server's lifetime, so a client need not list them on every turn.
		cacheHints: { tools: { ttl: "1 hour", cacheScope: "private" } },
		protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
		registrations: McpToolkit.layer(EffectedToolkit).pipe(Layer.provide(handlers)),
	});
};
