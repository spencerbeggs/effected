import type { PlatformError } from "effect";
import { Effect, Result } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
	DEFAULT_CLIENT_INFO,
	frame,
	initializeParams,
	isJsonRpcMessage,
	isResponse,
	isStateless,
	parseFrame,
} from "./internal/wire.js";
import { McpProcess } from "./McpProcess.js";
import type { McpTestFailure } from "./McpTestFailure.js";
import type { JsonRpcMessage } from "./McpWire.js";

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
	/** The id-1 response. */
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
 * no response. The caller asserts `stderr` is empty and `exitCode` is 0; this
 * is the MCP half of a packed-install proof.
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
				let response: JsonRpcMessage | undefined;
				while (response === undefined) {
					const line = yield* child.nextLine;
					stdout.push(line);
					const message = parseFrame(line);
					if (isJsonRpcMessage(message) && isResponse(message) && message.id === 1) response = message;
				}
				yield* child.closeStdin;
				const exitCode = yield* child.exitCode;
				while (true) {
					const rest = yield* Effect.result(child.nextLine);
					if (Result.isFailure(rest)) break;
					stdout.push(rest.success);
				}
				return { response, stdout, stderr: yield* child.stderrFinal, exitCode };
			}),
		);
}
