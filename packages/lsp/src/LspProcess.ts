import type { PlatformError, Scope } from "effect";
import { Cause, Deferred, Duration, Effect, Option, Queue, Ref, Result, Stream, SubscriptionRef } from "effect";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";
import { isLspMessage, notJsonRpc, truncate } from "./internal/messages.js";
import { LspFrame, LspFrameError } from "./LspFrame.js";
import type { LspMessage } from "./LspMessage.js";
import { LspTestFailure } from "./LspTestFailure.js";

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
	const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return bytes;
};

/**
 * Options for {@link LspProcess.stderrUntil}.
 *
 * @public
 */
export interface LspProcessStderrUntilOptions {
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

/** @internal */
export interface ProcessParts {
	readonly send: (message: unknown) => Effect.Effect<void>;
	readonly sendRaw: (bytes: string | Uint8Array) => Effect.Effect<void>;
	readonly nextMessage: Effect.Effect<LspMessage, LspTestFailure>;
	readonly readUntilResponse: (
		id: string | number,
	) => Effect.Effect<{ readonly response: LspMessage; readonly seen: ReadonlyArray<LspMessage> }, LspTestFailure>;
	readonly closeStdin: Effect.Effect<void>;
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	readonly stderrSoFar: Effect.Effect<string>;
	readonly stderrUntil: (
		predicate: (stderr: string) => boolean,
		options: LspProcessStderrUntilOptions,
	) => Effect.Effect<string, LspTestFailure>;
	readonly stderrFinal: Effect.Effect<string>;
	readonly stdoutSoFar: Effect.Effect<Uint8Array>;
	readonly stdoutFinal: Effect.Effect<Uint8Array>;
	readonly assertOnlyFrames: Effect.Effect<ReadonlyArray<LspMessage>, LspTestFailure>;
}

/**
 * A spawned Language Server bin a test writes `Content-Length` frames to
 * while it runs — the LSP twin of `@effected/mcp/testing`'s `McpProcess`.
 *
 * @remarks
 * Build the command in the test file with `execPath` and an explicit `env`:
 * `ChildProcess.make(process.execPath, [bin, "--stdio"], { env })`. The child
 * lives for the scope `spawn` runs in, and is killed when it closes.
 *
 * - `nextMessage` fails `StreamEnded` once stdout ends — a stream that ends
 *   inside a frame included — so a child that exits early fails the test
 *   instead of hanging it. Bytes that are not a frame fail `InvalidFrame`; a
 *   frame whose body is not a JSON-RPC 2.0 message fails `NotJsonRpc`.
 * - `send` writes one frame with `LspFrame.encode` from the main entry, so `Content-Length`
 *   counts bytes; `sendRaw` writes a string or bytes exactly as given, for a
 *   malformed frame or one frame split across writes.
 * - `readUntilResponse` reads past notifications and server requests to the
 *   response with the matching id, and returns what it saw.
 * - `closeStdin` is `Queue.end`, so every frame already sent is delivered
 *   before stdin closes. The specification makes a server exit on the `exit`
 *   notification with stdin still open; close stdin only to test a client
 *   disconnect.
 * - Every stdout byte is kept, apart from the decoder: `stdoutSoFar` and
 *   `stdoutFinal` return it raw, and `assertOnlyFrames` proves it held
 *   nothing but well-formed frames, even after the decoder has failed.
 *
 * @example
 * ```ts
 * import { LspProcess } from "@effected/lsp/testing";
 * import { Effect } from "effect";
 * import { ChildProcess } from "effect/process";
 *
 * const program = Effect.gen(function* () {
 * 	const server = yield* LspProcess.spawn(ChildProcess.make(process.execPath, ["./bin/lsp.js", "--stdio"]));
 * 	yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: null, capabilities: {} } });
 * 	const { response } = yield* server.readUntilResponse(1);
 * 	yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
 * 	yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
 * 	yield* server.readUntilResponse(2);
 * 	yield* server.send({ jsonrpc: "2.0", method: "exit" });
 * 	const exitCode = yield* server.exitCode;
 * 	// Stdout carried nothing but frames: no stray log line before, between or after them.
 * 	yield* server.assertOnlyFrames;
 * 	return { response, exitCode };
 * }).pipe(Effect.scoped);
 * // Requires a `ChildProcessSpawner` from the platform layer.
 * ```
 *
 * @public
 */
export class LspProcess {
	/**
	 * Write one message to the child's stdin as a `Content-Length` frame.
	 *
	 * @remarks
	 * Never fails. A frame sent after `closeStdin` is dropped, and a write the
	 * child can no longer receive fails the stdin pump instead; the next
	 * `StreamEnded` message names that failure.
	 */
	readonly send: (message: unknown) => Effect.Effect<void>;
	/**
	 * Write `bytes` to the child's stdin exactly as given: a string as UTF-8,
	 * bytes unchanged, with no framing added.
	 *
	 * @remarks
	 * For frames `send` cannot produce: a header without `Content-Length`, a
	 * body that is not JSON, or one frame split across several writes,
	 * including mid-character by passing bytes. Never fails, on the same terms
	 * as `send`.
	 */
	readonly sendRaw: (bytes: string | Uint8Array) => Effect.Effect<void>;
	/**
	 * The next message on stdout.
	 *
	 * @remarks
	 * Fails `StreamEnded` once stdout ends, including inside a frame;
	 * `InvalidFrame` when stdout carried bytes that are not a frame (a log
	 * line on the wire); `NotJsonRpc` for a well-framed body that is not a
	 * JSON-RPC 2.0 message. A frame failure is final: every later read fails
	 * the same way.
	 */
	readonly nextMessage: Effect.Effect<LspMessage, LspTestFailure>;
	/** Read messages up to and including the response with this id; `seen` holds every message read, the response last. */
	readonly readUntilResponse: (
		id: string | number,
	) => Effect.Effect<{ readonly response: LspMessage; readonly seen: ReadonlyArray<LspMessage> }, LspTestFailure>;
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
	 * Fails `StreamEnded` when stderr ends (the child exited) without the
	 * predicate holding, and `TimedOut` once `options.timeout` passes; both
	 * messages carry the stderr seen so far. Reach for it whenever a report
	 * lands on a later tick than the messages a test reads, such as a crash
	 * guard's report once the server is serving. `options.timeout` is real
	 * time: run the test under `it.live`.
	 */
	readonly stderrUntil: (
		predicate: (stderr: string) => boolean,
		options: LspProcessStderrUntilOptions,
	) => Effect.Effect<string, LspTestFailure>;
	/** Everything written to stderr, once stderr has ended. Waits for the child to exit. */
	readonly stderrFinal: Effect.Effect<string>;
	/** Every byte written to stdout so far, undecoded. */
	readonly stdoutSoFar: Effect.Effect<Uint8Array>;
	/** Every byte written to stdout, once stdout has ended. Waits for the child to exit. */
	readonly stdoutFinal: Effect.Effect<Uint8Array>;
	/**
	 * Wait for stdout to end, then prove it carried nothing but well-formed
	 * `Content-Length` frames of JSON-RPC 2.0 messages, and return those
	 * messages.
	 *
	 * @remarks
	 * The stdout hygiene check: a stray byte before the first frame, between
	 * two frames or after the last fails `InvalidFrame`, whose message names
	 * the stream offset and quotes the offending bytes; so does a stream that
	 * ends inside a frame. A well-framed body that is not JSON-RPC fails
	 * `NotJsonRpc`. It reads the raw capture, not `nextMessage`'s queue, so
	 * the messages a test already read are still checked. It waits for the
	 * child to exit: send `exit` (or close stdin) first.
	 */
	readonly assertOnlyFrames: Effect.Effect<ReadonlyArray<LspMessage>, LspTestFailure>;

	private constructor(parts: ProcessParts) {
		this.send = parts.send;
		this.sendRaw = parts.sendRaw;
		this.nextMessage = parts.nextMessage;
		this.readUntilResponse = parts.readUntilResponse;
		this.closeStdin = parts.closeStdin;
		this.exitCode = parts.exitCode;
		this.stderrSoFar = parts.stderrSoFar;
		this.stderrUntil = parts.stderrUntil;
		this.stderrFinal = parts.stderrFinal;
		this.stdoutSoFar = parts.stdoutSoFar;
		this.stdoutFinal = parts.stdoutFinal;
		this.assertOnlyFrames = parts.assertOnlyFrames;
	}

	/** Spawn `command` for the life of the current scope. */
	static readonly spawn = (
		command: ChildProcess.Command,
	): Effect.Effect<LspProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
		Effect.map(spawnParts(command), (parts) => new LspProcess(parts));
}

/**
 * Options for {@link spawnParts}: how a `StreamEnded` failure is worded.
 *
 * @internal
 */
export interface SpawnPartsOptions {
	/** What the reader was waiting for, read when stdout ends. Defaults to "the expected message". */
	readonly pending?: Effect.Effect<string>;
	/**
	 * Wait for the child's exit code and its whole stderr before failing
	 * `StreamEnded`, and fold both in. Only safe under an outer timeout: a
	 * child that closes stdout and keeps running would hold the read.
	 */
	readonly settle?: boolean;
}

/**
 * The machinery behind {@link LspProcess.spawn}, shared with `LspProbe` so
 * there is one stdout reader.
 *
 * @internal
 */
export const spawnParts = (
	command: ChildProcess.Command,
	options: SpawnPartsOptions = {},
): Effect.Effect<ProcessParts, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(command);
		const encoder = new TextEncoder();

		// Stdin: the pump's failure (EPIPE once the child is gone) is recorded,
		// not raised, so `send` stays never-failing and StreamEnded reports it.
		const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
		const pumpFailure = yield* Ref.make<string | undefined>(undefined);
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(
			Effect.catch((error) => Ref.set(pumpFailure, error.message)),
			Effect.forkScoped,
		);

		// Stdout: one reader keeps every raw byte and hands the chunks on to the
		// decoder, so the capture runs to the end even after a frame error
		// stops decoding.
		const raw: Array<Uint8Array> = [];
		const stdoutDone = yield* Deferred.make<void>();
		const chunks = yield* Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>();
		yield* handle.stdout.pipe(
			Stream.runForEach((chunk) => {
				raw.push(chunk);
				return Effect.asVoid(Queue.offer(chunks, chunk));
			}),
			Effect.matchEffect({ onFailure: (error) => Queue.fail(chunks, error), onSuccess: () => Queue.end(chunks) }),
			Effect.ensuring(Deferred.succeed(stdoutDone, undefined)),
			Effect.forkScoped,
		);
		const inbox = yield* Queue.unbounded<unknown, LspFrameError | PlatformError.PlatformError | Cause.Done>();
		yield* LspFrame.decodeStream(Stream.fromQueue(chunks)).pipe(
			Stream.runForEach((message) => Effect.asVoid(Queue.offer(inbox, message))),
			Effect.matchEffect({ onFailure: (error) => Queue.fail(inbox, error), onSuccess: () => Queue.end(inbox) }),
			Effect.forkScoped,
		);
		const stdoutSoFar = Effect.sync(() => concat(raw));
		const stdoutFinal = Effect.andThen(Deferred.await(stdoutDone), stdoutSoFar);

		// Stderr: a SubscriptionRef, so stderrUntil wakes on each chunk rather than polling.
		const stderr = yield* SubscriptionRef.make<StderrState>({ text: "", done: false });
		const stderrDone = yield* Deferred.make<void>();
		yield* Stream.decodeText(handle.stderr).pipe(
			Stream.runForEach((text) =>
				SubscriptionRef.update(stderr, (sofar) => ({ text: sofar.text + text, done: false })),
			),
			Effect.ignore,
			Effect.ensuring(
				Effect.andThen(
					SubscriptionRef.update(stderr, (sofar) => ({ text: sofar.text, done: true })),
					Deferred.succeed(stderrDone, undefined),
				),
			),
			Effect.forkScoped,
		);
		const stderrSoFar = Effect.map(SubscriptionRef.get(stderr), (state) => state.text);
		const stderrFinal = Effect.andThen(Deferred.await(stderrDone), stderrSoFar);
		const stderrUntil = (predicate: (stderr: string) => boolean, until: LspProcessStderrUntilOptions) =>
			SubscriptionRef.changes(stderr).pipe(
				Stream.filter((state) => state.done || predicate(state.text)),
				Stream.runHead,
				Effect.flatMap((found) => {
					const state = Option.getOrElse(found, (): StderrState => ({ text: "", done: true }));
					return predicate(state.text)
						? Effect.succeed(state.text)
						: Effect.fail(
								new LspTestFailure({
									reason: "StreamEnded",
									message: `the server's stderr ended before it matched; stderr: ${truncate(state.text)}`,
								}),
							);
				}),
				Effect.timeoutOrElse({
					duration: until.timeout,
					orElse: () =>
						Effect.flatMap(stderrSoFar, (text) =>
							Effect.fail(
								new LspTestFailure({
									reason: "TimedOut",
									message: `the server's stderr did not match within ${Duration.format(Duration.fromInputUnsafe(until.timeout))}; stderr so far: ${truncate(text)}`,
								}),
							),
						),
				}),
			);

		const ended = (why: string) =>
			Effect.gen(function* () {
				const pending = options.pending === undefined ? "the expected message" : yield* options.pending;
				const pump = yield* Ref.get(pumpFailure);
				const pumpText = pump === undefined ? "" : `; stdin pump failed: ${truncate(pump)}`;
				if (options.settle === true) {
					// Once stdout has ended the exit code and stderr are settling; fold
					// them in, for a caller that holds no handle to read them.
					const code = yield* Effect.match(handle.exitCode, {
						onFailure: (error) => `unknown (${error.message})`,
						onSuccess: (exitCode) => String(Number(exitCode)),
					});
					const text = yield* stderrFinal;
					return yield* new LspTestFailure({
						reason: "StreamEnded",
						message: `the server's stdout ${why} before ${pending}; the server exited with code ${code}; stderr: ${
							text === "" ? "(empty)" : truncate(text)
						}${pumpText}`,
					});
				}
				const text = yield* stderrSoFar;
				return yield* new LspTestFailure({
					reason: "StreamEnded",
					message: `the server's stdout ${why} before ${pending}; stderr so far: ${
						text === "" ? "(empty)" : truncate(text)
					}${pumpText}`,
				});
			});
		const nextMessage: Effect.Effect<LspMessage, LspTestFailure> = Queue.take(inbox).pipe(
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
			Effect.flatMap((message) => (isLspMessage(message) ? Effect.succeed(message) : Effect.fail(notJsonRpc(message)))),
		);
		const readUntilResponse = (id: string | number) =>
			Effect.gen(function* () {
				const seen: Array<LspMessage> = [];
				while (true) {
					const message = yield* nextMessage;
					seen.push(message);
					if (message.method === undefined && message.id === id) return { response: message, seen };
				}
			});

		const assertOnlyFrames = Effect.flatMap(stdoutFinal, (bytes) => {
			const decoded = LspFrame.decodeAllResult(bytes);
			if (Result.isFailure(decoded)) {
				return Effect.fail(
					new LspTestFailure({
						reason: "InvalidFrame",
						message: `the server's stdout carried bytes outside a well-formed frame: ${decoded.failure.message}`,
					}),
				);
			}
			const stray = decoded.success.find((message) => !isLspMessage(message));
			return stray === undefined
				? Effect.succeed(decoded.success as ReadonlyArray<LspMessage>)
				: Effect.fail(notJsonRpc(stray));
		});

		const sendRaw = (bytes: string | Uint8Array): Effect.Effect<void> =>
			Effect.asVoid(Queue.offer(stdin, typeof bytes === "string" ? encoder.encode(bytes) : bytes));

		return {
			send: (message) => sendRaw(LspFrame.encode(message)),
			sendRaw,
			nextMessage,
			readUntilResponse,
			closeStdin: Effect.asVoid(Queue.end(stdin)),
			exitCode: Effect.map(handle.exitCode, (code) => Number(code)),
			stderrSoFar,
			stderrUntil,
			stderrFinal,
			stdoutSoFar,
			stdoutFinal,
			assertOnlyFrames,
		} satisfies ProcessParts;
	});
