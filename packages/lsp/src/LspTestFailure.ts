import { Schema } from "effect";

/**
 * Why {@link LspProbe.initialize} could not prove a Language Server boots.
 *
 * @remarks
 * - `StreamEnded`: the server's stdout ended before the response the probe
 *   was waiting for, usually because it exited; a stream that ended inside a
 *   frame lands here too. The message carries the exit code and stderr.
 * - `InvalidFrame`: stdout carried bytes that are not an LSP frame — most
 *   often a log line written to stdout, which is the protocol wire. The
 *   message carries the frame error, excerpt included.
 * - `NotJsonRpc`: a well-framed body that is not a JSON-RPC 2.0 message.
 * - `TimedOut`: the exchange outlived `LspProbeOptions.timeout`. The message
 *   names the step the probe was waiting on and the stderr so far; a server
 *   that ignores `exit` and waits for stdin to close fails here.
 *
 * A JSON-RPC error answering `initialize` or `shutdown` is not a failure: it
 * is returned in the result for the caller to assert on.
 *
 * @public
 */
export class LspTestFailure extends Schema.TaggedError<LspTestFailure>()("LspTestFailure", {
	/** Which failure occurred; see the list above. */
	reason: Schema.Literals(["StreamEnded", "InvalidFrame", "NotJsonRpc", "TimedOut"]),
	/** A human-readable description of what went wrong. */
	message: Schema.String,
}) {}
