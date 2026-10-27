// Run a piece of work once across concurrent processes: a Vitest `globalSetup`
// pre-build, a turbo pre-step, an install hook.
//
// The protocol is `internal/runOnceMachine.ts`, written once; this module is
// its two drivers. `runSync` answers the protocol's IO from a caller-supplied
// host (`nodeRunOnceHost` from `./node-sync` on Node); `run` answers it with
// core's `FileSystem`, `Clock` and `Random`, plus the `ProcessLiveness` contract
// below. Nothing platform-shaped is imported here.

import { Clock, Context, Duration, Effect, Exit, FileSystem, Layer, Option, Random, Redacted, Result } from "effect";
import type { MachineConfig, MachineOutcome, Request, Responses } from "./internal/runOnceMachine.js";
import { runOnceMachine, validate } from "./internal/runOnceMachine.js";
import { Redaction } from "./Redaction.js";
import { CommandFailedError } from "./Run.js";

/**
 * Settings for one run-once key.
 *
 * @remarks
 * Every timing is a whole number of milliseconds; a non-integer, non-positive
 * or (for `pollMs`) sub-10ms value is a wiring defect and throws (dies, in the
 * `Effect` form) before any IO.
 *
 * @public
 */
export interface RunOnceOptions {
	/**
	 * The identity of the work: callers with the same `key` and `dir` serialize.
	 * Letters, digits, `.`, `_` and `-`, at most 128 characters — hash anything
	 * else (a workspace root plus a command line, say) into one.
	 */
	readonly key: string;
	/**
	 * Directory holding the lock and done-marker files. Runtime state, not data:
	 * prefer an XDG runtime or state directory (`@effected/xdg`'s `AppDirs`) over
	 * a data directory a home-directory sync would carry to another host.
	 *
	 * @remarks
	 * Must be HOST-LOCAL. Breaker exclusion assumes a directory listing reflects
	 * a create at once; a network filesystem's directory cache (NFS above all)
	 * can serve a stale listing, so two would-be breakers could each miss the
	 * other's ticket.
	 */
	readonly dir: string;
	/**
	 * Age after which a lock whose owner cannot be probed — recorded on another
	 * host, or with no readable owner record — is taken over. One probed dead is
	 * taken over at once. One probed ALIVE is taken over only past
	 * `staleMs + waitTimeoutMs` (a recycled pid must not hold the lock forever).
	 * Defaults to 60000.
	 *
	 * @remarks
	 * There is no heartbeat: a lock's age is its creation age. So **across hosts
	 * (a shared lock directory) `staleMs` must exceed the longest the work can
	 * take**, or a slow owner's lock is taken over and the work runs twice; on
	 * one host the same holds for `staleMs + waitTimeoutMs`.
	 */
	readonly staleMs?: number | undefined;
	/** Interval between polls while another owner holds the lock. Defaults to 200; at least 10. */
	readonly pollMs?: number | undefined;
	/**
	 * How long to wait on a live owner before giving up and running the work
	 * unserialized — a slow concurrent run beats a caller hung forever.
	 * Defaults to 600000.
	 */
	readonly waitTimeoutMs?: number | undefined;
	/**
	 * Opt-in: also trust a done marker younger than this from an owner this
	 * caller never observed — a previous, SEQUENTIAL run.
	 *
	 * @remarks
	 * Off by default, because a sequential re-run after a source edit must not
	 * skip the work. Without it, a done marker is trusted only when its writer is
	 * an owner this caller watched hold the lock.
	 */
	readonly trustSequentialMs?: number | undefined;
}

/**
 * How a run-once call ended.
 *
 * @remarks
 * - `Ran` — this caller held the lock and did the work.
 * - `Trusted` — a concurrent owner this caller waited on finished the work
 *   successfully; `owner` is its nonce and `finishedAt` its epoch-millisecond
 *   finish time. The work did not run here.
 * - `RanUnserialized` — the work ran here WITHOUT the lock: `"waitTimeout"`
 *   when a live owner held it past `waitTimeoutMs`, `"lockUnavailable"` when
 *   the lock directory or file could not be created. Serialization is
 *   best-effort; neither case writes a done marker.
 *
 * @public
 */
export type RunOnceOutcome<A> =
	| { readonly _tag: "Ran"; readonly value: A }
	| {
			readonly _tag: "RanUnserialized";
			readonly value: A;
			readonly reason: "waitTimeout" | "lockUnavailable";
	  }
	| { readonly _tag: "Trusted"; readonly owner: string; readonly finishedAt: number };

/**
 * The `ProcessLiveness` service shape: this process's identity and a
 * liveness probe for another process on the same host.
 *
 * @public
 */
export interface ProcessLivenessShape {
	/** This process's id. */
	readonly pid: number;
	/** This host's name. A lock recorded on another host is never pid-probed. */
	readonly host: string;
	/**
	 * Whether the process `pid` on this host is alive. A process that exists
	 * but belongs to another user is alive (signal 0 answers `EPERM`).
	 */
	readonly isAlive: (pid: number) => boolean;
}

/**
 * Contract: who this process is, and whether another process is alive.
 *
 * @remarks
 * Core declares no process-identity or liveness contract, and the probe needs
 * a platform (`process.kill(pid, 0)` on Node), so the kit declares this narrow
 * one and the caller provides it: `ProcessLiveness.layerFrom(nodeProcessLiveness)`
 * with `nodeProcessLiveness` from `@effected/commands/node-sync`.
 *
 * @example
 * ```ts
 * import { NodeServices } from "@effect/platform-node";
 * import { ProcessLiveness, RunOnce } from "@effected/commands";
 * import { nodeProcessLiveness } from "@effected/commands/node-sync";
 * import { Effect, Layer } from "effect";
 *
 * const build = Effect.log("building");
 *
 * // The Effect edge: a platform FileSystem plus the Node liveness probe.
 * const prebuild = RunOnce.run({ key: "prebuild", dir: "/tmp/acme-locks" }, build).pipe(
 *   Effect.provide(Layer.mergeAll(NodeServices.layer, ProcessLiveness.layerFrom(nodeProcessLiveness))),
 * );
 * ```
 *
 * @public
 */
export class ProcessLiveness extends Context.Service<ProcessLiveness, ProcessLivenessShape>()(
	"@effected/commands/ProcessLiveness",
) {
	/**
	 * A layer answering from `shape` — `nodeProcessLiveness` on Node, or a
	 * fixed double in a test.
	 *
	 * @remarks
	 * A parameterized layer mints a fresh reference per call and layers memoize
	 * by reference — bind the result to a `const`.
	 */
	static readonly layerFrom = (shape: ProcessLivenessShape): Layer.Layer<ProcessLiveness> =>
		Layer.succeed(ProcessLiveness, shape);
}

/**
 * The file operations `RunOnce.runSync` needs, supplied by the caller —
 * `nodeRunOnceHost` from `@effected/commands/node-sync` on Node.
 *
 * @remarks
 * Every member may throw; the driver absorbs each failure the protocol has an
 * answer for (an unreadable file reads as absent, a failed remove is retried
 * by a later poll).
 *
 * @public
 */
export interface RunOnceFileSystem {
	/** Creates `path` and its parents. */
	readonly makeDirectory: (path: string) => void;
	/** The text at `path`, or `undefined` when it is missing. */
	readonly readText: (path: string) => string | undefined;
	/**
	 * Creates `path` holding `text` only if nothing is there: `true` when
	 * created, `false` when something already was. Any other failure throws.
	 * A write that fails after the create must NOT remove the file by path:
	 * by then a breaker may have swept it into its tomb and a rival created
	 * its own lock there. Leave it; the protocol takes a garbled lock over
	 * once it is older than `staleMs`.
	 */
	readonly createExclusive: (path: string, text: string) => boolean;
	/** Writes `text` to `path`, replacing it. */
	readonly writeText: (path: string, text: string) => void;
	/** Removes `path`; a missing path is not an error. */
	readonly remove: (path: string) => void;
	/** The modification time of `path` in epoch milliseconds, or `undefined` when it is missing. */
	readonly mtimeMs: (path: string) => number | undefined;
	/**
	 * Atomically renames `from` to `to`, replacing `to`: `true` when renamed,
	 * `false` when `from` is missing. Any other failure throws. The protocol's
	 * compare-and-delete is built on it.
	 */
	readonly rename: (from: string, to: string) => boolean;
	/** The entry names in the directory at `path` — used only to sweep a crashed caller's leftover tombs. */
	readonly readDirectory: (path: string) => ReadonlyArray<string>;
}

/**
 * Everything `RunOnce.runSync` runs against.
 *
 * @public
 */
export interface RunOnceSyncHost {
	/** File operations. */
	readonly fs: RunOnceFileSystem;
	/** This process's identity and the liveness probe. */
	readonly liveness: ProcessLivenessShape;
	/** Epoch milliseconds. */
	readonly now: () => number;
	/** Blocks the calling thread for `ms` milliseconds. */
	readonly sleep: (ms: number) => void;
	/**
	 * A fresh random token, unique across processes. It names files, so it must
	 * be non-empty, hold no `.`, `/` or `\`, and be neither `lock` nor `done`;
	 * `runSync` throws on one that breaks this. `crypto.randomBytes(12)` as hex
	 * qualifies.
	 */
	readonly nonce: () => string;
}

/**
 * What one synchronous run reports — the subset of Node's `spawnSync` result
 * `RunOnce.commandSync` reads.
 *
 * @public
 */
export interface SyncRunResult {
	/** Set when the process could not be started. */
	readonly error?: unknown;
	/** The exit code, or `null` when a signal ended the process. */
	readonly status: number | null;
	/** Captured standard output — the trailing `maxOutputBytes` at most; empty under `"inherit"`. */
	readonly stdout: string;
	/** Captured standard error — the trailing `maxOutputBytes` at most; empty under `"inherit"`. */
	readonly stderr: string;
}

/**
 * Runs `command` with `args` synchronously, with no shell, to completion.
 *
 * @remarks
 * Unlike the probe-shaped `SyncSpawn`, a build runs here: under `"capture"`
 * both streams are collected and a long output must never fail the run — an
 * implementation keeps the trailing `maxOutputBytes` of each stream (the real
 * error is usually last) rather than dying on a buffer limit. Under
 * `"inherit"` the child writes to this process's own streams.
 *
 * @public
 */
export type SyncRun = (
	command: string,
	args: ReadonlyArray<string>,
	options: {
		readonly cwd?: string | undefined;
		readonly stdio: "inherit" | "capture";
		readonly maxOutputBytes: number;
		/**
		 * Windows only: pass `args` to the process verbatim, with no quoting or
		 * escaping — `spawnSync`'s option of the same name. Absent means the
		 * runner's default (escaped).
		 */
		readonly windowsVerbatimArguments?: boolean | undefined;
	},
) => SyncRunResult;

/**
 * `RunOnceSyncHost` plus the synchronous runner `RunOnce.commandSync` spawns through.
 *
 * @public
 */
export interface RunOnceCommandHost extends RunOnceSyncHost {
	/** The runner — `nodeRunSync` from `@effected/commands/node-sync` on Node. */
	readonly run: SyncRun;
}

/**
 * The command `RunOnce.commandSync` runs.
 *
 * @public
 */
export interface RunOnceCommand {
	/** The executable and its arguments. argv only — never a shell. */
	readonly argv: readonly [string, ...Array<string>];
	/** Working directory; the caller's own when omitted. */
	readonly cwd?: string | undefined;
	/** `"capture"` (the default) collects output for the failure; `"inherit"` streams it. */
	readonly stdio?: "inherit" | "capture" | undefined;
	/** Per-stream capture bound; the trailing bytes are kept. Defaults to 1 MiB. */
	readonly maxOutputBytes?: number | undefined;
	/**
	 * Windows only: hand the arguments to the process verbatim, with no quoting
	 * or escaping, as `spawnSync`'s option of the same name does. Set it for a
	 * `cmd.exe /d /s /c "<command line>"` argv, whose quotes `cmd.exe` parses
	 * itself; ignored on other platforms by `nodeRunSync`.
	 */
	readonly windowsVerbatimArguments?: boolean | undefined;
	/** Secrets scrubbed from the argv and the captured output of a failure. */
	readonly redact?: ReadonlyArray<Redacted.Redacted<string>> | undefined;
}

/** The validated protocol settings plus this process's identity. */
const machineConfig = (options: RunOnceOptions, liveness: ProcessLivenessShape): MachineConfig => ({
	...validate(options),
	self: { pid: liveness.pid, host: liveness.host },
	isAlive: (pid) => {
		try {
			return liveness.isAlive(pid);
		} catch {
			// A probe that cannot answer says nothing about death; never take over on it.
			return true;
		}
	},
});

/** Attaches the work's own value to the protocol's outcome. */
const withValue = <A>(outcome: MachineOutcome, value: Option.Option<A>): RunOnceOutcome<A> => {
	if (outcome._tag === "Trusted") return outcome;
	// The protocol answers Ran / RanUnserialized only after a successful Run.
	const succeeded = Option.getOrThrow(value);
	return outcome._tag === "Ran"
		? { _tag: "Ran", value: succeeded }
		: { _tag: "RanUnserialized", value: succeeded, reason: outcome.reason };
};

const absorb =
	<A>(fallback: A) =>
	(f: () => A): A => {
		try {
			return f();
		} catch {
			return fallback;
		}
	};

/**
 * `RunOnceCommand.maxOutputBytes`' default: the TAIL of each stream kept for a
 * failure report. Not `Run`'s `DEFAULT_MAX_OUTPUT_BYTES`, a ceiling whose
 * breach fails the run.
 */
const DEFAULT_TAIL_BYTES = 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The UTF-8 byte length of `text`. */
const utf8Length = (text: string): number => encoder.encode(text).length;

/** The trailing `max` UTF-8 bytes of `text` (a split leading character decodes as U+FFFD). */
const keepTail = (text: string, max: number): string => {
	// A UTF-16 code unit is at most 3 UTF-8 bytes: text this short fits without encoding it.
	if (text.length * 3 <= max) return text;
	const bytes = encoder.encode(text);
	return bytes.length <= max ? text : decoder.decode(bytes.subarray(bytes.length - max));
};

/**
 * Run a piece of work once across concurrent processes.
 *
 * @remarks
 * The first caller to create the lock file does the work; a concurrent caller
 * waits, and trusts the result when the owner it watched finishes
 * successfully. The rules, shared by both forms:
 *
 * - **Trust is nonce-observed.** The done marker carries the finishing
 *   owner's nonce, and a waiter trusts it only when it observed that owner
 *   holding the lock. A previous sequential run is never trusted unless
 *   `trustSequentialMs` opts in.
 * - **A dead owner is taken over at once; a live one only once its lock is
 *   older than `staleMs + waitTimeoutMs`.** The owner record carries the pid
 *   and host; on the same host the pid is probed every poll
 *   (`ProcessLiveness`), and the age limit is what frees a lock whose dead
 *   owner's pid was recycled by a live process. An owner that cannot be
 *   probed — another host, or no readable record — is taken over past
 *   `staleMs`.
 * - **Takeover is serialized by tickets.** Each would-be breaker creates its
 *   own uniquely named ticket (`<key>.lock.break.<nonce>`, carrying its owner
 *   record), lists every ticket, and proceeds only if it sees no other live
 *   one — otherwise it withdraws its ticket and backs off. Of two contenders,
 *   the later lister always sees the earlier one's ticket. An abandoned
 *   ticket (older than `staleMs`, or a dead holder's on this host) is removed
 *   by its unique name, which can only ever hold that one ticket; nothing
 *   about a breaker is ever renamed or put back. The holder re-reads the lock
 *   and removes it only if it is still the one judged breakable. Every owner
 *   seen in any read of the lock joins the trust set.
 * - **Release is owner-only**, by nonce.
 * - **Failure leaves no marker.** A failed run releases the lock; the next
 *   waiter runs the work itself.
 * - **Serialization is best-effort.** Past `waitTimeoutMs`, or when the lock
 *   cannot be created at all, the work runs unserialized
 *   (`RanUnserialized`) rather than hanging or failing the caller.
 * - **Lock removal is compare-and-delete.** A lock is removed by renaming it
 *   to a private tomb and judging what moved — its record AND its age, read
 *   from the tomb, never from the live path; a lock that is not the one
 *   judged is put back with its exact record. Because breakers exclude one
 *   another, a holder's judged lock can change under it only when the holder
 *   itself stalls past `staleMs` (its ticket is then abandoned) or an
 *   alive-probed owner aged past `staleMs + waitTimeoutMs` releases at that
 *   very moment — the residual race, which needs one of those and a third
 *   caller creating in the instant between the rename and the put-back. An unparseable file is never put back (a creator caught
 *   between its create and its write retries), and neither is a tomb that
 *   vanished. A tomb's name carries the time of its rename — a rename keeps
 *   the old mtime — and tombs a crashed caller left behind are swept once that
 *   time is older than `staleMs`. A lock emptied between a non-atomic create
 *   and its write is repaired by its creator.
 * - **A lock whose write failed is left, not removed** — a deliberate
 *   liveness cost. When the exclusive create succeeds and the write of the
 *   record then fails, the caller runs unserialized and leaves the file in
 *   place. Removing it by path could delete a rival's live lock: a breaker
 *   may have swept the half-written file into its tomb, and the rival may
 *   have created its lock at the path since. Left alone, the garbled file
 *   reads as a lock with no record and is taken over once older than
 *   `staleMs`. Until then other callers wait, or run unserialized past
 *   `waitTimeoutMs`.
 * - **Release retries.** A release whose rename fails outright — on Windows, a
 *   scanner or indexer holding the file without share-delete answers
 *   `EPERM`/`EBUSY` for a moment — is retried five times over about 400ms.
 * - **Ages come from the filesystem.** A lock's age is the local clock minus
 *   the file's modification time. On NFS (or any network filesystem) that time
 *   is the SERVER's, and a client's attribute cache can serve it late, so ages
 *   skew by the clock offset plus the cache lifetime: keep `staleMs` well above
 *   both when the lock directory is shared across hosts.
 * - **Residual risks**, all needing work that outlives the age limits above: a
 *   work duration past `staleMs` across hosts, or past
 *   `staleMs + waitTimeoutMs` on one host, can be taken over (no heartbeat);
 *   a dead owner whose pid was recycled holds the lock until
 *   `staleMs + waitTimeoutMs`; a live breaker holder suspended for longer
 *   than `staleMs` (a laptop asleep mid-break) has its ticket aged out while
 *   it still acts, which re-opens the put-back race above; and a ticket left
 *   by a crash is reaped only by a later takeover attempt, never by the tomb
 *   sweep, so it lingers on disk until one happens — a same-host holder's
 *   ticket is reaped at once (its pid is dead), another host's only once it
 *   is older than `staleMs`, holding that takeover back until then.
 *
 * @public
 */
export class RunOnce {
	private constructor() {}

	/**
	 * The synchronous form, over a caller-supplied host.
	 *
	 * @remarks
	 * For a caller with no Effect runtime — a Vitest `globalSetup`, config
	 * evaluation, a Node SEA sidecar. `run` reports its own failure as a
	 * `Result` failure, which leaves no done marker and is returned as is; a
	 * throw from `run` releases the lock and is rethrown.
	 *
	 * @example
	 * ```ts
	 * import { RunOnce } from "@effected/commands";
	 * import { nodeRunOnceHost } from "@effected/commands/node-sync";
	 * import { Result } from "effect";
	 *
	 * RunOnce.runSync({ key: "prebuild-3f9a", dir: lockDir }, nodeRunOnceHost, () => {
	 *   build();
	 *   return Result.succeed(undefined);
	 * });
	 * ```
	 */
	static readonly runSync = <A, E>(
		options: RunOnceOptions,
		host: RunOnceSyncHost,
		run: () => Result.Result<A, E>,
	): Result.Result<RunOnceOutcome<A>, E> => {
		const config = machineConfig(options, host.liveness);
		const { fs } = host;
		let ran: Option.Option<Result.Result<A, E>> = Option.none();
		let thrown: { readonly error: unknown } | undefined;

		const answer = (request: Request): Responses[Request["_tag"]] => {
			switch (request._tag) {
				case "Now":
					return host.now();
				case "Nonce":
					return host.nonce();
				case "Sleep":
					host.sleep(request.ms);
					return undefined;
				case "MakeDirectory":
					return absorb(false)(() => {
						fs.makeDirectory(request.path);
						return true;
					});
				case "ReadText":
					return absorb<string | undefined>(undefined)(() => fs.readText(request.path));
				case "CreateExclusive":
					return absorb<"created" | "exists" | "failed">("failed")(() =>
						fs.createExclusive(request.path, request.text) ? "created" : "exists",
					);
				case "WriteText":
					return absorb(undefined)(() => {
						fs.writeText(request.path, request.text);
						return undefined;
					});
				case "Remove":
					return absorb(undefined)(() => {
						fs.remove(request.path);
						return undefined;
					});
				case "ListDirectory":
					return absorb<ReadonlyArray<string> | undefined>(undefined)(() => fs.readDirectory(request.path));
				case "Backoff":
					host.sleep(request.ms);
					return undefined;
				case "Rename":
					return absorb<"renamed" | "missing" | "failed">("failed")(() =>
						fs.rename(request.from, request.to) ? "renamed" : "missing",
					);
				case "AgeMs":
					return absorb<number | undefined>(undefined)(() => {
						const mtime = fs.mtimeMs(request.path);
						return mtime === undefined ? undefined : host.now() - mtime;
					});
				case "Run":
					try {
						const result = run();
						ran = Option.some(result);
						return Result.isSuccess(result) ? "succeeded" : "failed";
					} catch (error) {
						thrown = { error };
						return "failed";
					}
			}
		};

		const machine = runOnceMachine(config);
		let step = machine.next();
		while (step.done !== true) step = machine.next(answer(step.value));
		if (thrown !== undefined) throw thrown.error;
		const outcome = step.value;
		if (Option.isSome(ran) && Result.isFailure(ran.value)) return Result.fail(ran.value.failure);
		return Result.succeed(
			withValue(
				outcome,
				Option.flatMap(ran, (result) => Result.getSuccess(result)),
			),
		);
	};

	/**
	 * `RunOnce.runSync` over an argv command: runs it through
	 * `host.run`, never a shell, and reads a non-zero exit as failure.
	 *
	 * @remarks
	 * Fails with `CommandFailedError` — `kind: "spawn"` when the process could
	 * not start, `"nonZero"` when it exited non-zero or was ended by a signal
	 * (no `exitCode` then) — carrying the redacted argv and, under
	 * `"capture"`, the trailing output of both streams, redacted. A failure
	 * leaves no done marker.
	 */
	static readonly commandSync = (
		options: RunOnceOptions,
		host: RunOnceCommandHost,
		command: RunOnceCommand,
	): Result.Result<RunOnceOutcome<SyncRunResult>, CommandFailedError> => {
		const [executable, ...args] = command.argv;
		const secrets = command.redact ?? [];
		const maxOutputBytes = command.maxOutputBytes ?? DEFAULT_TAIL_BYTES;
		if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
			throw new Error(`RunOnce: maxOutputBytes must be a positive integer, received ${maxOutputBytes}`);
		}
		const safeArgs = Redaction.scrubArgs(Redaction.applyArgs(args, secrets));
		// Redact BEFORE the final cut: ask the runner for enough extra trailing
		// bytes that any secret overlapping the kept window lies whole inside
		// what was fetched, scrub that, then keep the last `maxOutputBytes`. A
		// tail-then-redact order leaks the suffix of a secret straddling the cut.
		const slack = secrets.reduce((longest, secret) => Math.max(longest, utf8Length(Redacted.value(secret))), 0);
		const scrub = (text: string): string => keepTail(Redaction.apply(text, secrets), maxOutputBytes);
		return RunOnce.runSync(options, host, (): Result.Result<SyncRunResult, CommandFailedError> => {
			let result: SyncRunResult;
			try {
				result = host.run(executable, args, {
					...(command.cwd === undefined ? {} : { cwd: command.cwd }),
					stdio: command.stdio ?? "capture",
					maxOutputBytes: maxOutputBytes + slack,
					...(command.windowsVerbatimArguments === undefined
						? {}
						: { windowsVerbatimArguments: command.windowsVerbatimArguments }),
				});
			} catch (cause) {
				// A runner that throws (an argument the platform refuses outright)
				// is a process that could not start.
				return Result.fail(new CommandFailedError({ kind: "spawn", command: executable, args: safeArgs, cause }));
			}
			result = { ...result, stdout: scrub(result.stdout), stderr: scrub(result.stderr) };
			if (result.error !== undefined) {
				return Result.fail(
					new CommandFailedError({ kind: "spawn", command: executable, args: safeArgs, cause: result.error }),
				);
			}
			if (result.status === 0) return Result.succeed(result);
			return Result.fail(
				new CommandFailedError({
					kind: "nonZero",
					command: executable,
					args: safeArgs,
					...(result.status === null ? {} : { exitCode: result.status }),
					stdout: result.stdout,
					stderr: result.stderr,
				}),
			);
		});
	};

	/**
	 * The `Effect` form: runs `effect` once across concurrent processes.
	 *
	 * @remarks
	 * Lock files go through core's `FileSystem`; time is `Clock` (so `TestClock`
	 * drives the polling) and the nonce is `Random`; liveness is
	 * `ProcessLiveness`. `effect`'s failure leaves no done marker and is
	 * re-raised after the lock is released; an interruption during `effect`
	 * likewise releases the lock first. The protocol itself is uninterruptible
	 * while it holds the lock and interruptible while it polls.
	 *
	 * @example
	 * ```ts
	 * import { NodeServices } from "@effect/platform-node";
	 * import { ProcessLiveness, RunOnce } from "@effected/commands";
	 * import { nodeProcessLiveness } from "@effected/commands/node-sync";
	 * import { Effect, Layer } from "effect";
	 *
	 * const build = Effect.log("building");
	 *
	 * // The Effect edge: a platform FileSystem plus the Node liveness probe.
	 * const prebuild = RunOnce.run({ key: "prebuild", dir: "/tmp/acme-locks" }, build).pipe(
	 *   Effect.provide(Layer.mergeAll(NodeServices.layer, ProcessLiveness.layerFrom(nodeProcessLiveness))),
	 * );
	 * ```
	 */
	static readonly run = <A, E, R>(
		options: RunOnceOptions,
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<RunOnceOutcome<A>, E, R | FileSystem.FileSystem | ProcessLiveness> =>
		Effect.uninterruptibleMask((restore) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const liveness = yield* ProcessLiveness;
				const config = yield* Effect.try({
					try: () => machineConfig(options, liveness),
					catch: (error) => error,
				}).pipe(Effect.orDie);
				let ran: Option.Option<Exit.Exit<A, E>> = Option.none();

				const answer = (request: Request): Effect.Effect<Responses[Request["_tag"]], never, R> => {
					switch (request._tag) {
						case "Now":
							return Clock.currentTimeMillis;
						case "Nonce":
							return Effect.all(Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffffffff))).pipe(
								Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
							);
						case "Sleep":
							return restore(Effect.sleep(Duration.millis(request.ms))).pipe(Effect.as(undefined));
						case "MakeDirectory":
							return fs.makeDirectory(request.path, { recursive: true }).pipe(
								Effect.as(true),
								Effect.orElseSucceed(() => false),
							);
						case "ReadText":
							return fs.readFileString(request.path).pipe(
								Effect.map((text): string | undefined => text),
								Effect.orElseSucceed(() => undefined),
							);
						case "CreateExclusive":
							// Open and write are kept apart so a failed open (EMFILE, EACCES),
							// which created nothing, is told from a failed write. Neither removes
							// anything: by a failed write, a breaker may have swept our file into
							// its tomb and a rival created its lock at the path, so a remove by
							// path could delete a live lock. The garbled file is left for the
							// stale rule (see RunOnce's remarks).
							return Effect.scoped(
								Effect.flatMap(fs.open(request.path, { flag: "wx" }), (file) =>
									Effect.result(file.writeAll(encoder.encode(request.text))),
								),
							).pipe(
								Effect.matchEffect({
									onFailure: (error) =>
										Effect.succeed<"created" | "exists" | "failed">(
											error.reason._tag === "AlreadyExists" ? "exists" : "failed",
										),
									onSuccess: (written) =>
										Effect.succeed<"created" | "exists" | "failed">(Result.isSuccess(written) ? "created" : "failed"),
								}),
							);
						case "WriteText":
							return fs.writeFileString(request.path, request.text).pipe(Effect.ignore, Effect.as(undefined));
						case "Remove":
							return fs.remove(request.path).pipe(Effect.ignore, Effect.as(undefined));
						case "ListDirectory":
							return fs.readDirectory(request.path).pipe(
								Effect.map((names): ReadonlyArray<string> | undefined => names),
								Effect.orElseSucceed(() => undefined),
							);
						case "Backoff":
							// Deliberately NOT restored: a backoff happens while the lock is
							// held (a retried release), where an interruption must wait.
							return Effect.sleep(Duration.millis(request.ms)).pipe(Effect.as(undefined));
						case "Rename":
							return fs.rename(request.from, request.to).pipe(
								Effect.as<"renamed" | "missing" | "failed">("renamed"),
								Effect.catch((error) =>
									Effect.succeed<"renamed" | "missing" | "failed">(
										error.reason._tag === "NotFound" ? "missing" : "failed",
									),
								),
							);
						case "AgeMs":
							return Effect.all([fs.stat(request.path), Clock.currentTimeMillis]).pipe(
								Effect.map(([info, now]): number | undefined =>
									Option.match(info.mtime, { onNone: () => 0, onSome: (mtime) => now - mtime.getTime() }),
								),
								Effect.orElseSucceed(() => undefined),
							);
						case "Run":
							return restore(effect).pipe(
								Effect.exit,
								Effect.map((exit) => {
									ran = Option.some(exit);
									return Exit.isSuccess(exit) ? "succeeded" : "failed";
								}),
							);
					}
				};

				const machine = runOnceMachine(config);
				let step = machine.next();
				while (step.done !== true) step = machine.next(yield* answer(step.value));
				const outcome = step.value;
				yield* Effect.annotateCurrentSpan({ "runOnce.key": config.key, "runOnce.outcome": outcome._tag });
				if (Option.isSome(ran) && Exit.isFailure(ran.value)) return yield* Effect.failCause(ran.value.cause);
				return withValue(outcome, Option.flatMap(ran, Exit.getSuccess));
			}),
		).pipe(Effect.withSpan("RunOnce.run"));
}
