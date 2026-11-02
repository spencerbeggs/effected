import { Identity, IdentityReport } from "@effected/engine";
import type { Distribution } from "@effected/kit";
import { Effect } from "effect";
import { Tool } from "effect/ai";
import { MCP_VERSION } from "../version.js";

/**
 * The `identity` tool: what the `effected` tool reports about itself, the
 * same report the `effected` command prints.
 *
 * @public
 */
export const identity = Tool.make("identity", {
	description:
		"Reports the effected tool's identity: the tool name, this server's version, the carrier distribution it was launched through (null for a direct install), and the resolved effect version.",
	parameters: Tool.EmptyParams,
	success: IdentityReport,
})
	.annotate(Tool.Title, "Effected identity")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * The `identity` handler, closed over the carrier distribution.
 *
 * @public
 */
export const handleIdentity = (distribution: Distribution | undefined) =>
	Effect.suspend(() => Identity.report({ version: MCP_VERSION, distribution: distribution ?? null }));
