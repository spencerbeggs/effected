import type { PlatformError } from "effect";
import { Effect } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
	DEFAULT_CLIENT_INFO,
	STDERR_HINT,
	frame,
	initializeParams,
	isJsonRpcMessage,
	isResponse,
	isStateless,
	parseFrame,
} from "./internal/wire.js";
import { McpProcess } from "./McpProcess.js";
import { McpTestFailure } from "./McpTestFailure.js";
import type { JsonRpcMessage } from "./McpWire.js";
import { ToolFailure } from "./ToolFailure.js";

/**
 * Options for {@link McpProbe.initialize}.
 *
 * @public
 */
export interface McpProbeOptions {
	/** Defaults to `McpProtocol.v2025_11_25`; a stateless adapter probes with `server/discover`. */
	readonly protocol?: McpProtocol.ProtocolAdapter | undefined;
}

/**
 * What {@link McpProbe.initialize} observed.
 *
 * @public
 */
export interface McpProbeResult {
	/** The id-1 response. A refused handshake is still a response: assert `response.error === undefined`. */
	readonly response: JsonRpcMessage;
	/** Every raw stdout line, in order. */
	readonly stdout: ReadonlyArray<string>;
	/** Everything the child wrote to stderr; a clean boot leaves it empty. */
	readonly stderr: string;
	/** The child's exit code after stdin closed; a clean boot exits 0. */
	readonly exitCode: number;
}

/**
 * The smallest proof that an installed MCP bin boots: one initialize, a clean
 * close, and exit 0.
 *
 * @remarks
 * Stdin stays open until the id-1 response has arrived. Closing it right
 * after writing, as every hand-rolled smoke test did, makes an Effect server
 * drop the in-flight response and exit 0, so a slow boot reads as a pass with
 * no response. The caller asserts `response.error === undefined`, `stderr` is
 * empty and `exitCode` is 0; this is the MCP half of a packed-install proof.
 * Checking stderr and the exit code alone passes a server that answers
 * the handshake with a JSON-RPC error, exits 0 and writes nothing.
 *
 * - Any stdout line that is not JSON-RPC fails with `NotJsonRpc`, naming the
 *   line: a server that logs to stdout corrupts the wire, so the probe fails
 *   rather than skipping the line.
 * - A child that exits before responding fails with `StreamEnded`, and the
 *   message carries its exit code and stderr.
 * - A child that ignores stdin EOF never exits, and the probe waits for it.
 *   Wrap the probe in `Effect.timeout`.
 *
 * @public
 */
export class McpProbe {
	private constructor() {}

	/**
	 * Spawn `command`, send one `initialize` (or `server/discover` on a
	 * stateless revision) as id 1, wait for its response, close stdin, and
	 * collect stdout, stderr and the exit code.
	 */
	static readonly initialize = (
		command: ChildProcess.Command,
		options: McpProbeOptions = {},
	): Effect.Effect<
		McpProbeResult,
		McpTestFailure | PlatformError.PlatformError,
		ChildProcessSpawner.ChildProcessSpawner
	> =>
		Effect.scoped(
			Effect.gen(function* () {
				const child = yield* McpProcess.spawn(command);
				const protocol = options.protocol ?? McpProtocol.v2025_11_25;
				const stateless = isStateless(protocol);
				yield* child.send(
					frame(
						protocol,
						DEFAULT_CLIENT_INFO,
						stateless ? "server/discover" : "initialize",
						stateless ? {} : initializeParams(protocol, DEFAULT_CLIENT_INFO),
						1,
					),
				);
				const stdout: Array<string> = [];
				// Every stdout line must be JSON-RPC: the probe proves the wire is clean.
				const read = Effect.gen(function* () {
					const line = yield* child.nextLine;
					stdout.push(line);
					const message = parseFrame(line);
					if (!isJsonRpcMessage(message)) {
						return yield* new McpTestFailure({
							reason: "NotJsonRpc",
							message: `stdout carried a line that is not JSON-RPC: ${ToolFailure.truncate(line)}`,
						});
					}
					return message;
				});
				// Once stdout has ended the exit code and stderr are settled; fold them
				// into the failure, because the caller holds no handle to read them.
				const diagnose = (failure: McpTestFailure) =>
					failure.reason !== "StreamEnded"
						? Effect.fail(failure)
						: Effect.gen(function* () {
								const code = yield* child.exitCode;
								const stderr = yield* child.stderrFinal;
								return yield* new McpTestFailure({
									reason: "StreamEnded",
									message: `${failure.message.replace(STDERR_HINT, "")}; the child exited with code ${code}; stderr: ${
										stderr === "" ? "(empty)" : ToolFailure.truncate(stderr)
									}`,
								});
							});
				let response: JsonRpcMessage | undefined;
				while (response === undefined) {
					const message = yield* Effect.catch(read, diagnose);
					if (isResponse(message) && message.id === 1) response = message;
				}
				yield* child.closeStdin;
				const exitCode = yield* child.exitCode;
				while (true) {
					const rest = yield* Effect.catch(
						Effect.map(read, () => true),
						(failure) => (failure.reason === "StreamEnded" ? Effect.succeed(false) : Effect.fail(failure)),
					);
					if (!rest) break;
				}
				return { response, stdout, stderr: yield* child.stderrFinal, exitCode };
			}),
		);
}
