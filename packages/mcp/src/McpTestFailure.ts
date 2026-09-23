import { Schema } from "effect";

/**
 * Why an MCP test client could not produce what was asked of it.
 *
 * @remarks
 * - `StreamEnded`: the server's stdout ended first; the child exited.
 * - `ServerStopped`: the in-process server stopped, usually because stdin
 *   closed while the request was in flight.
 * - `NotJsonRpc`: a stdout line was not a JSON-RPC frame.
 * - `ErrorResponse`: the server answered with a JSON-RPC error where a
 *   result was required.
 *
 * @public
 */
export class McpTestFailure extends Schema.TaggedError<McpTestFailure>()("McpTestFailure", {
	reason: Schema.Literals(["StreamEnded", "ServerStopped", "NotJsonRpc", "ErrorResponse"]),
	message: Schema.String,
}) {}
