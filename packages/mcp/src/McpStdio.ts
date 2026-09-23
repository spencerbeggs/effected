import type { Array as Arr, Stdio } from "effect";
import { Cause, Effect, Exit, Layer, References, Runtime } from "effect";
import type { McpSchema } from "effect/unstable/ai";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { LaunchFailed } from "./internal/LaunchFailed.js";

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
 *   provided and merged into its output, and `Layer.orDie`.
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
		}).pipe(Layer.provideMerge(Layer.succeed(References.LogToStderr, true)), Layer.orDie);

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
