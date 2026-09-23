import type { Cause, Scope } from "effect";
import { Console, Deferred, Effect, Exit, Layer, Queue, Sink, Stdio, Stream } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ClientInfo } from "./internal/wire.js";
import {
	DEFAULT_CLIENT_INFO,
	frame,
	initializeParams,
	isJsonRpcMessage,
	isResponse,
	isStateless,
	parseFrame,
	requestKey,
} from "./internal/wire.js";
import { McpTestFailure } from "./McpTestFailure.js";
import type { JsonRpcMessage, ServedTool } from "./McpWire.js";
import { ToolFailure } from "./ToolFailure.js";

/**
 * Options for {@link McpHarness.make}.
 *
 * @public
 */
export interface McpHarnessOptions {
	/** The revision this client speaks. Defaults to `McpProtocol.v2025_11_25`; a stateless adapter switches to `server/discover` and per-request `_meta`. */
	readonly protocol?: McpProtocol.ProtocolAdapter | undefined;
	/** The `clientInfo` sent in `initialize` and in stateless `_meta`. */
	readonly clientInfo?: { readonly name: string; readonly version: string } | undefined;
	/** Capture the server's console so logs are asserted, not printed. Defaults to `true`. */
	readonly captureLogs?: boolean | undefined;
	/** Treat any stdout line that is not JSON-RPC as a defect. Defaults to `true`. */
	readonly strictStdout?: boolean | undefined;
}

interface HarnessParts {
	readonly protocol: McpProtocol.ProtocolAdapter;
	readonly initialize: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly discover: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly request: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly startRequest: (
		method: string,
		params?: unknown,
	) => Effect.Effect<{ readonly id: number; readonly response: Effect.Effect<JsonRpcMessage, McpTestFailure> }>;
	readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>, McpTestFailure>;
	readonly readResource: (uri: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly sendRaw: (message: unknown) => Effect.Effect<void>;
	readonly awaitOutboundMethod: (method: string) => Effect.Effect<JsonRpcMessage>;
	readonly stderrSoFar: Effect.Effect<string>;
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	readonly close: Effect.Effect<void>;
}

/**
 * An in-process MCP client for a real server layer, over queue-backed stdio.
 *
 * @remarks
 * Builds your server with a `Stdio.layerTest` provided innermost, so tests see
 * the exact served schemas and wire results a real client would, with no child
 * and no sockets. Pass the server WITHOUT a `Stdio` of its own: a layer that
 * already provides one talks to the real terminal.
 *
 * - Responses are matched by id, so notifications may interleave freely.
 * - No wait can hang: a response wait fails with `ServerStopped` when the
 *   server stops (stdin closing mid-request does that), and dies when
 *   `strictStdout` sees a line that is not JSON-RPC.
 * - With `captureLogs`, the server's console is captured: `stderrSoFar`
 *   holds stderr writes and every log line, and `consoleLogSoFar` holds
 *   anything that went through `console.log`, which in a real server is
 *   the wire. Assert it empty.
 *
 * @public
 */
export class McpHarness {
	/** The revision this client speaks. */
	readonly protocol: McpProtocol.ProtocolAdapter;
	/** `initialize` then `notifications/initialized`; `server/discover` on a stateless revision. */
	readonly initialize: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** `server/discover`. */
	readonly discover: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Send a request and wait for its response. */
	readonly request: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Send a request now; wait for its response later. */
	readonly startRequest: (
		method: string,
		params?: unknown,
	) => Effect.Effect<{ readonly id: number; readonly response: Effect.Effect<JsonRpcMessage, McpTestFailure> }>;
	/** Send a notification. */
	readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
	/** `tools/call`, returning the whole response: a JSON-RPC error is data here. */
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** `tools/list`'s tools; a JSON-RPC error fails with `ErrorResponse`. */
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>, McpTestFailure>;
	/** `resources/read`, returning the whole response. */
	readonly readResource: (uri: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Write any value as one newline-framed line. */
	readonly sendRaw: (message: unknown) => Effect.Effect<void>;
	/** The next server-initiated frame with this method, skipping and keeping others. */
	readonly awaitOutboundMethod: (method: string) => Effect.Effect<JsonRpcMessage>;
	/** Everything written to stderr, plus every captured log line. */
	readonly stderrSoFar: Effect.Effect<string>;
	/** Every captured `console.log`, `info` or `debug` call. */
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** End stdin, as a client disconnecting does. */
	readonly close: Effect.Effect<void>;

	private constructor(parts: HarnessParts) {
		this.protocol = parts.protocol;
		this.initialize = parts.initialize;
		this.discover = parts.discover;
		this.request = parts.request;
		this.startRequest = parts.startRequest;
		this.notify = parts.notify;
		this.callTool = parts.callTool;
		this.listTools = parts.listTools;
		this.readResource = parts.readResource;
		this.sendRaw = parts.sendRaw;
		this.awaitOutboundMethod = parts.awaitOutboundMethod;
		this.stderrSoFar = parts.stderrSoFar;
		this.consoleLogSoFar = parts.consoleLogSoFar;
		this.close = parts.close;
	}

	/** Build `server` over queue-backed stdio and return a client for it; fails with the layer's own error if it cannot build. */
	static readonly make = <ROut, E, R>(
		server: Layer.Layer<ROut, E, R>,
		options: McpHarnessOptions = {},
	): Effect.Effect<McpHarness, E, Scope.Scope | Exclude<R, Stdio.Stdio>> =>
		Effect.gen(function* () {
			const protocol = options.protocol ?? McpProtocol.v2025_11_25;
			const clientInfo: ClientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
			const strictStdout = options.strictStdout ?? true;
			const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
			const stdout = yield* Queue.unbounded<string | Uint8Array>();
			const inbound = yield* Queue.unbounded<JsonRpcMessage>();
			const retained: Array<JsonRpcMessage> = [];
			const waiters = new Map<string, Deferred.Deferred<JsonRpcMessage>>();
			const stderr: Array<string> = [];
			const consoleLog: Array<string> = [];
			const ready = yield* Deferred.make<void, E>();
			const stopped = yield* Deferred.make<never, McpTestFailure>();
			const corrupt = yield* Deferred.make<never>();
			const encoder = new TextEncoder();
			const stdoutDecoder = new TextDecoder();
			const stderrDecoder = new TextDecoder();
			let nextId = 1;

			const stdio = Stdio.layerTest({
				stdin: Stream.fromQueue(stdin),
				// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach's callback returns an Effect, not an Array#forEach value
				stdout: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(stdout, chunk)),
				stderr: () =>
					// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach's callback returns an Effect, not an Array#forEach value
					Sink.forEach((chunk: string | Uint8Array) =>
						Effect.sync(() => {
							stderr.push(typeof chunk === "string" ? chunk : stderrDecoder.decode(chunk, { stream: true }));
						}),
					),
			});
			const ambient = yield* Console.Console;
			const show = (args: ReadonlyArray<unknown>): string =>
				args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");
			const toStdout = (...args: ReadonlyArray<unknown>): void => {
				consoleLog.push(show(args));
			};
			const toStderr = (...args: ReadonlyArray<unknown>): void => {
				stderr.push(`${show(args)}\n`);
			};
			const captured: Console.Console = {
				...ambient,
				log: toStdout,
				info: toStdout,
				debug: toStdout,
				error: toStderr,
				warn: toStderr,
			};
			const provided =
				options.captureLogs === false
					? server.pipe(Layer.provide(stdio))
					: server.pipe(Layer.provide(stdio), Layer.provide(Layer.succeed(Console.Console, captured)));

			const route = (line: string): Effect.Effect<void> => {
				const parsed = parseFrame(line);
				if (!isJsonRpcMessage(parsed)) {
					return strictStdout
						? Effect.asVoid(
								Deferred.die(
									corrupt,
									new Error(`stdout carried a line that is not JSON-RPC: ${ToolFailure.truncate(line)}`),
								),
							)
						: Effect.void;
				}
				if (isResponse(parsed)) {
					const key = requestKey(parsed.id);
					const waiter = waiters.get(key);
					if (waiter !== undefined) {
						waiters.delete(key);
						return Effect.asVoid(Deferred.succeed(waiter, parsed));
					}
				}
				return Effect.asVoid(Queue.offer(inbound, parsed));
			};
			yield* Stream.fromQueue(stdout).pipe(
				Stream.map((chunk) => (typeof chunk === "string" ? chunk : stdoutDecoder.decode(chunk, { stream: true }))),
				Stream.splitLines,
				Stream.runForEach((line) => (line.length === 0 ? Effect.void : route(line))),
				Effect.forkScoped,
			);

			yield* Layer.build(provided).pipe(
				Effect.andThen(Deferred.succeed(ready, undefined)),
				Effect.andThen(Effect.never),
				Effect.scoped,
				Effect.onExit((exit) =>
					Effect.andThen(
						Exit.isFailure(exit) ? Deferred.failCause(ready, exit.cause) : Effect.void,
						Deferred.fail(
							stopped,
							new McpTestFailure({ reason: "ServerStopped", message: "the server stopped before it responded" }),
						),
					),
				),
				Effect.forkScoped,
			);
			yield* Deferred.await(ready);

			const awaitResponse = (
				waiter: Deferred.Deferred<JsonRpcMessage>,
			): Effect.Effect<JsonRpcMessage, McpTestFailure> =>
				Effect.suspend(() =>
					Deferred.isDoneUnsafe(waiter)
						? Deferred.await(waiter)
						: Effect.raceAllFirst([Deferred.await(waiter), Deferred.await(stopped), Deferred.await(corrupt)]),
				);
			const sendRaw = (message: unknown): Effect.Effect<void> =>
				Effect.asVoid(Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`)));
			const startRequest = (method: string, params?: unknown) =>
				Effect.gen(function* () {
					const id = nextId++;
					const waiter = yield* Deferred.make<JsonRpcMessage>();
					waiters.set(requestKey(id), waiter);
					yield* sendRaw(frame(protocol, clientInfo, method, params, id));
					return { id, response: awaitResponse(waiter) };
				});
			const request = (method: string, params?: unknown) =>
				Effect.flatMap(startRequest(method, params), (started) => started.response);
			const notify = (method: string, params?: unknown) => sendRaw(frame(protocol, clientInfo, method, params));
			const discover = request("server/discover", {});
			const initialize = isStateless(protocol)
				? discover
				: Effect.gen(function* () {
						const response = yield* request("initialize", initializeParams(protocol, clientInfo));
						yield* notify("notifications/initialized");
						return response;
					});
			const listTools = Effect.flatMap(request("tools/list"), (response) =>
				response.error === undefined
					? Effect.succeed((response.result as { readonly tools: ReadonlyArray<ServedTool> }).tools)
					: Effect.fail(
							new McpTestFailure({
								reason: "ErrorResponse",
								message: `tools/list failed: ${ToolFailure.truncate(JSON.stringify(response.error))}`,
							}),
						),
			);
			const awaitOutboundMethod = (method: string) =>
				Effect.gen(function* () {
					const index = retained.findIndex((message) => message.method === method);
					if (index !== -1) return retained.splice(index, 1)[0] as JsonRpcMessage;
					while (true) {
						const message = yield* Queue.take(inbound);
						if (message.method === method) return message;
						retained.push(message);
					}
				});

			return new McpHarness({
				protocol,
				initialize,
				discover,
				request,
				startRequest,
				notify,
				callTool: (name, args) => request("tools/call", { name, arguments: args ?? {} }),
				listTools,
				readResource: (uri) => request("resources/read", { uri }),
				sendRaw,
				awaitOutboundMethod,
				stderrSoFar: Effect.sync(() => stderr.join("")),
				consoleLogSoFar: Effect.sync(() => [...consoleLog]),
				close: Effect.asVoid(Queue.end(stdin)),
			});
		});
}
