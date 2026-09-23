import { Result } from "effect";
import type { McpProtocol } from "effect/unstable/ai";
import type { JsonRpcMessage } from "../McpWire.js";

/** @internal */
export interface ClientInfo {
	readonly name: string;
	readonly version: string;
}

/** @internal */
export const DEFAULT_CLIENT_INFO: ClientInfo = { name: "effected-mcp-testing", version: "0.0.0" };

const isRecord = (u: unknown): u is { readonly [key: string]: unknown } =>
	typeof u === "object" && u !== null && !Array.isArray(u);

/**
 * The pointer `McpProcess` appends to a `StreamEnded` message. `McpProbe`
 * strips it: the probe folds stderr into its own message, so the pointer is
 * stale there.
 *
 * @internal
 */
export const STDERR_HINT = "; read stderrFinal for why";

/** @internal */
export const parseFrame = (line: string): unknown =>
	Result.getOrUndefined(Result.try(() => JSON.parse(line) as unknown));

/** @internal */
export const isJsonRpcMessage = (u: unknown): u is JsonRpcMessage => isRecord(u) && u.jsonrpc === "2.0";

/** @internal */
export const isResponse = (message: JsonRpcMessage): message is JsonRpcMessage & { readonly id: string | number } =>
	(typeof message.id === "string" || typeof message.id === "number") && message.method === undefined;

/** @internal */
export const requestKey = (id: string | number): string => `${typeof id}:${id}`;

/** @internal */
export const isStateless = (protocol: McpProtocol.ProtocolAdapter): boolean => protocol.runtime._tag === "Stateless";

/**
 * A request (with `id`) or notification frame. On the stateless revision every
 * frame carries the protocol fields under `params._meta`, with any `_meta`
 * the caller passed spread over them, so the caller wins. That matches core's
 * own harness (`McpStdioHarness.ts`, `withRequestMetadata`) and lets a test
 * send a deliberately wrong revision.
 *
 * @internal
 */
export const frame = (
	protocol: McpProtocol.ProtocolAdapter,
	clientInfo: ClientInfo,
	method: string,
	params: unknown,
	id?: number,
): JsonRpcMessage => {
	const withMeta = () => {
		const base = isRecord(params) ? params : {};
		const caller = isRecord(base._meta) ? base._meta : {};
		return {
			...base,
			_meta: {
				"io.modelcontextprotocol/protocolVersion": protocol.protocolVersion,
				"io.modelcontextprotocol/clientCapabilities": {},
				"io.modelcontextprotocol/clientInfo": clientInfo,
				...caller,
			},
		};
	};
	return {
		jsonrpc: "2.0",
		...(id === undefined ? {} : { id }),
		method,
		...(isStateless(protocol) ? { params: withMeta() } : params === undefined ? {} : { params }),
	};
};

/** @internal */
export const initializeParams = (protocol: McpProtocol.ProtocolAdapter, clientInfo: ClientInfo) => ({
	protocolVersion: protocol.protocolVersion,
	capabilities: {},
	clientInfo,
});
