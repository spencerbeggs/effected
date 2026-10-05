import type { Cause, PlatformError, Scope } from "effect";
import { Deferred, Duration, Effect, Option, Queue, Ref, Stream, SubscriptionRef } from "effect";
import { McpProtocol } from "effect/ai";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";
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
	readonly sendRaw: (text: string | Uint8Array) => Effect.Effect<void>;
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
	readonly stderrUntil: (
		predicate: (stderr: string) => boolean,
		options: McpProcessStderrUntilOptions,
	) => Effect.Effect<string, McpTestFailure>;
	readonly stderrFinal: Effect.Effect<string>;
}

/**
 * Options for {@link McpProcess.stderrUntil}.
 *
 * @public
 */
export interface McpProcessStderrUntilOptions {
	/**
	 * How long to wait for the predicate to hold before failing with
	 * `TimedOut`. Real time: under `it.effect`'s `TestClock` it never fires,
	 * so a test that waits on stderr runs under `it.live`. Keep it below the
	 * test runner's own timeout, or the runner kills the test first.
	 */
	readonly timeout: Duration.Input;
}

/** What the stderr reader publishes: the text so far, and whether stderr has ended. */
interface StderrState {
	readonly text: string;
	readonly done: boolean;
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
 * - `send` writes one JSON-encoded line; `sendRaw` writes a string or bytes
 *   exactly as given, for a malformed frame or one frame split across
 *   writes, even mid-character.
 * - `readUntilResponse` reads past interleaved notifications, such as
 *   `list_changed`, to the matching id and returns what it saw.
 * - `closeStdin` is `Queue.end`, never `Queue.shutdown`, so every frame
 *   already sent is delivered before stdin closes.
 * - A request in flight when stdin closes still answers from an Effect
 *   server, which drains before it exits; a server that does not drain
 *   drops it, so a portable client reads the response first.
 *
 * @example
 * ```ts
 * import { McpProcess } from "@effected/mcp/testing";
 * import { Effect } from "effect";
 * import { ChildProcess } from "effect/process";
 *
 * const program = Effect.gen(function* () {
 * 	const child = yield* McpProcess.spawn(ChildProcess.make(process.execPath, ["./bin/server.js"]));
 * 	yield* child.handshake();
 * 	yield* child.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
 * 	const { response } = yield* child.readUntilResponse(2);
 * 	yield* child.closeStdin;
 * 	return response;
 * }).pipe(Effect.scoped);
 * // Requires a `ChildProcessSpawner` from the platform layer.
 * ```
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
	/**
	 * Write `text` to the child's stdin exactly as given: a string as UTF-8,
	 * bytes unchanged, with no JSON encoding and no newline added.
	 *
	 * @remarks
	 * For frames `send` cannot produce: a line that is not JSON, a blank line,
	 * or one frame split across several writes, including mid-character by
	 * passing bytes. Include the `\n` yourself.
	 * Never fails, on the same terms as `send`.
	 */
	readonly sendRaw: (text: string | Uint8Array) => Effect.Effect<void>;
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
	/**
	 * Wait until everything written to stderr so far satisfies `predicate`,
	 * and return that text.
	 *
	 * @remarks
	 * Event-driven: the predicate is checked against the current text at once,
	 * then again on every chunk the child writes, never on a polling timer.
	 * Fails with `StreamEnded` when stderr ends (the child exited) without the
	 * predicate holding, and with `TimedOut` once `options.timeout` passes;
	 * both messages carry the stderr seen so far. Reach for it whenever a
	 * report lands on a later tick than the responses a test reads, such as
	 * `McpGuard`'s `injectCrash: { at: "connected" }` report, instead of
	 * reading `stderrSoFar` once. `options.timeout` is real time: run the test
	 * under `it.live`.
	 */
	readonly stderrUntil: (
		predicate: (stderr: string) => boolean,
		options: McpProcessStderrUntilOptions,
	) => Effect.Effect<string, McpTestFailure>;
	/** Everything written to stderr, once stderr has ended. Waits for the child to exit. */
	readonly stderrFinal: Effect.Effect<string>;

	private constructor(parts: ProcessParts) {
		this.send = parts.send;
		this.sendRaw = parts.sendRaw;
		this.nextLine = parts.nextLine;
		this.readUntilResponse = parts.readUntilResponse;
		this.handshake = parts.handshake;
		this.closeStdin = parts.closeStdin;
		this.exitCode = parts.exitCode;
		this.stderrSoFar = parts.stderrSoFar;
		this.stderrUntil = parts.stderrUntil;
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

			// A SubscriptionRef so stderrUntil wakes on each chunk rather than polling.
			const stderr = yield* SubscriptionRef.make<StderrState>({ text: "", done: false });
			const stderrDone = yield* Deferred.make<void>();
			yield* Stream.decodeText(handle.stderr).pipe(
				Stream.runForEach((text) =>
					SubscriptionRef.update(stderr, (sofar) => ({ text: sofar.text + text, done: false })),
				),
				Effect.ensuring(
					Effect.andThen(
						SubscriptionRef.update(stderr, (sofar) => ({ text: sofar.text, done: true })),
						Deferred.succeed(stderrDone, undefined),
					),
				),
				Effect.forkScoped,
			);
			const stderrText = Effect.map(SubscriptionRef.get(stderr), (state) => state.text);
			const stderrUntil = (predicate: (stderr: string) => boolean, options: McpProcessStderrUntilOptions) =>
				SubscriptionRef.changes(stderr).pipe(
					Stream.filter((state) => state.done || predicate(state.text)),
					Stream.runHead,
					Effect.flatMap((found) => {
						const state = Option.getOrElse(found, (): StderrState => ({ text: "", done: true }));
						return predicate(state.text)
							? Effect.succeed(state.text)
							: Effect.fail(
									new McpTestFailure({
										reason: "StreamEnded",
										message: `the server's stderr ended before it matched; stderr: ${ToolFailure.truncate(state.text, ToolFailure.ENGINE_ECHO_LIMIT)}`,
									}),
								);
					}),
					Effect.timeoutOrElse({
						duration: options.timeout,
						orElse: () =>
							Effect.flatMap(stderrText, (text) =>
								Effect.fail(
									new McpTestFailure({
										reason: "TimedOut",
										message: `the server's stderr did not match within ${Duration.format(Duration.fromInputUnsafe(options.timeout))}; stderr so far: ${ToolFailure.truncate(text, ToolFailure.ENGINE_ECHO_LIMIT)}`,
									}),
								),
							),
					}),
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
			const sendRaw = (text: string | Uint8Array): Effect.Effect<void> =>
				Effect.asVoid(Queue.offer(stdin, typeof text === "string" ? encoder.encode(text) : text));
			const send = (message: unknown): Effect.Effect<void> => sendRaw(`${JSON.stringify(message)}\n`);
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
				sendRaw,
				nextLine,
				readUntilResponse,
				handshake,
				closeStdin: Effect.asVoid(Queue.end(stdin)),
				exitCode: Effect.map(handle.exitCode, (code) => Number(code)),
				stderrSoFar: stderrText,
				stderrUntil,
				stderrFinal: Effect.andThen(Deferred.await(stderrDone), stderrText),
			});
		});
}
