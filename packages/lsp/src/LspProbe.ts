import type { PlatformError } from "effect";
import { Duration, Effect, Ref } from "effect";
import type { ChildProcess, ChildProcessSpawner } from "effect/process";
import { truncate } from "./internal/messages.js";
import type { LspMessage } from "./LspMessage.js";
import { spawnParts } from "./LspProcess.js";
import { LspTestFailure } from "./LspTestFailure.js";

/**
 * Options for {@link LspProbe.initialize}.
 *
 * @public
 */
export interface LspProbeOptions {
	/** `initialize`'s `rootUri`. Defaults to `null`: no workspace folder. */
	readonly rootUri?: string | null;
	/** `initialize`'s `processId`. Defaults to `null`, so the server never watches a client process for liveness. */
	readonly processId?: number | null;
	/** The client capabilities `initialize` announces. Defaults to `{}`. */
	readonly capabilities?: { readonly [key: string]: unknown };
	/** `initialize`'s `initializationOptions`; omitted from the request unless given. */
	readonly initializationOptions?: unknown;
	/** A ceiling over the whole exchange, spawn excluded. Defaults to 30 seconds. */
	readonly timeout?: Duration.Input;
}

/**
 * What {@link LspProbe.initialize} observed.
 *
 * @public
 */
export interface LspProbeResult {
	/** The id-1 `initialize` response. A refused handshake is still a response: assert `response.error === undefined`. */
	readonly response: LspMessage;
	/** The id-2 `shutdown` response; a clean server answers `result: null`. */
	readonly shutdown: LspMessage;
	/** Every message the server sent, in order: responses, notifications, and requests the probe left unanswered. */
	readonly messages: ReadonlyArray<LspMessage>;
	/** Everything the server wrote to stderr; a clean boot leaves it empty. */
	readonly stderr: string;
	/** The server's exit code; 0 means `exit` arrived after `shutdown`, as the specification requires. */
	readonly exitCode: number;
}

/**
 * The smallest proof that an installed Language Server bin boots: the whole
 * LSP lifecycle over stdio, and exit code 0.
 *
 * @remarks
 * The exchange is `initialize` (id 1), its response, the `initialized`
 * notification, `shutdown` (id 2), its response, and the `exit`
 * notification; then the probe waits for the server to exit. The caller
 * asserts `response.error === undefined`, `exitCode === 0` and, for a clean
 * boot, `stderr === ""` — this is the LSP half of a packed-install proof, the
 * twin of `@effected/mcp/testing`'s `McpProbe`. Every frame is encoded with
 * `LspFrame.encode` from the main entry, so `Content-Length` counts bytes.
 *
 * - `initialized` is sent because the specification requires it before any
 *   other request, `shutdown` included; it is skipped only when `initialize`
 *   answered with an error, and the sequence still ends `shutdown`, `exit`.
 * - Stdin stays open after `exit`. The server must terminate itself on
 *   `exit`, as an editor never closes the pipe first; a server that waits
 *   for stdin to close fails with `TimedOut` instead of passing.
 * - A request the server sends (`client/registerCapability`, say) is
 *   recorded in `messages` and never answered.
 * - Never hangs: stdout that ends before a response fails `StreamEnded` with
 *   the exit code and stderr; bytes that are not a frame fail `InvalidFrame`;
 *   and the whole exchange runs under `timeout` (30 seconds by default),
 *   which fails `TimedOut` naming the step it was waiting on. The child is
 *   killed when the probe's scope closes.
 * - The timeout reads `Clock`, so under `it.effect`'s virtual clock it
 *   never fires on its own: run the probe under `it.live`.
 *
 * @example
 * ```ts
 * import { LspProbe } from "@effected/lsp/testing";
 * import { Effect } from "effect";
 * import { ChildProcess } from "effect/process";
 *
 * const program = Effect.gen(function* () {
 * 	const probe = yield* LspProbe.initialize(ChildProcess.make(process.execPath, ["./bin/lsp.js", "--stdio"]));
 * 	// A clean boot: no JSON-RPC error, exit code 0, empty stderr.
 * 	return probe.response.error === undefined && probe.exitCode === 0 && probe.stderr === "";
 * });
 * // Requires a `ChildProcessSpawner` from the platform layer.
 * ```
 *
 * @public
 */
export class LspProbe {
	private constructor() {}

	/**
	 * Spawn `command`, run `initialize` → `initialized` → `shutdown` → `exit`,
	 * and collect every server message, stderr and the exit code.
	 */
	static readonly initialize: (
		command: ChildProcess.Command,
		options?: LspProbeOptions,
	) => Effect.Effect<
		LspProbeResult,
		LspTestFailure | PlatformError.PlatformError,
		ChildProcessSpawner.ChildProcessSpawner
	> = Effect.fn("LspProbe.initialize")(function* (command: ChildProcess.Command, options: LspProbeOptions = {}) {
		return yield* Effect.scoped(probe(command, options));
	});
}

const probe = (command: ChildProcess.Command, options: LspProbeOptions) =>
	Effect.gen(function* () {
		const stage = yield* Ref.make("the id-1 initialize response");
		// One stdout reader, shared with LspProcess. `settle` folds the exit code
		// and the whole stderr into StreamEnded, because the caller holds no handle
		// to read them; the outer timeout bounds that wait. Stdin is never ended:
		// the server must exit on `exit`, not on EOF.
		const server = yield* spawnParts(command, { pending: Ref.get(stage), settle: true });

		const messages: Array<LspMessage> = [];
		const responseTo = (id: number) =>
			Effect.map(server.readUntilResponse(id), ({ response, seen }) => {
				messages.push(...seen);
				return response;
			});

		const exchange = Effect.gen(function* () {
			yield* server.send({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					processId: options.processId ?? null,
					rootUri: options.rootUri ?? null,
					capabilities: options.capabilities ?? {},
					...(options.initializationOptions === undefined
						? {}
						: { initializationOptions: options.initializationOptions }),
				},
			});
			const response = yield* responseTo(1);
			if (response.error === undefined) yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* Ref.set(stage, "the id-2 shutdown response");
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			const shutdown = yield* responseTo(2);
			yield* Ref.set(stage, "the server's exit after the exit notification");
			yield* server.send({ jsonrpc: "2.0", method: "exit" });
			const exitCode = yield* server.exitCode;
			// Drain what the server wrote before exiting; a frame error now is still a failure.
			yield* Ref.set(stage, "the end of stdout after the server exited");
			while (true) {
				const more = yield* Effect.catchIf(
					Effect.map(server.nextMessage, (message) => messages.push(message) > 0),
					(failure: LspTestFailure) => failure.reason === "StreamEnded",
					() => Effect.succeed(false),
				);
				if (!more) break;
			}
			return { response, shutdown, messages, stderr: yield* server.stderrFinal, exitCode } satisfies LspProbeResult;
		});

		return yield* exchange.pipe(
			Effect.timeoutOrElse({
				duration: options.timeout ?? Duration.seconds(30),
				orElse: () =>
					Effect.gen(function* () {
						const text = yield* server.stderrSoFar;
						return yield* new LspTestFailure({
							reason: "TimedOut",
							message: `timed out waiting for ${yield* Ref.get(stage)}; stderr so far: ${text === "" ? "(empty)" : truncate(text)}`,
						});
					}),
			}),
		);
	});
