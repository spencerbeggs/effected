import type { Array as Arr, Stdio } from "effect";
import { Cause, Effect, Exit, Layer, References, Runtime } from "effect";
import type { McpSchema } from "effect/unstable/ai";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { LaunchFailed } from "./internal/LaunchFailed.js";
import { makeGuardedStdio } from "./internal/StdinFrames.js";

/**
 * Options for {@link McpStdio.layer}.
 *
 * @public
 */
export interface McpStdioOptions {
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
 *   provided and merged into its output, and `Layer.orDie`. It answers a
 *   stdin line that is not JSON with a JSON-RPC `-32700` parse error and
 *   keeps serving.
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
	 * Real clients open with either handshake: Claude Code 2.1.281 was
	 * measured opening a stdio server with the stateless `server/discover`,
	 * while most other shipping clients still send `initialize`. The order
	 * is load-bearing:
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
	 * `protocols` list dies: it is the implementer's defect.
	 *
	 * @remarks
	 * Only a layer this one provides inherits `LogToStderr`: compose with
	 * `Layer.provideMerge(McpStdio.layer(...))`. A sibling merged beside it
	 * with `Layer.mergeAll` is not provided by it, so its build logs still
	 * go through `console.log`, onto the wire.
	 *
	 * The server reads stdin through a guard that frames it exactly as core's
	 * decoder does: one streaming UTF-8 decoder, a byte-order mark stripped
	 * only at the start of the stream, lines split on `\n`. A line that is
	 * not JSON is answered on stdout with a JSON-RPC parse error, code
	 * `-32700` and `id: null`, and never reaches core's decoder, which would
	 * otherwise throw on that line again for every later chunk and stop
	 * answering. So is a line longer than core's cap of 16 Mi UTF-16 code
	 * units: it is answered once, as soon as it passes the cap, and the rest
	 * of it is discarded up to its newline. A line of JSON whitespace (space,
	 * tab, carriage return) is ignored. Valid JSON that is not a JSON-RPC
	 * message still goes to core.
	 *
	 * Give each server a fresh layer memo map. Core's stdio protocol layer
	 * is a shared constant, so a second `McpStdio.layer` server whose build
	 * sees the first one's memo map shares its protocol: only the first
	 * server reads stdin, and the second never answers. Merging both into
	 * one graph does that, and so does building or providing the second
	 * anywhere under the first one's `Effect.provide`: nested `Layer.build`
	 * and `Effect.provide` fork the ambient memo map rather than starting a
	 * new one. Isolate each server with its own `ManagedRuntime`,
	 * `Effect.provide(layer, { local: true })` or its own process.
	 *
	 * Code after a completed `Effect.provide` of a stdio server never runs:
	 * core's stdio protocol interrupts the fiber that built it when its stdin
	 * loop ends, which closing the provide's scope does. In a test, serve the
	 * layer through `McpHarness` from `@effected/mcp/testing` instead.
	 *
	 * Each call mints a fresh layer; bind the result to a `const` or the
	 * server builds twice.
	 */
	static readonly layer = (
		options: McpStdioOptions,
	): Layer.Layer<McpServer.McpServer | McpSchema.McpServerClient, never, Stdio.Stdio> =>
		McpServer.layerStdio({
			name: options.name,
			version: options.version,
			instructions: options.instructions,
			description: options.description,
			protocols: options.protocols ?? McpStdio.protocols,
		}).pipe(
			Layer.provide(makeGuardedStdio()),
			Layer.provideMerge(Layer.succeed(References.LogToStderr, true)),
			Layer.orDie,
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
	 */
	static readonly launch = <ROut, E, R>(layer: Layer.Layer<ROut, E, R>): Effect.Effect<never, Error, R> =>
		Layer.launch(layer).pipe(
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
