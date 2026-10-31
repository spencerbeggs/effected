import type { Array as Arr, Scope, Stdio } from "effect";
import { Cause, Effect, Exit, Layer, References, Runtime } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { LaunchFailed } from "./internal/LaunchFailed.js";
import { makeGuardedStdio } from "./internal/StdinFrames.js";

/**
 * Options for {@link McpStdio.layer}.
 *
 * @public
 */
export interface McpStdioOptions<RA = never, RE = never, RR = never> {
	/** The server name reported to the client. */
	readonly name: string;
	/** The server version reported to the client. */
	readonly version: string;
	/** Surfaced in `initialize` and `server/discover`; tell the agent how to use the tools. */
	readonly instructions?: string | undefined;
	/** A one-line description of the server, reported to the client. */
	readonly description?: string | undefined;
	/** Defaults to {@link McpStdio.protocols}. Read its ordering rules before overriding. */
	readonly protocols?: Arr.NonEmptyReadonlyArray<McpProtocol.ProtocolAdapter> | undefined;
	/**
	 * The server's registration layers (toolkits, resources, prompts), built
	 * before the server reads its first request and under `LogToStderr`.
	 *
	 * @remarks
	 * Core's `registrations` option of `McpServer.layerStdio`. The transport
	 * discharges each `McpServer.McpRequest<"Requires", Scope>` marker; any
	 * other request-level marker stays in the layer's requirements, to be met
	 * by MCP middleware. A registration that needs `Stdio` when it is built
	 * gets the guarded one this layer serves over.
	 */
	readonly registrations?: Layer.Layer<RA, RE, RR> | undefined;
}

/**
 * The services a registration layer needs that {@link McpStdio.layer} does
 * not supply: everything but `McpServer` and `Stdio` (which the layer
 * requires itself), with each request-level marker but
 * `McpServer.McpRequest<"Requires", Scope>`, which the transport discharges.
 *
 * @public
 */
export type McpStdioRegistrationServices<RR> =
	| Exclude<McpServer.McpRequest.Without<RR>, McpServer.McpServer>
	| McpServer.McpRequest.From<"Requires", Exclude<McpServer.McpRequest.Only<"Requires", RR>, Scope.Scope>>;

/**
 * Options for {@link McpStdio.launch}.
 *
 * @public
 */
export interface McpLaunchOptions {
	/**
	 * Runs once the whole layer has built, and before the launch waits
	 * forever. By then the stdio protocol is reading stdin: the server is
	 * serving, although no client may have sent `initialize` yet.
	 *
	 * @remarks
	 * `McpGuard.run` (`@effected/mcp/guard`) uses it as its "connected"
	 * signal. A layer built after the server layer, as in
	 * `Layer.effectDiscard(ready).pipe(Layer.provide(Main))`, gives the same
	 * signal, but only if every consumer re-derives that `Layer.provide`
	 * builds its dependency first.
	 */
	readonly onReady?: Effect.Effect<void> | undefined;
}

/**
 * Serve an MCP server over stdio without ever writing a log line or a failure
 * report onto stdout, which is the JSON-RPC wire.
 *
 * @remarks
 * The one-line `main.ts`:
 *
 * ```ts
 * NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown })
 * ```
 *
 * - {@link McpStdio.layer} is `McpServer.layerStdio` with `LogToStderr`
 *   provided and merged into its output, and a bad `protocols` list
 *   turned into a defect. It answers a
 *   stdin line that is not JSON with a JSON-RPC `-32700` parse error, and
 *   JSON that is not a JSON-RPC message with `-32600`, and keeps serving.
 * - {@link McpStdio.launch} reports a launch failure itself, on stderr, and
 *   hides it from `runMain`, whose own report is written outside anything
 *   the program can provide.
 * - {@link McpStdio.teardown} maps stdin EOF, the normal end of every
 *   session, to exit 0 instead of 130.
 *
 * Never `NodeRuntime.runMain(Layer.launch(Main).pipe(Effect.provideService(References.LogToStderr, true)))`:
 * it typechecks and serves, but a launch failure is still reported by
 * `runMain` through `console.log`, straight onto the wire, where the client
 * reads it as a malformed frame instead of an error.
 *
 * @public
 */
export class McpStdio {
	private constructor() {}

	/**
	 * `[v2026_07_28, v2025_11_25, v2025_06_18]` — the stateless revision
	 * first, then the two newest stateful ones.
	 *
	 * @remarks
	 * Real clients open with either handshake: some (Claude Code, for one)
	 * open a stdio server with the stateless `server/discover`, while others
	 * still send `initialize`. The order is load-bearing:
	 *
	 * - Stateless first: a request with no session and no `_meta` falls to
	 *   `protocols[0]`.
	 * - Never a single entry: `initialize` only matches stateful adapters, so
	 *   a stateless-only list refuses every client that opens with it.
	 * - At most one stateless adapter; a second fails the layer.
	 */
	static readonly protocols: Arr.NonEmptyReadonlyArray<McpProtocol.ProtocolAdapter> = [
		McpProtocol.v2026_07_28,
		McpProtocol.v2025_11_25,
		McpProtocol.v2025_06_18,
	];

	/**
	 * `McpServer.layerStdio` with `LogToStderr` provided and merged into the
	 * output, so every layer it provides logs to stderr too. A bad
	 * `protocols` list dies: it is the implementer's defect. So does a
	 * registration that fails with `Cause.IllegalArgumentError`, which core
	 * reports for the same class of mistake; any other registration error
	 * stays in the error channel.
	 *
	 * @remarks
	 * Pass the server's registration layers as `options.registrations`: they
	 * are built before the server reads its first request, under
	 * `LogToStderr`. Providing this layer to them, as
	 * `Registrations.pipe(Layer.provideMerge(McpStdio.layer(...)))`, also
	 * serves them, and they inherit `LogToStderr` the same way. A sibling
	 * merged beside it with `Layer.mergeAll` is neither: its build logs still
	 * go through `console.log`, onto the wire.
	 *
	 * The output is `McpServer` and the `McpServer.McpRequest<"Requires", Scope>`
	 * marker the transport discharges. `McpServerClient` is not in it: the
	 * stateless `v2026_07_28` revision has no client session, so a handler
	 * reads the client's details from `McpSchema.McpRequestContext` instead.
	 *
	 * `LogToStderr` only reaches a logger that reads it: Effect's default
	 * logger and `Logger.consolePretty`. `Logger.consoleJson`,
	 * `Logger.consoleLogFmt` and `Logger.consoleStructured` are built with
	 * `Logger.withConsoleLog`, which writes through `console.log` whatever
	 * `LogToStderr` says, so a server that installs one puts every log line on
	 * the wire. Never install them under this layer; wrap the formatter in
	 * `Logger.withConsoleError` instead, as in
	 * `Logger.layer([Logger.withConsoleError(Logger.formatJson)])`.
	 *
	 * The server reads stdin through a guard that frames it exactly as core's
	 * decoder does: one streaming UTF-8 decoder, a byte-order mark stripped
	 * only at the start of the stream, lines split on `\n`. Core itself skips
	 * a line it cannot use and keeps serving, but sends no reply, where
	 * JSON-RPC 2.0 requires one; the guard supplies it. A line that is not
	 * JSON is answered on stdout with a parse error, code `-32700` and
	 * `id: null`, and never reaches core. So is a line longer than core's cap
	 * of 16 Mi UTF-16 code units: it is answered once, as soon as it passes
	 * the cap, and the rest of it is discarded up to its newline (core would
	 * log it on stderr and drop it). A line of JSON whitespace (space, tab,
	 * carriage return) is ignored.
	 *
	 * A line that is JSON but no JSON-RPC message core can handle is answered
	 * with an Invalid Request, code `-32600` and `id: null`, and never reaches
	 * core: a value that is neither an object nor an array, an object whose
	 * `method` is not a string and whose `id` is absent or `null`, and an
	 * object with neither `method` nor `id`, which is neither a request nor a
	 * response.
	 *
	 * Everything else goes to core: an array, which core answers `-32600`
	 * itself because it serves no batches; an object with an `id` and no
	 * `method`, which is a response and gets no reply; and a request with an
	 * `id`, which core answers even when its `method` is malformed.
	 *
	 * Give each server a fresh layer memo map. Core's stdio protocol layer
	 * is a shared constant, so a second `McpStdio.layer` server whose build
	 * sees the first one's memo map shares its protocol: only the first
	 * server reads stdin, and the second never answers. Merging both into
	 * one graph does that, and so does building or providing the second
	 * anywhere under the first one's `Effect.provide`: nested `Layer.build`
	 * and `Effect.provide` fork the ambient memo map rather than starting a
	 * new one. The tool registry is shared the same way. Isolate each server
	 * by wrapping its whole bundle (this layer with its `registrations`, or its
	 * toolkit layers together with this layer) in `Layer.fresh`, or with its own `ManagedRuntime`,
	 * `Effect.provide(layer, { local: true })` or its own process. Never put
	 * the `Layer.fresh` boundary between a toolkit and this layer: the server
	 * would serve an empty registry.
	 *
	 * Code after a completed `Effect.provide` of a stdio server never runs:
	 * core's stdio protocol interrupts the fiber that built it when its stdin
	 * loop ends, which closing the provide's scope does. In a test, serve the
	 * layer through `McpHarness` from `@effected/mcp/testing` instead.
	 *
	 * Each call mints a fresh layer; bind the result to a `const` or the
	 * server builds twice.
	 */
	static readonly layer = <RA = never, RE = never, RR = never>(
		options: McpStdioOptions<RA, RE, RR>,
	): Layer.Layer<
		McpServer.McpServer | McpServer.McpRequest<"Requires", Scope.Scope>,
		Exclude<RE, Cause.IllegalArgumentError>,
		Stdio.Stdio | McpStdioRegistrationServices<RR>
	> =>
		McpServer.layerStdio({
			name: options.name,
			version: options.version,
			instructions: options.instructions,
			description: options.description,
			protocols: options.protocols ?? McpStdio.protocols,
			registrations: options.registrations,
		}).pipe(
			Layer.provide(makeGuardedStdio()),
			Layer.provideMerge(Layer.succeed(References.LogToStderr, true)),
			// A bad `protocols` list (or an invalid registration) is the implementer's defect; every other error is kept.
			Layer.catchCause((cause) =>
				Layer.effectContext<
					McpServer.McpServer | McpServer.McpRequest<"Requires", Scope.Scope>,
					Exclude<RE, Cause.IllegalArgumentError>,
					never
				>(
					Effect.failCause(cause).pipe(
						Effect.catchIf(Cause.isIllegalArgumentError, (error) => Effect.die(error)),
					) as Effect.Effect<never, Exclude<RE, Cause.IllegalArgumentError>>,
				),
			),
		);

	/**
	 * `Layer.launch`, with any failure other than an interrupt logged on
	 * stderr here and re-raised marked as already reported, keeping its exit
	 * code.
	 *
	 * @remarks
	 * `runMain` logs an unhandled failure from outside the program, where no
	 * `Effect.provideService` reaches, and Effect's default logger writes
	 * through `console.log` unless `LogToStderr` is set. For an MCP server
	 * that is stdout, which is the wire.
	 *
	 * `options.onReady` runs after the layer has built and before the launch
	 * waits forever, as {@link McpLaunchOptions.onReady} describes.
	 */
	static readonly launch = <ROut, E, R>(
		layer: Layer.Layer<ROut, E, R>,
		options: McpLaunchOptions = {},
	): Effect.Effect<never, Error, R> =>
		(options.onReady === undefined
			? Layer.launch(layer)
			: // Layer.launch's own shape, with the ready signal between the build and the wait.
				Effect.scoped(Layer.build(layer).pipe(Effect.andThen(options.onReady), Effect.andThen(Effect.never)))
		).pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? // An interrupt-only cause holds no Fail reason, so no E can escape through it.
						Effect.failCause(cause as Cause.Cause<never>)
					: Effect.logError(cause).pipe(
							Effect.andThen(Effect.fail(new LaunchFailed(Runtime.getErrorExitCode(Cause.squash(cause))))),
						),
			),
			Effect.provideService(References.LogToStderr, true),
		);

	/**
	 * Success or an interrupt-only exit maps to 0. Anything else goes to
	 * `Runtime.defaultTeardown`.
	 *
	 * @remarks
	 * Stdin EOF, the normal end of every session, ends in an interrupt-only
	 * exit, and so do SIGINT and SIGTERM: `runMain` interrupts the program on
	 * either signal. All three exit 0 here, not the 130 a default teardown
	 * reports for an interrupt.
	 */
	static readonly teardown: Runtime.Teardown = (exit, onExit) =>
		Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit);
}
