import type { PlatformError, Scope } from "effect";
import { Duration, Effect, Fiber, FileSystem, Option, Path, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Fmt } from "./Fmt.js";

/**
 * A hermetic temp directory minted by {@link CliTest.sandbox}, removed when its
 * scope closes.
 *
 * @public
 */
export interface Sandbox {
	/** The temp directory itself; the default working directory of {@link CliTest.run}. */
	readonly root: string;
	/** The fresh `HOME` inside `root`; the XDG base directories live under it. */
	readonly home: string;
	/**
	 * The complete child environment: `HOME`, the four `XDG_*_HOME` variables,
	 * the injected `PATH` and `NO_COLOR=1`. Nothing is inherited from the host.
	 */
	readonly env: Readonly<Record<string, string>>;
}

/**
 * How {@link CliTest.run} spawns a bin.
 *
 * @public
 */
export interface RunOptions {
	/** The sandbox whose environment and root the child runs in. */
	readonly sandbox: Sandbox;
	/** The node binary — pass `process.execPath` from the test file, never a PATH lookup. */
	readonly execPath: string;
	/** The child's working directory. Defaults to the sandbox `root`. */
	readonly cwd?: string | undefined;
	/**
	 * Extra environment variables, merged over the sandbox environment — the
	 * way to override `PATH` for one run.
	 */
	readonly env?: Readonly<Record<string, string>> | undefined;
	/**
	 * Text written to the child's stdin, which is then closed. Omitted or `""`,
	 * the child gets an already-ended empty input, never an open pipe.
	 */
	readonly stdin?: string | undefined;
	/**
	 * How long a child has to exit after `SIGTERM` (or the signal `kill` sends), when its scope closes or
	 * {@link SpawnedBin.kill} is called, before it is sent `SIGKILL`; `2 seconds` by default. A finite duration: a
	 * child that ignores the signal would otherwise keep the scope from closing forever, and leave the process behind.
	 */
	readonly forceKillAfter?: Duration.Input | undefined;
}

/**
 * What a spawned bin did, as data: a non-zero exit is a result, not a failure.
 *
 * @public
 */
export interface RunResult {
	/** The child's exit code, or `null` when a signal ended it. */
	readonly exitCode: number | null;
	/** The signal that ended the child, or `null` when it exited with a code. */
	readonly signal: ChildProcess.Signal | null;
	/** Everything the child wrote to stdout, decoded as UTF-8. */
	readonly stdout: string;
	/** Everything the child wrote to stderr, decoded as UTF-8. */
	readonly stderr: string;
}

/**
 * A bin {@link CliTest.spawn} started and has not waited for: its output as it arrives, a way to signal it, and its
 * exit.
 *
 * @public
 */
export interface SpawnedBin {
	/**
	 * The child's stdout as lines, each without its line break (`\r\n` included), from the first byte it wrote,
	 * ending when the child closes stdout; a last line with no line break comes when it does. Every subscription replays
	 * from the start, so a test may read it more than once, and output a test never reads is still drained, so the
	 * child never blocks on a full pipe.
	 */
	readonly stdout: Stream.Stream<string>;
	/** The child's stderr as lines, as `stdout` gives stdout. */
	readonly stderr: Stream.Stream<string>;
	/**
	 * Send `signal` (`SIGTERM` by default) and wait for the child to exit. A child still running after
	 * {@link RunOptions.forceKillAfter} is sent `SIGKILL`, so this always ends. A child that has already exited, on its
	 * own or at the same moment, is not an error: this returns normally, and `exitCode` and `result` keep reporting how
	 * it ended. A kill that fails on a child still running fails with that `PlatformError`.
	 */
	readonly kill: (signal?: ChildProcess.Signal) => Effect.Effect<void, PlatformError.PlatformError>;
	/**
	 * The child's exit code once it exits, or `null` when a signal ended it (the default `kill` included): `result`
	 * names the signal. Re-reading it after the exit answers at once.
	 */
	readonly exitCode: Effect.Effect<number | null, PlatformError.PlatformError>;
	/** Wait for the exit and the end of both streams, and read everything, as {@link CliTest.run} returns it. */
	readonly result: Effect.Effect<RunResult, PlatformError.PlatformError>;
}

/** Everything a stream carried so far, and whether it has ended. */
interface Captured {
	readonly text: string;
	readonly done: boolean;
}

/** The complete lines of `captured` from `offset`, and the rest too once it has ended; with the offset after them. */
const linesFrom = (offset: number, captured: Captured): readonly [number, ReadonlyArray<string>] => {
	const lines: Array<string> = [];
	let start = offset;
	let end = captured.text.indexOf("\n", start);
	while (end !== -1) {
		lines.push(captured.text.slice(start, captured.text[end - 1] === "\r" ? end - 1 : end));
		start = end + 1;
		end = captured.text.indexOf("\n", start);
	}
	if (captured.done && start < captured.text.length) {
		lines.push(captured.text.slice(start));
		start = captured.text.length;
	}
	return [start, lines];
};

/** The bound on a child that ignores its termination signal, when the caller gives none. */
const FORCE_KILL_AFTER: Duration.Input = "2 seconds";

/** `options.forceKillAfter` or the default; a duration that is not finite is a wiring mistake and throws. */
const forceKillAfterOf = (options: RunOptions): Duration.Duration => {
	const input = options.forceKillAfter ?? FORCE_KILL_AFTER;
	const duration = Duration.fromInput(input);
	// A NaN number becomes a zero duration, so it is refused before it is converted.
	const nan = typeof input === "number" && Number.isNaN(input);
	if (nan || Option.isNone(duration) || !Duration.isFinite(duration.value) || Duration.toMillis(duration.value) < 0) {
		throw new RangeError(`CliTest: forceKillAfter must be a finite, non-negative duration, received ${String(input)}`);
	}
	return duration.value;
};

/** How a child ended. */
interface Ending {
	readonly exitCode: number | null;
	readonly signal: ChildProcess.Signal | null;
}

/**
 * Core's handle fails `exitCode` for a child a signal ended, naming the signal only in the error's text; this reads it
 * back out, so a signal is an outcome as an exit code is. Any other failure (a failed stdin stream) stays a failure.
 */
const SIGNALLED = /receipt of signal: '(SIG[A-Z0-9]+)'/;

const endingOf = (
	exitCode: Effect.Effect<number, PlatformError.PlatformError>,
): Effect.Effect<Ending, PlatformError.PlatformError> =>
	exitCode.pipe(
		Effect.map((code): Ending => ({ exitCode: Number(code), signal: null })),
		Effect.catchTag("PlatformError", (error) => {
			const match = SIGNALLED.exec(`${error.message} ${Fmt.causeMessage(error) ?? ""}`);
			return match === null
				? Effect.fail(error)
				: Effect.succeed<Ending>({ exitCode: null, signal: match[1] as ChildProcess.Signal });
		}),
	);

const commandOf = (
	bin: string,
	args: ReadonlyArray<string>,
	options: RunOptions,
	forceKillAfter: Duration.Duration,
): ChildProcess.Command =>
	ChildProcess.make(options.execPath, [bin, ...args], {
		forceKillAfter,
		cwd: options.cwd ?? options.sandbox.root,
		env: { ...options.sandbox.env, ...options.env },
		stdin:
			options.stdin === undefined || options.stdin === ""
				? Stream.empty
				: Stream.make(new TextEncoder().encode(options.stdin)),
	});

const text = <E, R>(stream: Stream.Stream<Uint8Array, E, R>): Effect.Effect<string, E, R> =>
	Stream.mkString(Stream.decodeText(stream));

/**
 * Spawn a built CLI bin hermetically and read its exit code and streams as data.
 *
 * @example
 * ```ts
 * import * as NodeServices from "@effect/platform-node/NodeServices"
 * import { assert, it } from "@effect/vitest"
 * import { CliTest } from "@effected/cli/testing"
 * import { Effect } from "effect"
 *
 * it.effect("prints its version", () =>
 *   Effect.gen(function* () {
 *     const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" })
 *     const result = yield* CliTest.run("dist/bin.js", ["--version"], { sandbox, execPath: process.execPath })
 *     assert.strictEqual(result.exitCode, 0)
 *   }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
 * )
 * ```
 *
 * @public
 */
export class CliTest {
	private constructor() {}

	/**
	 * A scoped temp directory with a fresh `HOME` and XDG tree, `NO_COLOR=1`,
	 * and the `PATH` you pass — the host environment is never inherited.
	 *
	 * @remarks
	 * Each call mints a fresh temp directory; bind the result to a `const`
	 * within one test rather than calling this more than once per assertion.
	 */
	static readonly sandbox = (options: {
		/**
		 * The `PATH` the child sees, passed explicitly because nothing else is
		 * inherited — `process.env.PATH` when the bin shells out to host tools,
		 * a narrower list to prove it does not.
		 */
		readonly path: string;
	}): Effect.Effect<Sandbox, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "effected-cli-test-" });
			const home = path.join(root, "home");
			const xdg = {
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_DATA_HOME: path.join(home, ".local", "share"),
				XDG_STATE_HOME: path.join(home, ".local", "state"),
				XDG_CACHE_HOME: path.join(home, ".cache"),
			};
			for (const dir of Object.values(xdg)) yield* fs.makeDirectory(dir, { recursive: true });
			return { root, home, env: { HOME: home, ...xdg, PATH: options.path, NO_COLOR: "1" } };
		});

	/**
	 * Run `execPath bin ...args`; a non-zero exit is returned, never failed.
	 *
	 * @remarks
	 * `stdin` is never left as an inherited open pipe: when omitted or `""`
	 * the child gets an already-ended empty input (`Stream.empty`), so a
	 * stdin-reading bin exits instead of hanging on `effect/process`'s
	 * default `"pipe"` stdio, which stays open until something writes to and
	 * ends it.
	 */
	static readonly run = (
		bin: string,
		args: ReadonlyArray<string>,
		options: RunOptions,
	): Effect.Effect<RunResult, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> => {
		const forceKillAfter = forceKillAfterOf(options);
		return Effect.scoped(
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				const handle = yield* spawner.spawn(commandOf(bin, args, options, forceKillAfter));
				// Read both streams and the exit concurrently: sequential reads
				// deadlock once an OS pipe buffer fills.
				const [stdout, stderr, ending] = yield* Effect.all(
					[text(handle.stdout), text(handle.stderr), endingOf(handle.exitCode)],
					{ concurrency: "unbounded" },
				);
				return { ...ending, stdout, stderr };
			}),
		);
	};

	/**
	 * Start `execPath bin ...args` and return at once with a handle on it: its output as lines while it runs, a signal,
	 * and its exit, for a long-running command (a `--follow`, a watch mode, a server) that {@link CliTest.run} would wait
	 * on forever.
	 *
	 * @remarks
	 * The child lives in the caller's scope: when the scope closes first, the child is sent `SIGTERM`, then `SIGKILL`
	 * after `forceKillAfter` (`2 seconds` by default), so a test that ends early leaves nothing running and never waits
	 * on a child that ignores the signal. A child a signal ended reports `exitCode: null` and the signal in `result`. Both streams are drained from the start whether or not the test reads them, so a
	 * chatty child never blocks on a full pipe, and each stream replays from its first line to every reader. The
	 * options are {@link CliTest.run}'s, `stdin` included: the child gets that text, then an ended input.
	 *
	 * ```ts
	 * const child = yield* CliTest.spawn("dist/bin.js", ["logs", "--follow"], { sandbox, execPath: process.execPath })
	 * yield* Stream.runHead(child.stdout) // the first line: it is following
	 * yield* child.kill("SIGINT")
	 * assert.strictEqual(yield* child.exitCode, 0)
	 * ```
	 *
	 * @param bin - the built bin to run
	 * @param args - its arguments
	 * @param options - the sandbox, the node binary, and the working directory, environment and stdin
	 */
	static readonly spawn = (
		bin: string,
		args: ReadonlyArray<string>,
		options: RunOptions,
	): Effect.Effect<SpawnedBin, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> => {
		const forceKillAfter = forceKillAfterOf(options);
		return Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(commandOf(bin, args, options, forceKillAfter));
			const capture = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
				Effect.gen(function* () {
					const ref = yield* SubscriptionRef.make<Captured>({ text: "", done: false });
					const pump = yield* Stream.decodeText(stream).pipe(
						Stream.runForEach((chunk) => SubscriptionRef.update(ref, (s) => ({ text: s.text + chunk, done: false }))),
						Effect.ensuring(SubscriptionRef.update(ref, (s) => ({ text: s.text, done: true }))),
						Effect.forkScoped,
					);
					const lines = SubscriptionRef.changes(ref).pipe(
						Stream.takeUntil((s) => s.done),
						Stream.mapAccum(() => 0, linesFrom),
					);
					return { ref, pump, lines };
				});
			const out = yield* capture(handle.stdout);
			const err = yield* capture(handle.stderr);
			const ending = endingOf(handle.exitCode);
			const spawned: SpawnedBin = {
				stdout: out.lines,
				stderr: err.lines,
				kill: (signal) =>
					handle.kill({ killSignal: signal ?? "SIGTERM", forceKillAfter }).pipe(
						// Core fails a kill once nothing is left to signal: the child already exited, so the kill is done.
						// Its exit has landed by then (Node records it before core can fail), and a child still running
						// keeps the failure.
						Effect.catchTag("PlatformError", (error) =>
							Effect.flatMap(handle.isRunning, (running) => (running ? Effect.fail(error) : Effect.void)),
						),
					),
				exitCode: Effect.map(ending, (end) => end.exitCode),
				result: Effect.gen(function* () {
					const end = yield* ending;
					yield* Fiber.join(out.pump);
					yield* Fiber.join(err.pump);
					return {
						...end,
						stdout: (yield* SubscriptionRef.get(out.ref)).text,
						stderr: (yield* SubscriptionRef.get(err.ref)).text,
					};
				}),
			};
			return spawned;
		});
	};
}
