import type { Distribution } from "@effected/kit";
import { Exclusive } from "@effected/kit";
import { McpStdio, McpToolkit } from "@effected/mcp-kit";
import type { FileSystem, Path, Scope, Stdio } from "effect";
import { Effect, Layer } from "effect";
import type { McpServer } from "effect/ai";
import { McpProtocol, Toolkit } from "effect/ai";
import { actionBuild, actionInit, makeActionHandlers } from "./tools/action.js";
import { handleIdentity, identity } from "./tools/identity.js";
import type { PackageToolOptions } from "./tools/package.js";
import { makePackageHandlers, packageBuild } from "./tools/package.js";
import type { SchemaToolOptions } from "./tools/schema.js";
import { makeSchemaHandlers, schemaBuild, schemaCheck, schemaValidate } from "./tools/schema.js";
import { MCP_VERSION } from "./version.js";

/**
 * Options `ServerLayer` accepts. `distribution` names the carrier
 * package the server was launched through; omitted for a direct install of
 * `@effected/mcp`. The rest is what the schema and package tools take from the process.
 *
 * @public
 */
export interface ServerOptions extends SchemaToolOptions, PackageToolOptions {
	readonly distribution?: Distribution;
}

/**
 * Agent-facing orientation, surfaced as `instructions` in both the
 * `initialize` and `server/discover` results.
 *
 * @public
 */
export const SERVER_INSTRUCTIONS: string =
	"effected-mcp serves the effected tool. Call identity to learn the tool name, this server's version, the distribution it was launched through and the resolved effect version. schema_check reports whether the generated schema documents match the config and writes nothing, schema_build writes them, and schema_validate checks a JSON payload against one. Drift, staleness and a failed validation arrive as results (a verdict, or valid: false), not as errors; an error means the config could not be found or loaded, a path was outside the workspace root, or the run could not finish. Each call reloads the config and the TypeScript and JSON it imports, but an imported .mjs, .cjs or built .js under type: module stays cached, so restart this server after rebuilding a sibling package the config uses. package_build builds one package into its dist/prod; a build that crashes or records an error arrives as the verdict failed with its issues, not as an error, and an error means the effected.toml or a plugin would not load, the directory is not a package, or it was outside the workspace root. action_build builds one GitHub Action from the [action] table of its effected.toml into its dist; validation stopping the build or an entry failing to bundle or load arrives as the verdict failed with what it found, not as an error, and an error means the effected.toml would not load, it has no [action] table, the directory is not a package or is outside the workspace root, or a file could not be written. It writes only dist unless persist is true, which also writes .github/actions/local, .actrc and .github/workflows/act-test.yml. Unless [action.build] importCheck is false, it imports each bundle to prove it loads, which runs an action with no GITHUB_ACTIONS guard around its program; importCheck = false in a worker's own [action.entries.workers.<name>] table skips that worker alone. action_init scaffolds a new action in a package directory (effected.toml's [action] table, action.yml, src/main.ts, src/program.ts, tsconfig.json) ready for action_build; it refuses, writing nothing, when any of those files exists unless force is true, and always when one is a symbolic link or the wrong kind of entry, and it edits no package.json, naming the dependencies to add instead.";

/**
 * The whole server as one layer: the toolkit over the kit's `McpStdio.layer`,
 * its handlers capturing `FileSystem` and `Path` when they are built.
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
	const EffectedToolkit = Toolkit.make(
		identity,
		schemaCheck,
		schemaBuild,
		schemaValidate,
		packageBuild,
		actionBuild,
		actionInit,
	);
	const handlers = EffectedToolkit.toLayer(
		Effect.gen(function* () {
			// One lane for every tool that builds a package, because two builds in one tree would clobber each other's dist.
			const buildLane = yield* Exclusive.make;
			return {
				identity: () => handleIdentity(options.distribution),
				...(yield* makeSchemaHandlers(options)),
				...(yield* makePackageHandlers(options, buildLane)),
				...(yield* makeActionHandlers(options, buildLane)),
			};
		}),
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
