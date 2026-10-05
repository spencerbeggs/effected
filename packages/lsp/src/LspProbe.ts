import type { PlatformError } from "effect";
import { Cause, Deferred, Duration, Effect, Queue, Ref, Stream } from "effect";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";
import { LspFrame, LspFrameError } from "./LspFrame.js";
import type { LspMessage } from "./LspMessage.js";
import { LspTestFailure } from "./LspTestFailure.js";

/** How much stderr a failure message echoes. */
const STDERR_ECHO = 2000;

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

const truncate = (text: string): string => (text.length <= STDERR_ECHO ? text : `${text.slice(0, STDERR_ECHO)}…`);

const isLspMessage = (value: unknown): value is LspMessage =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	(value as { readonly jsonrpc?: unknown }).jsonrpc === "2.0";

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
 *   for stdin to close fails with `Timeout` instead of passing.
 * - A request the server sends (`client/registerCapability`, say) is
 *   recorded in `messages` and never answered.
 * - Never hangs: stdout that ends before a response fails `StreamEnded` with
 *   the exit code and stderr; bytes that are not a frame fail `InvalidFrame`;
 *   and the whole exchange runs under `timeout` (30 seconds by default),
 *   which fails `Timeout` naming the step it was waiting on. The child is
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
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(command);

		// Stdin: a queue the probe writes frames to. It is never ended — the
		// server must exit on `exit`, not on EOF. A pump failure (EPIPE once the
		// child is gone) is recorded for the StreamEnded message, never raised.
		const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
		const pumpFailure = yield* Ref.make<string | undefined>(undefined);
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(
			Effect.catch((error) => Ref.set(pumpFailure, error.message)),
			Effect.forkScoped,
		);
		const send = (message: unknown) => Effect.asVoid(Queue.offer(stdin, LspFrame.encode(message)));

		// Stdout: decoded frames, in order. The queue ends with the stream, or
		// fails with the frame or read error, so every wait on it settles.
		const inbox = yield* Queue.unbounded<unknown, LspFrameError | PlatformError.PlatformError | Cause.Done>();
		yield* LspFrame.decodeStream(handle.stdout).pipe(
			Stream.runForEach((message) => Effect.asVoid(Queue.offer(inbox, message))),
			Effect.matchEffect({
				onFailure: (error) => Queue.fail(inbox, error),
				onSuccess: () => Queue.end(inbox),
			}),
			Effect.forkScoped,
		);

		const stderr = yield* Ref.make("");
		const stderrDone = yield* Deferred.make<void>();
		yield* Stream.decodeText(handle.stderr).pipe(
			Stream.runForEach((text) => Ref.update(stderr, (sofar) => sofar + text)),
			Effect.ignore,
			Effect.ensuring(Deferred.succeed(stderrDone, undefined)),
			Effect.forkScoped,
		);
		const stderrFinal = Effect.andThen(Deferred.await(stderrDone), Ref.get(stderr));

		const messages: Array<LspMessage> = [];
		const stage = yield* Ref.make("the id-1 initialize response");

		// Once stdout has ended the exit code and stderr are settled; fold them
		// into the failure, because the caller holds no handle to read them.
		const ended = (why: string) =>
			Effect.gen(function* () {
				const code = yield* Effect.match(handle.exitCode, {
					onFailure: (error) => `unknown (${error.message})`,
					onSuccess: (exitCode) => String(Number(exitCode)),
				});
				const text = yield* stderrFinal;
				const pump = yield* Ref.get(pumpFailure);
				return yield* new LspTestFailure({
					reason: "StreamEnded",
					message: `the server's stdout ${why} before ${yield* Ref.get(stage)}; the server exited with code ${code}; stderr: ${
						text === "" ? "(empty)" : truncate(text)
					}${pump === undefined ? "" : `; stdin pump failed: ${pump}`}`,
				});
			});

		const next: Effect.Effect<LspMessage, LspTestFailure> = Queue.take(inbox).pipe(
			Effect.catch((error) =>
				Cause.isDone(error)
					? ended("ended")
					: error instanceof LspFrameError
						? error.code === "Truncated"
							? ended(`ended inside a frame (${error.message})`)
							: Effect.fail(
									new LspTestFailure({
										reason: "InvalidFrame",
										message: `the server's stdout is not LSP frames: ${error.message}`,
									}),
								)
						: ended(`failed to read (${error.message})`),
			),
			Effect.flatMap((message) =>
				isLspMessage(message)
					? Effect.succeed(message)
					: Effect.fail(
							new LspTestFailure({
								reason: "NotJsonRpc",
								message: `the server sent a frame that is not a JSON-RPC 2.0 message: ${truncate(JSON.stringify(message) ?? String(message))}`,
							}),
						),
			),
			Effect.tap((message) => Effect.sync(() => messages.push(message))),
		);

		const responseTo = (id: number) =>
			Effect.gen(function* () {
				while (true) {
					const message = yield* next;
					if (message.method === undefined && message.id === id) return message;
				}
			});

		const exchange = Effect.gen(function* () {
			yield* send({
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
			if (response.error === undefined) yield* send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* Ref.set(stage, "the id-2 shutdown response");
			yield* send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
			const shutdown = yield* responseTo(2);
			yield* Ref.set(stage, "the server's exit after the exit notification");
			yield* send({ jsonrpc: "2.0", method: "exit" });
			const exitCode = Number(yield* handle.exitCode);
			// Drain what the server wrote before exiting; a frame error now is still a failure.
			yield* Ref.set(stage, "the end of stdout after the server exited");
			while (true) {
				const more = yield* Effect.catchIf(
					Effect.as(next, true),
					(failure: LspTestFailure) => failure.reason === "StreamEnded",
					() => Effect.succeed(false),
				);
				if (!more) break;
			}
			return { response, shutdown, messages, stderr: yield* stderrFinal, exitCode } satisfies LspProbeResult;
		});

		return yield* exchange.pipe(
			Effect.timeoutOrElse({
				duration: options.timeout ?? Duration.seconds(30),
				orElse: () =>
					Effect.gen(function* () {
						const text = yield* Ref.get(stderr);
						return yield* new LspTestFailure({
							reason: "Timeout",
							message: `timed out waiting for ${yield* Ref.get(stage)}; stderr so far: ${text === "" ? "(empty)" : truncate(text)}`,
						});
					}),
			}),
		);
	});
