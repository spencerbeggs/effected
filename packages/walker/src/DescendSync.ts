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
import type {
	DescendEntriesResult,
	DescendEntry,
	DescendOptions,
	DescendRecordOptions,
	DescendResult,
	UnreadableDirectory,
} from "./Descend.js";
import { DescendError } from "./Descend.js";
import type { DescendRequest, LstatAnswer, ReadAnswer, StatAnswer } from "./internal/descendMachine.js";
import { descendMachine, failureOf } from "./internal/descendMachine.js";

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
 * handled per `onUnreadable`. A throwing `stat` or `lstat` reads as "no
 * entry", exactly as the `Effect` walk reads its failed `stat` and `lstat`.
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
		readonly entries: ReadonlyArray<DescendEntry<WalkerSyncStats>>;
		readonly unreadable: ReadonlyArray<UnreadableDirectory<unknown>>;
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
			case "Lstat":
				try {
					const info = fileSystem.lstat(request.path);
					return (
						info.isSymbolicLink() ? { kind: "SymbolicLink" } : { kind: kindOf(info), info }
					) satisfies LstatAnswer<WalkerSyncStats>;
				} catch {
					return undefined;
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
		return Result.fail(new DescendError(failureOf(pattern, result)));
	}
	return Result.succeed({
		entries: result.entries,
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
): Result.Result<DescendResult<unknown>, DescendError>;
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
): Result.Result<ReadonlyArray<string> | DescendResult<unknown>, DescendError> {
	return Result.map(walkSync(pattern, options), ({ entries, unreadable }) => {
		const matches = entries.map((entry) => entry.path);
		return options.onUnreadable === "record" ? ({ matches, unreadable } satisfies DescendResult<unknown>) : matches;
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
): Result.Result<DescendEntriesResult<WalkerSyncStats, unknown>, DescendError>;
/**
 * `descendEntries`, synchronously: `descendSync`'s matches, each with
 * the stat the walk already read for it.
 *
 * @public
 */
export function descendEntriesSync(
	pattern: GlobPattern,
	options: DescendSyncOptions,
): Result.Result<ReadonlyArray<DescendEntry<WalkerSyncStats>>, DescendError>;
export function descendEntriesSync(
	pattern: GlobPattern,
	options: DescendSyncOptions | DescendSyncRecordOptions,
): Result.Result<
	ReadonlyArray<DescendEntry<WalkerSyncStats>> | DescendEntriesResult<WalkerSyncStats, unknown>,
	DescendError
> {
	return Result.map(walkSync(pattern, options), ({ entries, unreadable }) =>
		options.onUnreadable === "record"
			? ({ matches: entries, unreadable } satisfies DescendEntriesResult<WalkerSyncStats, unknown>)
			: entries,
	);
}
