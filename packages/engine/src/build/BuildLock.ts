// One build of a package at a time, across processes: a lock file under the workspace root that a build holds from
// before the bundler cleans `dist` until its answer is journalled. Two builds of one package in one tree (a test's
// setup build racing a turbo build) would otherwise clean and write the same `dist/prod`, and a runner caching `dist`
// after one of them exits would store the other's half-written output under a pass.

import type { PlatformError, Scope } from "effect";
import { Clock, Duration, Effect, FileSystem, Option, Path, Schema } from "effect";

/**
 * Who holds a package's build lock, as its lock file records it.
 *
 * @public
 */
export class BuildLockHolder extends Schema.Class<BuildLockHolder>("BuildLockHolder")({
	/** The holding process. */
	pid: Schema.Number,
	/** When it took the lock, as an ISO timestamp. */
	startedAt: Schema.String,
	/** The package directory it is building. */
	cwd: Schema.String,
}) {}

/**
 * Another build of the same package held the lock for the whole wait.
 *
 * @public
 */
export class BuildLockTimeoutError extends Schema.TaggedError<BuildLockTimeoutError>()("BuildLockTimeoutError", {
	/** The lock file. */
	lockPath: Schema.String,
	/** The build holding it when the wait ran out, when its lock file could be read. */
	holder: Schema.optionalKey(BuildLockHolder),
	/** How long this build waited, in milliseconds. */
	waitedMs: Schema.Number,
}) {
	override get message(): string {
		const holder =
			this.holder !== undefined
				? `process ${this.holder.pid}, building ${this.holder.cwd} since ${this.holder.startedAt}`
				: "a build whose lock file could not be read";
		return `Another build of this package held ${this.lockPath} for ${Math.round(this.waitedMs / 1000)}s: ${holder}. Wait for it to finish, or delete the lock file if no build is running.`;
	}
}

/**
 * How a build waits for its package's lock, and the test seams.
 *
 * @public
 */
export interface BuildLockOptions {
	/** How long to wait for another build of the package; omitted, five minutes. */
	readonly timeout?: Duration.Input;
	/** How often to look again while waiting; omitted, 200 milliseconds. */
	readonly pollInterval?: Duration.Input;
	/** This process's id, written into the lock; omitted, `process.pid`. */
	readonly pid?: number;
	/** Whether a holder's process still runs; omitted, a signal-0 probe of the pid. */
	readonly isAlive?: (pid: number) => boolean;
}

const DEFAULT_TIMEOUT: Duration.Input = "5 minutes";
const DEFAULT_POLL: Duration.Input = "200 millis";
// A lock file is created and written in one call, so one that does not decode is a writer caught between the two, or
// one that died there. Past this age it is the second.
const TORN_GRACE_MS = 5_000;

/** A pid that answers signal 0 runs; `EPERM` means it runs under another user. */
const hostIsAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as { readonly code?: unknown }).code === "EPERM";
	}
};

const decodeHolder = Schema.decodeUnknownOption(Schema.fromJsonString(BuildLockHolder));
const encodeHolder = Schema.encodeSync(Schema.fromJsonString(BuildLockHolder));

/** The lock file for a package, under the workspace root. A scoped name keeps its scope, with `/` as `+`. */
export const buildLockPath = (path: Path.Path, root: string, packageName: string): string =>
	path.join(root, ".cache", "effected", "locks", `${packageName.replace(/[^A-Za-z0-9._@-]/g, "+")}.lock`);

/**
 * Holds a package's build lock for the enclosing scope.
 *
 * @remarks
 * The lock is a file created exclusively, holding the process id, the start time and the package directory. While
 * another build holds it, this one waits, telling `onWaiting` once who it waits for, and fails
 * {@link BuildLockTimeoutError} when the wait runs out. A lock whose process no longer runs is removed and taken, and
 * so is one that never got its content. The lock is released when the scope closes, interruption included, and only
 * when the file is still this build's.
 *
 * Two waiters can find the same dead holder at once. Each removes the file only when it still reads as the dead
 * holder's, which narrows the window in which one removes a lock the other has just taken, but does not close it.
 */
export const acquireBuildLock = (
	lockPath: string,
	cwd: string,
	options: BuildLockOptions = {},
	onWaiting: (holder: Option.Option<BuildLockHolder>) => Effect.Effect<void> = () => Effect.void,
): Effect.Effect<
	void,
	BuildLockTimeoutError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const isAlive = options.isAlive ?? hostIsAlive;
		const pollMs = Duration.toMillis(options.pollInterval ?? DEFAULT_POLL);
		const startMs = yield* Clock.currentTimeMillis;
		const deadline = startMs + Duration.toMillis(options.timeout ?? DEFAULT_TIMEOUT);
		const ours = encodeHolder(
			BuildLockHolder.make({
				pid: options.pid ?? process.pid,
				startedAt: new Date(startMs).toISOString(),
				cwd,
			}),
		);

		yield* fs.makeDirectory(path.dirname(lockPath), { recursive: true });

		const readHolder = fs.readFileString(lockPath).pipe(
			Effect.map(Option.some),
			Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
		);
		/** Removes the lock when it still reads `text`, so a lock taken since is left alone. */
		const reclaim = (text: string) =>
			readHolder.pipe(
				Effect.flatMap((now) => (Option.isSome(now) && now.value === text ? fs.remove(lockPath) : Effect.void)),
				Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
			);
		// The create and its release are one step, so an interruption cannot land between taking the lock and
		// registering the finalizer that gives it back. A failed attempt's finalizer does nothing.
		const tryCreate = Effect.acquireRelease(
			fs.writeFileString(lockPath, ours, { flag: "wx" }).pipe(
				Effect.as(true),
				Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
			),
			(created) => (created ? reclaim(ours).pipe(Effect.ignore) : Effect.void),
		);
		const isTorn = fs.stat(lockPath).pipe(
			Effect.flatMap((info) =>
				Effect.map(Clock.currentTimeMillis, (now) =>
					Option.match(info.mtime, { onNone: () => true, onSome: (mtime) => now - mtime.getTime() > TORN_GRACE_MS }),
				),
			),
			Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
		);

		let told = false;
		while (!(yield* tryCreate)) {
			const text = yield* readHolder;
			// Released between the create and the read: try again at once.
			if (Option.isNone(text)) continue;
			const holder = decodeHolder(text.value);
			if (Option.isSome(holder) ? !isAlive(holder.value.pid) : yield* isTorn) {
				yield* reclaim(text.value);
				continue;
			}
			if (!told) {
				told = true;
				yield* onWaiting(holder);
			}
			const now = yield* Clock.currentTimeMillis;
			if (now >= deadline) {
				return yield* new BuildLockTimeoutError({
					lockPath,
					...(Option.isSome(holder) ? { holder: holder.value } : {}),
					waitedMs: now - startMs,
				});
			}
			yield* Effect.sleep(pollMs);
		}
	});
