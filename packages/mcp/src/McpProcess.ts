import type { Cause, PlatformError, Scope } from "effect";
import { Deferred, Effect, Queue, Ref, Stream } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process";
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
import { McpTestFailure } from "./McpTestFailure.js";
import type { JsonRpcMessage } from "./McpWire.js";
import { ToolFailure } from "./ToolFailure.js";

interface ProcessParts {
	readonly send: (message: unknown) => Effect.Effect<void>;
	readonly nextLine: Effect.Effect<string, McpTestFailure>;
	readonly readUntilResponse: (
		id: string | number,
	) => Effect.Effect<
		{ readonly response: JsonRpcMessage; readonly seen: ReadonlyArray<JsonRpcMessage> },
		McpTestFailure
	>;
	readonly handshake: (protocol?: McpProtocol.ProtocolAdapter) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly closeStdin: Effect.Effect<void>;
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	readonly stderrSoFar: Effect.Effect<string>;
	readonly stderrFinal: Effect.Effect<string>;
}

/**
 * A spawned MCP server bin a test writes to while it runs.
 *
 * @remarks
 * Build the command in the test file with `execPath` and an explicit `env`:
 * `ChildProcess.make(process.execPath, [bin], { env })`.
 *
 * - `nextLine` fails with `StreamEnded` when stdout ends, so a child that
 *   exits early fails the test instead of hanging it.
 * - `readUntilResponse` reads past interleaved notifications, such as
 *   `list_changed`, to the matching id and returns what it saw.
 * - `closeStdin` is `Queue.end`, never `Queue.shutdown`, so every frame
 *   already sent is delivered before stdin closes.
 * - A request in flight when stdin closes is dropped by an Effect server:
 *   read its response first.
 *
 * @public
 */
export class McpProcess {
	/**
	 * Write one JSON-encoded, newline-framed message to the child's stdin.
	 *
	 * @remarks
	 * Never fails. A frame sent after `closeStdin` is dropped, and a write the
	 * child can no longer receive fails the stdin pump instead; the next
	 * `StreamEnded` message names that failure.
	 */
	readonly send: (message: unknown) => Effect.Effect<void>;
	/** The next non-empty stdout line; fails with `StreamEnded` once stdout ends. */
	readonly nextLine: Effect.Effect<string, McpTestFailure>;
	/** Read JSON-RPC lines up to and including the response with this id. */
	readonly readUntilResponse: (
		id: string | number,
	) => Effect.Effect<
		{ readonly response: JsonRpcMessage; readonly seen: ReadonlyArray<JsonRpcMessage> },
		McpTestFailure
	>;
	/** `initialize` (id 1) then `notifications/initialized`, or `server/discover` (id 1) on a stateless revision. Use ids of 2 or more for your own requests. */
	readonly handshake: (protocol?: McpProtocol.ProtocolAdapter) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** End stdin after every frame already sent. */
	readonly closeStdin: Effect.Effect<void>;
	/** Wait for the child to exit. */
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	/** Everything written to stderr so far. */
	readonly stderrSoFar: Effect.Effect<string>;
	/** Everything written to stderr, once stderr has ended. Waits for the child to exit. */
	readonly stderrFinal: Effect.Effect<string>;

	private constructor(parts: ProcessParts) {
		this.send = parts.send;
		this.nextLine = parts.nextLine;
		this.readUntilResponse = parts.readUntilResponse;
		this.handshake = parts.handshake;
		this.closeStdin = parts.closeStdin;
		this.exitCode = parts.exitCode;
		this.stderrSoFar = parts.stderrSoFar;
		this.stderrFinal = parts.stderrFinal;
	}

	/** Spawn `command` for the life of the current scope. */
	static readonly spawn = (
		command: ChildProcess.Command,
	): Effect.Effect<McpProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const encoder = new TextEncoder();

			const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
			// The pump's failure (EPIPE once the child is gone) is recorded, not
			// raised: `send` stays never-failing and StreamEnded reports it.
			const stdinFailure = yield* Ref.make<string | undefined>(undefined);
			yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(
				Effect.catch((error) => Ref.set(stdinFailure, error.message)),
				Effect.forkScoped,
			);

			const lines = yield* Queue.unbounded<string, Cause.Done>();
			yield* Stream.splitLines(Stream.decodeText(handle.stdout)).pipe(
				Stream.runForEach((line) => (line.length === 0 ? Effect.void : Effect.asVoid(Queue.offer(lines, line)))),
				Effect.ensuring(Queue.end(lines)),
				Effect.forkScoped,
			);

			const stderr = yield* Ref.make("");
			const stderrDone = yield* Deferred.make<void>();
			yield* Stream.decodeText(handle.stderr).pipe(
				Stream.runForEach((text) => Ref.update(stderr, (sofar) => sofar + text)),
				Effect.ensuring(Deferred.succeed(stderrDone, undefined)),
				Effect.forkScoped,
			);

			const nextLine = Queue.take(lines).pipe(
				Effect.catch(() =>
					Effect.flatMap(Ref.get(stdinFailure), (pump) =>
						Effect.fail(
							new McpTestFailure({
								reason: "StreamEnded",
								message: `the server's stdout ended before the expected line${STDERR_HINT}${
									pump === undefined ? "" : `; stdin pump failed: ${ToolFailure.truncate(pump)}`
								}`,
							}),
						),
					),
				),
			);
			const readUntilResponse = (id: string | number) =>
				Effect.gen(function* () {
					const seen: Array<JsonRpcMessage> = [];
					while (true) {
						const line = yield* nextLine;
						const message = parseFrame(line);
						if (!isJsonRpcMessage(message)) {
							return yield* new McpTestFailure({
								reason: "NotJsonRpc",
								message: `stdout carried a line that is not JSON-RPC: ${ToolFailure.truncate(line)}`,
							});
						}
						seen.push(message);
						if (isResponse(message) && message.id === id) return { response: message, seen };
					}
				});
			const send = (message: unknown): Effect.Effect<void> =>
				Effect.asVoid(Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`)));
			const handshake = (protocol: McpProtocol.ProtocolAdapter = McpProtocol.v2025_11_25) =>
				Effect.gen(function* () {
					if (isStateless(protocol)) {
						yield* send(frame(protocol, DEFAULT_CLIENT_INFO, "server/discover", {}, 1));
						return (yield* readUntilResponse(1)).response;
					}
					yield* send(
						frame(protocol, DEFAULT_CLIENT_INFO, "initialize", initializeParams(protocol, DEFAULT_CLIENT_INFO), 1),
					);
					const { response } = yield* readUntilResponse(1);
					yield* send(frame(protocol, DEFAULT_CLIENT_INFO, "notifications/initialized", undefined));
					return response;
				});

			return new McpProcess({
				send,
				nextLine,
				readUntilResponse,
				handshake,
				closeStdin: Effect.asVoid(Queue.end(stdin)),
				exitCode: Effect.map(handle.exitCode, (code) => Number(code)),
				stderrSoFar: Ref.get(stderr),
				stderrFinal: Effect.andThen(Deferred.await(stderrDone), Ref.get(stderr)),
			});
		});
}
