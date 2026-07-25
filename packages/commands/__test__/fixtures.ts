import { Effect, Layer, PlatformError, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/**
 * One scripted outcome for a spawned command: a completed run
 * (stdout/stderr/exit, or `hang: true` to never resolve `exitCode`, which
 * exercises a caller-supplied timeout), or a `PlatformError` to fail the spawn
 * itself with.
 */
export type ScriptResult =
	| { readonly stdout?: string; readonly stderr?: string; readonly exit?: number; readonly hang?: boolean }
	| PlatformError.PlatformError;

/** What the scripted spawner observed for one spawn. */
export interface SpawnRecord {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	/** The CommandOptions exactly as the spawner received them — env/extendEnv assertions read these. */
	readonly options: ChildProcess.CommandOptions;
	/** Set when the handle's `unref` effect actually RAN (not merely was built). */
	unrefed: boolean;
}

/** A scripted spawner plus the log of what it was asked to spawn. */
export interface ScriptedSpawner {
	readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
	readonly spawns: ReadonlyArray<SpawnRecord>;
}

/** `PlatformError` for an executable that is not on PATH. */
export const notFound = (command: string): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: "NotFound",
		module: "ChildProcess",
		method: "spawn",
		description: `spawn ${command} ENOENT`,
	});

/** `PlatformError` for a spawn that failed for a reason other than absence. */
export const permissionDenied = (command: string): PlatformError.PlatformError =>
	PlatformError.systemError({
		_tag: "PermissionDenied",
		module: "ChildProcess",
		method: "spawn",
		description: `spawn ${command} EACCES`,
	});

/**
 * A scripted mock `ChildProcessSpawner`. `script` receives the executable and
 * argv of each spawn and returns either a completed-run script or a
 * `PlatformError`.
 *
 * @remarks
 * Every recorder here is wrapped in `Effect.sync`/`Effect.suspend` so it fires
 * when the effect RUNS, never when it is merely constructed — an eager recorder
 * reports calls that never happened.
 */
export const scripted = (script: (command: string, args: ReadonlyArray<string>) => ScriptResult): ScriptedSpawner => {
	const spawns: Array<SpawnRecord> = [];
	const layer = Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make((command) => {
			if (!ChildProcess.isStandardCommand(command)) {
				return Effect.die("piped commands are not scripted by this fixture");
			}
			return Effect.suspend(() => {
				const result = script(command.command, command.args);
				const record: SpawnRecord = {
					command: command.command,
					args: command.args,
					options: command.options,
					unrefed: false,
				};
				spawns.push(record);
				if (result instanceof PlatformError.PlatformError) {
					return Effect.fail(result);
				}
				return Effect.succeed(
					ChildProcessSpawner.makeHandle({
						pid: ChildProcessSpawner.ProcessId(4242),
						exitCode:
							result.hang === true ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(result.exit ?? 0)),
						isRunning: Effect.succeed(false),
						kill: () => Effect.void,
						stdin: Sink.drain,
						stdout: bytes(result.stdout ?? ""),
						stderr: bytes(result.stderr ?? ""),
						all: bytes(`${result.stdout ?? ""}${result.stderr ?? ""}`),
						getInputFd: () => Sink.drain,
						getOutputFd: () => Stream.empty,
						unref: Effect.sync(() => {
							record.unrefed = true;
							return Effect.void;
						}),
					}),
				);
			});
		}),
	);
	return { layer, spawns };
};

/** A stream of one UTF-8 chunk. */
const bytes = (text: string): Stream.Stream<Uint8Array, PlatformError.PlatformError> =>
	text === "" ? Stream.empty : Stream.make(new TextEncoder().encode(text));
