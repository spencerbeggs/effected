import { Schema } from "effect";

/**
 * Why an MCP test client could not produce what was asked of it.
 *
 * @remarks
 * Each reason is raised by a specific client, and not every client raises
 * every reason:
 *
 * - `StreamEnded` (`McpProcess`, `McpProbe`): the spawned child's stdout
 *   ended first, because the child exited. `McpProbe` folds the exit code
 *   and stderr into the message.
 * - `NotJsonRpc` (`McpProcess.readUntilResponse`, `McpProbe`): a spawned
 *   child's stdout line was not a JSON-RPC frame. `McpHarness` never raises
 *   it: under `strictStdout` a non-JSON-RPC line DIES the pending wait as a
 *   defect instead, so assert it with `Effect.exit` and `Cause.hasDies`,
 *   not `catchTag`.
 * - `ServerStopped` (`McpHarness`): the in-process server stopped, usually
 *   because stdin closed while the request was in flight.
 * - `NotInitialized` (`McpHarness`): a request other than `initialize` was
 *   made on a stateful revision before `initialize` was sent. The request
 *   is never written; the server would only have refused it opaquely:
 *   `-32602 Invalid request metadata` when a stateless adapter is listed
 *   first, `-32603 Internal error` when only stateful revisions are served.
 * - `ErrorResponse` (`McpHarness.listTools`): the server answered with a
 *   JSON-RPC error where a result was required. Every other request method
 *   returns the whole response, error included, as data.
 *
 * @public
 */
export class McpTestFailure extends Schema.TaggedError<McpTestFailure>()("McpTestFailure", {
	reason: Schema.Literals(["StreamEnded", "ServerStopped", "NotJsonRpc", "NotInitialized", "ErrorResponse"]),
	message: Schema.String,
}) {}
