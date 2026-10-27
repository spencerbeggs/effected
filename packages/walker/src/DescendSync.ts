// The synchronous escape hatch for the downward walk — over a CONSUMER-SUPPLIED
// file port.
//
// Vitest config evaluation and a Node SEA sidecar run before (or without) any
// Effect runtime. This module answers the shared walk's requests
// (`internal/descendMachine.ts`) synchronously, so `descendSync` matches
// exactly what `descend` matches — the same prefix, prune, boundary, symlink
// and error rules, from the same code. It imports nothing platform-shaped:
// `@effected/walker/node-sync` binds the port to `node:fs` / `node:path`.

import type { GlobPattern } from "@effected/glob";
import { Result } from "effect";
import type { DescendOptions, DescendRecordOptions } from "./Descend.js";
import { DescendError } from "./Descend.js";
import type { DescendRequest, ReadAnswer, StatAnswer } from "./internal/descendMachine.js";
import { descendMachine } from "./internal/descendMachine.js";

/**
 * The stats {@link WalkerSyncFileSystem} answers — a structural subset of
 * `node:fs` `Stats`, so `statSync` / `lstatSync` satisfy it verbatim.
 *
 * @public
 */
export interface WalkerSyncStats {
	/** Whether the entry is a regular file. */
	isFile(): boolean;
	/** Whether the entry is a directory. */
	isDirectory(): boolean;
	/** Whether the entry is a symbolic link (only ever true for `lstat`). */
	isSymbolicLink(): boolean;
	/** Modification time, epoch milliseconds. */
	readonly mtimeMs: number;
	/** Size in bytes. */
	readonly size: number;
}

/**
 * The synchronous file operations the sync walk needs, supplied by the
 * consumer — `node:fs` satisfies it (`nodeWalkerFileSystem` from
 * `@effected/walker/node-sync`).
 *
 * @remarks
 * Every member reports failure by throwing a node-shaped error. A `code` of
 * `"ENOENT"` is the benign vanished-path race (empty, never recorded); any
 * other throw from `readDirectory` or `realPath` is an unreadable directory,
 * handled per `onUnreadable`. A throwing `stat` reads as "no entry" and a
 * throwing `lstat` as "not a link", exactly as the `Effect` walk reads its
 * failed `stat` and `readLink`.
 *
 * @public
 */
export interface WalkerSyncFileSystem {
	/** The entry names inside the directory at `path` (`readdirSync`). */
	readonly readDirectory: (path: string) => ReadonlyArray<string>;
	/** Stats of `path`, following links (`statSync`). */
	readonly stat: (path: string) => WalkerSyncStats;
	/** Stats of `path` itself, not following a final link (`lstatSync`). */
	readonly lstat: (path: string) => WalkerSyncStats;
	/** The real path of `path`, links resolved (`realpathSync`). */
	readonly realPath: (path: string) => string;
}

/**
 * The synchronous path operation the sync walk needs — a structural subset of
 * `node:path`, so the module itself (or its `win32` / `posix` variant)
 * satisfies it. It shapes only the absolute paths handed to the
 * {@link WalkerSyncFileSystem}; matching is POSIX-relative by the glob
 * contract.
 *
 * @public
 */
export interface WalkerSyncPath {
	/** Join segments with the implementation's separator (like `path.join`). */
	readonly join: (...segments: ReadonlyArray<string>) => string;
}

/**
 * The platform half of every sync walk.
 *
 * @public
 */
export interface WalkerSyncOps {
	/** File operations. */
	readonly fileSystem: WalkerSyncFileSystem;
	/** Path joining. */
	readonly path: WalkerSyncPath;
}

/**
 * Options for `descendSync` / `descendEntriesSync`: every `DescendOptions`
 * field, plus the platform.
 *
 * @public
 */
export interface DescendSyncOptions extends DescendOptions, WalkerSyncOps {}

/**
 * {@link DescendSyncOptions} under `onUnreadable: "record"`.
 *
 * @public
 */
export interface DescendSyncRecordOptions extends DescendRecordOptions, WalkerSyncOps {}

/**
 * One directory the sync walk could not read under `onUnreadable: "record"`:
 * its `cwd`-relative path (`""` for the walk base) and what the port threw.
 *
 * @public
 */
export interface UnreadableDirectorySync {
	/** The directory's path relative to `cwd`, POSIX separators; `""` is the walk base. */
	readonly path: string;
	/** What `readDirectory` (or, for a link under `followSymlinks`, `realPath`) threw — never an `ENOENT`. */
	readonly cause: unknown;
}

/**
 * `descendSync`'s success value under `onUnreadable: "record"`.
 *
 * @public
 */
export interface DescendSyncResult {
	/** Matching FILE paths relative to `cwd`, POSIX separators, sorted. */
	readonly matches: ReadonlyArray<string>;
	/** Directories that could not be read, in walk order. */
	readonly unreadable: ReadonlyArray<UnreadableDirectorySync>;
}

/**
 * One matched file with its stat — `descendEntriesSync`' element.
 *
 * @public
 */
export interface DescendSyncEntry {
	/** The file's path relative to `cwd`, POSIX separators. */
	readonly path: string;
	/** `stat` of the file, links followed. */
	readonly stat: WalkerSyncStats;
}

/**
 * `descendEntriesSync`' success value under `onUnreadable: "record"`.
 *
 * @public
 */
export interface DescendEntriesSyncResult {
	/** Matching files with their stats, sorted by path. */
	readonly matches: ReadonlyArray<DescendSyncEntry>;
	/** Directories that could not be read, in walk order. */
	readonly unreadable: ReadonlyArray<UnreadableDirectorySync>;
}

type AnySyncOptions = Omit<DescendSyncOptions, "onUnreadable"> & {
	readonly onUnreadable?: "fail" | "skip" | "record";
};

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";

const kindOf = (stats: WalkerSyncStats): "File" | "Directory" | "Other" =>
	stats.isFile() ? "File" : stats.isDirectory() ? "Directory" : "Other";

/** The sync driver of the shared walk. Throws only for a defect (an invalid `maxDepth`). */
const walkSync = (
	pattern: GlobPattern,
	options: AnySyncOptions,
): Result.Result<
	{
		readonly entries: ReadonlyArray<DescendSyncEntry>;
		readonly unreadable: ReadonlyArray<UnreadableDirectorySync>;
	},
	DescendError
> => {
	const { fileSystem, path } = options;
	const read = <T>(f: () => T): ReadAnswer<T, unknown> => {
		try {
			return { _tag: "Ok", value: f() };
		} catch (cause) {
			return isNotFound(cause) ? { _tag: "NotFound" } : { _tag: "Failed", cause };
		}
	};
	const answer = (request: DescendRequest): unknown => {
		switch (request._tag) {
			case "Stat":
				try {
					const info = fileSystem.stat(request.path);
					return { kind: kindOf(info), info } satisfies StatAnswer<WalkerSyncStats>;
				} catch {
					return undefined;
				}
			case "IsSymbolicLink":
				try {
					return fileSystem.lstat(request.path).isSymbolicLink();
				} catch {
					return false;
				}
			case "RealPath":
				return read(() => fileSystem.realPath(request.path));
			case "ReadDirectory":
				return read(() => fileSystem.readDirectory(request.path));
		}
	};

	const machine = descendMachine<WalkerSyncStats, unknown>(pattern, options, (a, b) => path.join(a, b));
	let step = machine.next();
	while (step.done !== true) step = machine.next(answer(step.value));
	const result = step.value;
	if (result._tag === "Defect") throw new Error(result.message);
	if (result._tag === "Fail") {
		return Result.fail(
			new DescendError({
				pattern: pattern.source,
				reason: result.reason,
				path: result.path,
				...(result.limit === undefined ? {} : { limit: result.limit }),
			}),
		);
	}
	return Result.succeed({
		entries: result.entries.map((entry) => ({ path: entry.path, stat: entry.info })),
		unreadable: result.unreadable,
	});
};

/**
 * `descend` under `onUnreadable: "record"`, synchronously over a caller-supplied port.
 *
 * @public
 */
export function descendSync(
	pattern: GlobPattern,
	options: DescendSyncRecordOptions,
): Result.Result<DescendSyncResult, DescendError>;
/**
 * `descend`, synchronously, over a caller-supplied file port: matching FILE
 * paths relative to `cwd` (POSIX separators), sorted.
 *
 * @remarks
 * The same walk as `descend` — it drives the same traversal, so every rule
 * holds identically: the literal fast path, the enumeration prefix, `prune`,
 * `boundaries`, the symlink posture and per-branch cycle guard under
 * `followSymlinks`, `onUnreadable` and the `maxDepth` failure. Failures are a
 * `Result` failure typed as `DescendError`; an invalid `maxDepth` is a defect
 * and throws. For a caller with no Effect runtime (config evaluation, a Node
 * SEA sidecar); inside Effect, use `descend`.
 *
 * @example
 * ```ts
 * import { GlobPattern } from "@effected/glob";
 * import { descendSync } from "@effected/walker";
 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
 * import { Result } from "effect";
 *
 * const pattern = Result.getOrThrow(GlobPattern.compileResult("src/**"));
 * const files = descendSync(pattern, { cwd: "/repo", boundaries: ["package.json"], ...nodeWalkerSyncOps });
 * ```
 *
 * @public
 */
export function descendSync(
	pattern: GlobPattern,
	options: DescendSyncOptions,
): Result.Result<ReadonlyArray<string>, DescendError>;
export function descendSync(
	pattern: GlobPattern,
	options: DescendSyncOptions | DescendSyncRecordOptions,
): Result.Result<ReadonlyArray<string> | DescendSyncResult, DescendError> {
	return Result.map(walkSync(pattern, options), ({ entries, unreadable }) => {
		const matches = entries.map((entry) => entry.path);
		return options.onUnreadable === "record" ? ({ matches, unreadable } satisfies DescendSyncResult) : matches;
	});
}

/**
 * `descendEntries` under `onUnreadable: "record"`, synchronously over a caller-supplied port.
 *
 * @public
 */
export function descendEntriesSync(
	pattern: GlobPattern,
	options: DescendSyncRecordOptions,
): Result.Result<DescendEntriesSyncResult, DescendError>;
/**
 * `descendEntries`, synchronously: `descendSync`'s matches, each with
 * the stat the walk already read for it.
 *
 * @public
 */
export function descendEntriesSync(
	pattern: GlobPattern,
	options: DescendSyncOptions,
): Result.Result<ReadonlyArray<DescendSyncEntry>, DescendError>;
export function descendEntriesSync(
	pattern: GlobPattern,
	options: DescendSyncOptions | DescendSyncRecordOptions,
): Result.Result<ReadonlyArray<DescendSyncEntry> | DescendEntriesSyncResult, DescendError> {
	return Result.map(walkSync(pattern, options), ({ entries, unreadable }) =>
		options.onUnreadable === "record" ? ({ matches: entries, unreadable } satisfies DescendEntriesSyncResult) : entries,
	);
}
