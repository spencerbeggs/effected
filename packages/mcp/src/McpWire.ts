import type { JsonSchema } from "effect";

/**
 * One JSON-RPC 2.0 frame as an MCP test client sees it.
 *
 * @public
 */
export interface JsonRpcMessage {
	readonly jsonrpc: "2.0";
	readonly id?: string | number | null | undefined;
	readonly method?: string | undefined;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

/**
 * One entry of a `tools/list` result.
 *
 * @public
 */
export interface ServedTool {
	readonly name: string;
	readonly title?: string | undefined;
	readonly description?: string | undefined;
	readonly inputSchema: JsonSchema.JsonSchema;
	readonly outputSchema?: JsonSchema.JsonSchema | undefined;
	readonly annotations?: { readonly [key: string]: unknown } | undefined;
	readonly _meta?: { readonly [key: string]: unknown } | undefined;
}
