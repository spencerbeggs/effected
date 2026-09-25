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
import type { JsonRpcMessage, ServedResource, ServedTool } from "./McpWire.js";
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
	readonly initializeWith: (protocolVersion: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly discover: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly request: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly startRequest: (
		method: string,
		params?: unknown,
	) => Effect.Effect<
		{ readonly id: number; readonly response: Effect.Effect<JsonRpcMessage, McpTestFailure> },
		McpTestFailure
	>;
	readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>, McpTestFailure>;
	readonly listResources: Effect.Effect<ReadonlyArray<ServedResource>, McpTestFailure>;
	readonly readResource: (uri: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly sendRaw: (message: unknown) => Effect.Effect<void>;
	readonly awaitOutboundMethod: (method: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly sentSoFar: Effect.Effect<ReadonlyArray<unknown>>;
	readonly stderrSoFar: Effect.Effect<string>;
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	readonly close: Effect.Effect<void>;
}

/**
 * An in-process MCP client for a real server layer, over queue-backed stdio.
 *
 * @remarks
 * Builds your server with a queue-backed `Stdio.layerTest` that satisfies the
 * server's `Stdio` requirement, so tests see the exact served schemas and wire
 * results a real client would, with no child and no sockets. Pass the server
 * WITHOUT a `Stdio` of its own: a `Stdio` the server provides internally wins,
 * and talks to the real terminal. A bundled platform layer such as
 * `NodeServices.layer` (`@effect/platform-node`) brings its own `Stdio` along
 * with `FileSystem`, `Path`, `ChildProcessSpawner`, `Crypto` and `Terminal` —
 * providing it to the server loses `Stdio` the same way, and every wait
 * hangs to timeout with no error naming why. Compose the individual layers
 * the server needs instead and leave `Stdio` out; this harness supplies it.
 *
 * The server is built with a fresh layer memo map, never the ambient one, so
 * a harness made under another stdio server's `Effect.provide` still serves
 * its own. Never pass a server layer that provides a layer the test also
 * provides and then reads — `McpHarness.make(server.pipe(Layer.provide(AppLayer)))`
 * under `Effect.provide(AppLayer)` builds `AppLayer` twice, so the tools write
 * to one instance and the test reads the other. Leave the service in the
 * server layer's requirements and provide it once from the test, or build it
 * once and pass `Layer.succeed(Tag, value)`.
 *
 * - Responses are matched by id, so notifications may interleave freely.
 * - No wait can hang: every response wait and `awaitOutboundMethod` fails
 *   with `ServerStopped` when the server stops (stdin closing does that),
 *   and dies when `strictStdout` sees a line that is not JSON-RPC.
 * - With `captureLogs`, the server's console is captured: `stderrSoFar`
 *   holds stderr writes and every log line, and `consoleLogSoFar` holds
 *   anything that went through `console.log`, which in a real server is
 *   the wire. Assert it empty.
 * - On a stateful revision (the default `2025-11-25`), send `initialize`
 *   first. Every other request before it fails with `NotInitialized` and
 *   is never written, `ping` included: the server would only answer an
 *   opaque refusal, `-32602 Invalid request metadata` when a stateless
 *   adapter is listed first (as in `McpStdio.protocols`), or
 *   `-32603 Internal error` when only stateful revisions are served.
 *
 * @public
 */
export class McpHarness {
	/** The revision this client speaks. */
	readonly protocol: McpProtocol.ProtocolAdapter;
	/** `initialize` then `notifications/initialized`; `server/discover` on a stateless revision. Call it first on a stateful revision. */
	readonly initialize: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/**
	 * `initialize` asking for `protocolVersion` instead of the harness's own
	 * revision, then `notifications/initialized` only when the response
	 * carries no error. Returns the whole response: assert the negotiated
	 * `result.protocolVersion`, or the JSON-RPC `error`.
	 *
	 * @remarks
	 * It moves between stateful revisions only. A stateful server never
	 * refuses a version: it counter-offers its latest stateful revision, so
	 * asking for an unknown one, or for the stateless `2026-07-28`, comes back
	 * as `2025-11-25`. On a harness made with a stateless revision the server
	 * does not serve `initialize` at all, and the response is a JSON-RPC
	 * `-32601` "Method not found" error, with no `notifications/initialized`
	 * sent after it.
	 */
	readonly initializeWith: (protocolVersion: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** `server/discover`. */
	readonly discover: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Send a request and wait for its response. */
	readonly request: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Send a request now; wait for its response later. Fails with `NotInitialized`, sending nothing, on a stateful revision before `initialize`. */
	readonly startRequest: (
		method: string,
		params?: unknown,
	) => Effect.Effect<
		{ readonly id: number; readonly response: Effect.Effect<JsonRpcMessage, McpTestFailure> },
		McpTestFailure
	>;
	/** Send a notification. */
	readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
	/** `tools/call`, returning the whole response: a JSON-RPC error is data here. */
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** `tools/list`'s tools; a JSON-RPC error fails with `ErrorResponse`. */
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>, McpTestFailure>;
	/** `resources/list`'s resources; a JSON-RPC error fails with `ErrorResponse`. */
	readonly listResources: Effect.Effect<ReadonlyArray<ServedResource>, McpTestFailure>;
	/** `resources/read`, returning the whole response. */
	readonly readResource: (uri: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Write any value as one newline-framed line. Never gated; a raw `initialize` counts as sent. */
	readonly sendRaw: (message: unknown) => Effect.Effect<void>;
	/** The next server-initiated frame with this method, skipping and keeping others; fails with `ServerStopped` once the server stops. */
	readonly awaitOutboundMethod: (method: string) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	/** Every frame written to the server's stdin so far, in order, as the JSON-parsed bytes written (a snapshot the caller's later mutations cannot reach): requests, notifications and `sendRaw` values. */
	readonly sentSoFar: Effect.Effect<ReadonlyArray<unknown>>;
	/** Everything written to stderr, plus every captured log line. */
	readonly stderrSoFar: Effect.Effect<string>;
	/** Every captured `console.log`, `info` or `debug` call. */
	readonly consoleLogSoFar: Effect.Effect<ReadonlyArray<string>>;
	/** End stdin, as a client disconnecting does. */
	readonly close: Effect.Effect<void>;

	private constructor(parts: HarnessParts) {
		this.protocol = parts.protocol;
		this.initialize = parts.initialize;
		this.initializeWith = parts.initializeWith;
		this.discover = parts.discover;
		this.request = parts.request;
		this.startRequest = parts.startRequest;
		this.notify = parts.notify;
		this.callTool = parts.callTool;
		this.listTools = parts.listTools;
		this.listResources = parts.listResources;
		this.readResource = parts.readResource;
		this.sendRaw = parts.sendRaw;
		this.awaitOutboundMethod = parts.awaitOutboundMethod;
		this.sentSoFar = parts.sentSoFar;
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

			// A fresh memo map, never the ambient one: core's stdio protocol layer is a
			// module constant, so a build that forks an enclosing memo map (Layer.build
			// does) would reuse an ambient server's protocol and never read this stdin.
			yield* Effect.flatMap(Effect.scope, (scope) =>
				Layer.buildWithMemoMap(provided, Layer.makeMemoMapUnsafe(), scope),
			).pipe(
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

			// Every wait races the stop and corrupt signals, so none can outlive the server.
			const stopAware = <A>(wait: Effect.Effect<A, McpTestFailure>): Effect.Effect<A, McpTestFailure> =>
				Effect.raceAllFirst([wait, Deferred.await(stopped), Deferred.await(corrupt)]);
			const awaitResponse = (
				waiter: Deferred.Deferred<JsonRpcMessage>,
			): Effect.Effect<JsonRpcMessage, McpTestFailure> =>
				Effect.suspend(() =>
					Deferred.isDoneUnsafe(waiter) ? Deferred.await(waiter) : stopAware(Deferred.await(waiter)),
				);
			// A stateful revision refuses every request before `initialize`, `ping` included,
			// with an opaque -32602 or -32603 depending on the protocol list; fail those fast,
			// naming the missing step.
			const stateful = !isStateless(protocol);
			let initializeSent = false;
			const sent: Array<unknown> = [];
			const sendRaw = (message: unknown): Effect.Effect<void> =>
				Effect.suspend(() => {
					const line = JSON.stringify(message);
					// Recorded from the bytes written, so mutating the caller's object afterwards changes nothing.
					const written: unknown = line === undefined ? undefined : JSON.parse(line);
					sent.push(written);
					if (isJsonRpcMessage(written) && written.method === "initialize") initializeSent = true;
					return Effect.asVoid(Queue.offer(stdin, encoder.encode(`${line}\n`)));
				});
			const startRequest = (method: string, params?: unknown) =>
				Effect.gen(function* () {
					if (stateful && !initializeSent && method !== "initialize") {
						return yield* new McpTestFailure({
							reason: "NotInitialized",
							message: `${method} was not sent: call initialize first on stateful protocol ${protocol.protocolVersion}`,
						});
					}
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
			const initializeWith = (protocolVersion: string) =>
				Effect.gen(function* () {
					const response = yield* request("initialize", { ...initializeParams(protocol, clientInfo), protocolVersion });
					if (response.error === undefined) yield* notify("notifications/initialized");
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
			const listResources = Effect.flatMap(request("resources/list"), (response) =>
				response.error === undefined
					? Effect.succeed((response.result as { readonly resources: ReadonlyArray<ServedResource> }).resources)
					: Effect.fail(
							new McpTestFailure({
								reason: "ErrorResponse",
								message: `resources/list failed: ${ToolFailure.truncate(JSON.stringify(response.error))}`,
							}),
						),
			);
			const awaitOutboundMethod = (method: string): Effect.Effect<JsonRpcMessage, McpTestFailure> =>
				Effect.suspend(() => {
					const index = retained.findIndex((message) => message.method === method);
					if (index !== -1) return Effect.succeed(retained.splice(index, 1)[0] as JsonRpcMessage);
					return stopAware(
						Effect.gen(function* () {
							while (true) {
								const message = yield* Queue.take(inbound);
								if (message.method === method) return message;
								retained.push(message);
							}
						}),
					);
				});

			return new McpHarness({
				protocol,
				initialize,
				initializeWith,
				discover,
				request,
				startRequest,
				notify,
				callTool: (name, args) => request("tools/call", { name, arguments: args ?? {} }),
				listTools,
				listResources,
				readResource: (uri) => request("resources/read", { uri }),
				sendRaw,
				awaitOutboundMethod,
				sentSoFar: Effect.sync(() => [...sent]),
				stderrSoFar: Effect.sync(() => stderr.join("")),
				consoleLogSoFar: Effect.sync(() => [...consoleLog]),
				close: Effect.asVoid(Queue.end(stdin)),
			});
		});
}
