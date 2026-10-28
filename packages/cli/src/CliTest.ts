import type { PlatformError, Scope } from "effect";
import { Effect, Fiber, FileSystem, Path, Stream, SubscriptionRef } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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
}

/**
 * What a spawned bin did, as data: a non-zero exit is a result, not a failure.
 *
 * @public
 */
export interface RunResult {
	/** The child's exit code. */
	readonly exitCode: number;
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
	 * Send `signal` (`SIGTERM` by default) and wait for the child to exit. A child that ignores the signal keeps this
	 * waiting: bound it with `Effect.timeout`.
	 */
	readonly kill: (signal?: ChildProcess.Signal) => Effect.Effect<void, PlatformError.PlatformError>;
	/** The child's exit code, once it exits; re-reading it after the exit answers at once. */
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
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

const commandOf = (bin: string, args: ReadonlyArray<string>, options: RunOptions): ChildProcess.Command =>
	ChildProcess.make(options.execPath, [bin, ...args], {
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
	): Effect.Effect<RunResult, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
		Effect.scoped(
			Effect.gen(function* () {
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
				const handle = yield* spawner.spawn(commandOf(bin, args, options));
				// Read both streams and the exit concurrently: sequential reads
				// deadlock once an OS pipe buffer fills.
				const [stdout, stderr, exitCode] = yield* Effect.all(
					[text(handle.stdout), text(handle.stderr), handle.exitCode],
					{ concurrency: "unbounded" },
				);
				return { exitCode: Number(exitCode), stdout, stderr };
			}),
		);

	/**
	 * Start `execPath bin ...args` and return at once with a handle on it: its output as lines while it runs, a signal,
	 * and its exit, for a long-running command (a `--follow`, a watch mode, a server) that {@link CliTest.run} would wait
	 * on forever.
	 *
	 * @remarks
	 * The child lives in the caller's scope: when the scope closes first, the child is killed, so a test that ends
	 * early leaves nothing running. Both streams are drained from the start whether or not the test reads them, so a
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
	): Effect.Effect<SpawnedBin, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(commandOf(bin, args, options));
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
			const exitCode = Effect.map(handle.exitCode, Number);
			const spawned: SpawnedBin = {
				stdout: out.lines,
				stderr: err.lines,
				kill: (signal) => handle.kill(signal === undefined ? undefined : { killSignal: signal }),
				exitCode,
				result: Effect.gen(function* () {
					const code = yield* exitCode;
					yield* Fiber.join(out.pump);
					yield* Fiber.join(err.pump);
					return {
						exitCode: code,
						stdout: (yield* SubscriptionRef.get(out.ref)).text,
						stderr: (yield* SubscriptionRef.get(err.ref)).text,
					};
				}),
			};
			return spawned;
		});
}
