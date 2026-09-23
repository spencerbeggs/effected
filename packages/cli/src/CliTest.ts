import type { PlatformError, Scope } from "effect";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** @public */
export interface Sandbox {
	readonly root: string;
	readonly home: string;
	readonly env: Readonly<Record<string, string>>;
}

/** @public */
export interface RunOptions {
	readonly sandbox: Sandbox;
	/** The node binary — pass `process.execPath` from the test file, never a PATH lookup. */
	readonly execPath: string;
	readonly cwd?: string | undefined;
	readonly env?: Readonly<Record<string, string>> | undefined;
	readonly stdin?: string | undefined;
}

/** @public */
export interface RunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

const text = <E, R>(stream: Stream.Stream<Uint8Array, E, R>): Effect.Effect<string, E, R> =>
	Stream.mkString(Stream.decodeText(stream));

/**
 * Spawn a built CLI bin hermetically and read its exit code and streams as data.
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
	 * stdin-reading bin exits instead of hanging on `effect/unstable/process`'s
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
				const command = ChildProcess.make(options.execPath, [bin, ...args], {
					cwd: options.cwd ?? options.sandbox.root,
					env: { ...options.sandbox.env, ...options.env },
					stdin:
						options.stdin === undefined || options.stdin === ""
							? Stream.empty
							: Stream.make(new TextEncoder().encode(options.stdin)),
				});
				const handle = yield* spawner.spawn(command);
				// Read both streams and the exit concurrently: sequential reads
				// deadlock once an OS pipe buffer fills.
				const [stdout, stderr, exitCode] = yield* Effect.all(
					[text(handle.stdout), text(handle.stderr), handle.exitCode],
					{ concurrency: "unbounded" },
				);
				return { exitCode: Number(exitCode), stdout, stderr };
			}),
		);
}
