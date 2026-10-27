// Downward glob-file descent — walker's second concept module, and the first
// with a typed error channel.
//
// `@effected/glob` is a pure matching engine (no filesystem walker), and the
// workspaces enumerator is internal and package-dir-specific, so "files
// matching a glob under a directory" lives here. The walker is semantics-free:
// dotfile behavior, case folding and every other matching option are carried
// by the COMPILED pattern the caller hands in — this module never re-derives
// options, it only reads `hasMagic` / `negated` / `enumerationRoots` and calls
// `matches`.

import type { GlobPattern } from "@effected/glob";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Schema } from "effect";
import type { DescendRequest, LstatAnswer, ReadAnswer, StatAnswer } from "./internal/descendMachine.js";
import { descendMachine, failureOf } from "./internal/descendMachine.js";

/**
 * Options for `descend`.
 *
 * @public
 */
export interface DescendOptions {
	/** Absolute directory the pattern is resolved against. Required — walker never reads `process.cwd()`. */
	readonly cwd: string;
	/** Hard cap on directory depth below the pattern's literal prefix. Defaults to 256. */
	readonly maxDepth?: number;
	/** Directory names never descended into. Defaults to `["node_modules", ".git"]`; a custom list replaces the default. */
	readonly prune?: ReadonlyArray<string>;
	/**
	 * Marker FILE names that make a directory a boundary — a nested unit (another
	 * package, say: `["package.json"]`) whose contents belong to a separate walk.
	 *
	 * @remarks
	 * A directory strictly below `cwd` holding a FILE with one of these names
	 * contributes nothing: none of its files match and its subtree is never
	 * descended. `cwd` itself is never a boundary, and a DIRECTORY named like a
	 * marker does not count. The rule is about where a file sits, not how the
	 * walk reached it, so it applies to a walk that starts below `cwd` (the
	 * pattern's literal prefix) and to a literal pattern alike: a boundary
	 * between `cwd` and the walk base, or between `cwd` and a literal file,
	 * also answers zero matches. Each directory pays one stat per marker it
	 * actually lists. Defaults to none. Not to be confused with
	 * `Walker.ascend`'s `stopAt`, an inclusive upward ceiling.
	 */
	readonly boundaries?: ReadonlyArray<string>;
	/**
	 * What an unreadable directory mid-walk does. `"fail"` (the default) fails
	 * typed — downward enumeration must not silently swallow a subtree, or the
	 * answer is silently missing membership dressed as an empty one. `"skip"`
	 * absorbs the failure and continues, discarding which directory it was.
	 * To collect the offending directories instead of discarding them, pass
	 * {@link DescendRecordOptions} — `"record"` is deliberately NOT a member
	 * here, because this type is the options contract of the overload that
	 * returns a bare match array.
	 */
	readonly onUnreadable?: "fail" | "skip";
	/**
	 * Whether to descend into symlinked directories. Defaults to `false`: a
	 * symlinked directory is never entered (cycle safety) — the walk base, and
	 * every directory on the way to it, included: a base reached through a link
	 * is an empty result. Under `true` links
	 * are followed with the cycle guard kept underneath, in `@actions/glob`'s
	 * `traversalChain` semantics: each descended directory records its real
	 * path on its own branch's ancestor chain (only the base and each link pay
	 * a `FileSystem.realPath`; a plain directory's is derived from its
	 * parent's), and a directory whose real path is already an ancestor of the
	 * current branch closes a cycle and is skipped — so link loops terminate
	 * while two sibling links resolving to the same target both enumerate. A
	 * link whose real path cannot be resolved is never entered, and the
	 * failure follows `onUnreadable` exactly as an unreadable directory does:
	 * `NotFound` is a benign race and stays silent, anything else fails typed
	 * by default, is recorded under `"record"`, and is forgotten under
	 * `"skip"`. Following links matches `@actions/glob`'s default
	 * `followSymbolicLinks: true` and Node's recursive
	 * `fs.promises.readdir` — but the cycle guard is `@actions/glob`'s
	 * alone: Node's recursive `readdir` keeps no traversal chain and recurses
	 * without bound on a link loop.
	 */
	readonly followSymlinks?: boolean;
}

/**
 * Options for `descend` under `onUnreadable: "record"`: every
 * {@link DescendOptions} field, with `onUnreadable` fixed to `"record"`.
 *
 * @remarks
 * A separate type rather than `DescendOptions & { onUnreadable: "record" }`,
 * because the two options types are the discriminator between two different
 * RETURN types. If `DescendOptions` itself admitted `"record"`, a value
 * widened to `DescendOptions` — annotated as such, or passed through a
 * function taking it — would select the array-returning overload at compile
 * time while the implementation resolved a {@link DescendResult} at runtime,
 * and every array method on that result would fail with no type error
 * anywhere. Keeping `"record"` out of `DescendOptions` makes that
 * unrepresentable.
 *
 * @public
 */
export interface DescendRecordOptions extends Omit<DescendOptions, "onUnreadable"> {
	/** Collect every unreadable directory rather than failing or discarding it. */
	readonly onUnreadable: "record";
}

/**
 * One directory `descend` could not read under `onUnreadable: "record"`: its
 * `cwd`-relative path and the `PlatformError` that `readDirectory` — or,
 * for a symlinked directory under `followSymlinks`, `realPath` — failed
 * with. The cause is the very failure the walk absorbed, so a caller that
 * must report WHY a directory was unreadable never re-reads it.
 *
 * @public
 */
export interface UnreadableDirectory<C = PlatformError.PlatformError> {
	/**
	 * The directory's path relative to `cwd`, POSIX separators.
	 *
	 * @remarks
	 * **The walk base appears as the empty string `""`**, since its own
	 * `cwd`-relative path is empty — so an unreadable base yields
	 * `{ matches: [], unreadable: [{ path: "", cause }] }`. Code matching
	 * these entries as ordinary paths will not expect that; special-case it.
	 */
	readonly path: string;
	/** The `readDirectory` (or, for a link under `followSymlinks`, `realPath`) failure, never `NotFound` (a vanished directory is a benign race and is not recorded). */
	readonly cause: C;
}

/**
 * `descend`'s success value under `onUnreadable: "record"`: the matched
 * FILE paths plus an {@link UnreadableDirectory} for every mid-walk
 * directory whose `readDirectory` (or, under `followSymlinks`, a symlinked
 * directory whose `realPath`) failed for a reason other than `NotFound` (a
 * vanished directory stays a benign race in every mode and is never
 * recorded).
 *
 * @public
 */
export interface DescendResult<C = PlatformError.PlatformError> {
	/** Matching FILE paths relative to `cwd`, POSIX separators, sorted — identical in shape to the `"fail"`/`"skip"` success value. */
	readonly matches: ReadonlyArray<string>;
	/** Directories that could not be read, each with its cause, in walk order. */
	readonly unreadable: ReadonlyArray<UnreadableDirectory<C>>;
}

/**
 * Typed failure raised by `descend`: a directory mid-walk was unreadable
 * (under `onUnreadable: "fail"`), or the walk descended past `maxDepth`. Depth
 * exhaustion is a typed failure, never a truncation — silent truncation
 * silently changes match semantics.
 *
 * @public
 */
export class DescendError extends Schema.TaggedError<DescendError>()("DescendError", {
	/** The glob pattern's source text. */
	pattern: Schema.String,
	/** Why the walk failed: a directory could not be read, or the walk went past `maxDepth`. */
	reason: Schema.Literals(["unreadableDirectory", "depthExceeded"]),
	/** The offending directory, relative to `cwd` (`""` is the walk's base). */
	path: Schema.String,
	/** The depth cap, present when `reason` is `"depthExceeded"`. */
	limit: Schema.optionalKey(Schema.Number),
}) {
	override get message(): string {
		const where = this.path === "" ? "the base directory" : JSON.stringify(this.path);
		return this.reason === "depthExceeded"
			? `glob descent for ${JSON.stringify(this.pattern)} descended past ${this.limit ?? "the depth cap"} levels below ${where}`
			: `glob descent for ${JSON.stringify(this.pattern)} could not read ${where}`;
	}
}

/**
 * One matched file with the stat the walk already read for it — `descendEntries`'
 * element. Costs no syscall beyond `descend`'s: the walk stats every entry to
 * classify it, and this keeps the answer instead of discarding it.
 *
 * The type parameter is the stat's type, so the sync walk reuses this shape
 * with its port's stats.
 *
 * @public
 */
export interface DescendEntry<I = FileSystem.File.Info> {
	/** The file's path relative to `cwd`, POSIX separators. */
	readonly path: string;
	/** `FileSystem.stat` of the file — links followed, so a symlinked file reports its target. */
	readonly info: I;
}

/**
 * `descendEntries`' success value under `onUnreadable: "record"`: the matched
 * {@link DescendEntry} values plus every {@link UnreadableDirectory}, exactly
 * as {@link DescendResult} carries them for `descend`.
 *
 * @public
 */
export interface DescendEntriesResult<I = FileSystem.File.Info, C = PlatformError.PlatformError> {
	/** Matching files with their stats, sorted by path. */
	readonly matches: ReadonlyArray<DescendEntry<I>>;
	/** Directories that could not be read, each with its cause, in walk order. */
	readonly unreadable: ReadonlyArray<UnreadableDirectory<C>>;
}

/**
 * The one options shape spanning all three modes. Not exported: the PUBLIC
 * types are deliberately split so `"record"` cannot reach the array-returning
 * overload, and this internal union is what the single implementation body
 * needs in order to still branch on all three values.
 */
type DescendAnyOptions = Omit<DescendOptions, "onUnreadable"> & {
	readonly onUnreadable?: "fail" | "skip" | "record";
};

const kindOf = (info: FileSystem.File.Info): "File" | "Directory" | "Other" =>
	info.type === "File" ? "File" : info.type === "Directory" ? "Directory" : "Other";

/**
 * The `Effect` driver of the shared walk (`internal/descendMachine.ts`): each
 * request the walk yields is answered through core's `FileSystem`, joins
 * through `Path`. Every rule lives in the machine; the sync driver in
 * `DescendSync.ts` answers the same requests from a synchronous port.
 */
const walk = (
	pattern: GlobPattern,
	options: DescendAnyOptions,
): Effect.Effect<
	{
		readonly entries: ReadonlyArray<DescendEntry>;
		readonly unreadable: ReadonlyArray<UnreadableDirectory>;
	},
	DescendError,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const read = <T>(effect: Effect.Effect<T, PlatformError.PlatformError>) =>
			effect.pipe(
				Effect.map((value): ReadAnswer<T, PlatformError.PlatformError> => ({ _tag: "Ok", value })),
				Effect.catch((error) =>
					Effect.succeed<ReadAnswer<T, PlatformError.PlatformError>>(
						error.reason._tag === "NotFound" ? { _tag: "NotFound" } : { _tag: "Failed", cause: error },
					),
				),
			);

		const answer = (request: DescendRequest): Effect.Effect<unknown> => {
			switch (request._tag) {
				case "Stat":
					// `stat` follows links, as node's does; anything that does not
					// resolve (missing, dangling, unstatable) is "no entry".
					return fs.stat(request.path).pipe(
						Effect.map((info): StatAnswer<FileSystem.File.Info> => ({ kind: kindOf(info), info })),
						Effect.orElseSucceed((): StatAnswer<FileSystem.File.Info> => undefined),
					);
				case "Lstat":
					// A link is reported as one, without its target; anything
					// unstatable is "no entry".
					return fs.lstat(request.path).pipe(
						Effect.map(
							(info): LstatAnswer<FileSystem.File.Info> =>
								info.type === "SymbolicLink" ? { kind: "SymbolicLink" } : { kind: kindOf(info), info },
						),
						Effect.orElseSucceed((): LstatAnswer<FileSystem.File.Info> => undefined),
					);
				case "RealPath":
					return read(fs.realPath(request.path));
				case "ReadDirectory":
					return read(fs.readDirectory(request.path));
			}
		};

		const machine = descendMachine<FileSystem.File.Info, PlatformError.PlatformError>(pattern, options, (a, b) =>
			path.join(a, b),
		);
		let step = machine.next();
		while (step.done !== true) step = machine.next(yield* answer(step.value));
		const result = step.value;
		if (result._tag === "Defect") return yield* Effect.die(new Error(result.message));
		if (result._tag === "Fail") {
			return yield* new DescendError(failureOf(pattern, result));
		}
		return { entries: result.entries, unreadable: result.unreadable };
	});

/** Not exported — `descend`'s overloads below carry the public documentation. */
const descendImpl = Effect.fn("Walker.descend")(function* (pattern: GlobPattern, options: DescendAnyOptions) {
	const { entries, unreadable } = yield* walk(pattern, options);
	const matches = entries.map((entry) => entry.path);
	return options.onUnreadable === "record" ? ({ matches, unreadable } satisfies DescendResult) : matches;
});

/** Not exported — `descendEntries`' overloads below carry the public documentation. */
const descendEntriesImpl = Effect.fn("Walker.descendEntries")(function* (
	pattern: GlobPattern,
	options: DescendAnyOptions,
) {
	const { entries, unreadable } = yield* walk(pattern, options);
	return options.onUnreadable === "record"
		? ({ matches: entries, unreadable } satisfies DescendEntriesResult)
		: entries;
});

/**
 * Expand a compiled glob pattern against the filesystem under
 * `onUnreadable: "record"`, resolving to a {@link DescendResult} — the
 * matched FILE paths relative to `cwd` (POSIX separators, sorted) plus an
 * {@link UnreadableDirectory} — path and cause — for every mid-walk
 * directory whose `readDirectory` (or, under `followSymlinks`, a symlinked
 * directory whose `realPath`) failed for a reason other than `NotFound`.
 * The walk continues past each such directory exactly as `"skip"` does; it
 * never aborts and it never discards the offending path or its cause.
 *
 * @public
 */
export function descend(
	pattern: GlobPattern,
	options: DescendRecordOptions,
): Effect.Effect<DescendResult, DescendError, FileSystem.FileSystem | Path.Path>;
/**
 * Expand a compiled glob pattern against the filesystem, returning matching
 * FILE paths relative to `cwd` (POSIX separators), sorted by relative path.
 *
 * @remarks
 * A path is answered in the spelling the pattern matched it under: `./src/*.ts`
 * answers `./src/a.ts`, and `src/*.ts` answers `src/a.ts`. A file several
 * brace alternatives match under different spellings (`{src,./src}/*.ts`) is
 * answered once, in the spelling of the earliest of them in pattern order. A
 * literal pattern (no magic, not negated) fast-paths to a single stat: the
 * result is `[source]` when it resolves to a file, `[]` otherwise — a missing
 * path is zero matches, not an error. A magic pattern walks each of its
 * `GlobPattern.enumerationRoots`, reading each directory once however many
 * alternatives spell it; a NEGATED pattern can match paths outside those
 * roots, so it walks from `cwd` itself. A missing
 * base directory is likewise an empty result, because zero matches is a
 * normal glob answer — as is any pattern that lexically climbs above `cwd`
 * via `..` segments (walked paths never contain `..`). "Never reads outside
 * its documented root" holds lexically always, and physically only while
 * `followSymlinks` is off: under it, a link whose target lives outside `cwd`
 * is descended, exactly as `@actions/glob` follows links out of the tree.
 * Only an unreadable directory mid-walk
 * (under the default `onUnreadable: "fail"`) or a walk past `maxDepth` fails,
 * typed as {@link DescendError}.
 *
 * Only files match. A symlink counts when it stat-resolves to a file
 * (`FileSystem.stat` follows links, as node's does); a symlinked directory is
 * never descended into by default (cycle safety — detected by an `lstat`
 * probe), unless `followSymlinks: true` asks for it, which follows links under
 * `@actions/glob`'s `traversalChain` cycle guard: a directory is a cycle only
 * when its real path is already an ancestor of the current branch, so sibling
 * links resolving to the same target both enumerate. A link whose real path
 * cannot be resolved is never entered, and a resolution failure other than
 * `NotFound` is an unreadable directory under `onUnreadable`. A dangling
 * symlink is not a match. A
 * directory that vanishes between its parent's listing and its own read is a
 * benign race and reads as empty. A pattern that cannot match below one level
 * (no globstar, no mid-pattern magic segment) reads a single level and never
 * descends.
 *
 * The descent is a worklist, not a recursion — it cannot overflow the stack —
 * dequeued by head index, never `Array.shift()`. Like `ascend`, `maxDepth`
 * must be a positive integer: anything else is a defect, never a
 * silently-empty result.
 *
 * Passing `onUnreadable: "record"` resolves to a {@link DescendResult}
 * instead — see that overload.
 *
 * @example
 * ```ts
 * import { GlobPattern } from "@effected/glob";
 * import { descend } from "@effected/walker";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 * 	const pattern = yield* GlobPattern.compile("src/*.ts");
 * 	// Sorted, cwd-relative POSIX paths of the matching files.
 * 	return yield* descend(pattern, { cwd: "/repo" });
 * });
 * // Requires `FileSystem` and `Path` from the platform layer.
 * ```
 *
 * @public
 */
export function descend(
	pattern: GlobPattern,
	options: DescendOptions,
): Effect.Effect<ReadonlyArray<string>, DescendError, FileSystem.FileSystem | Path.Path>;
export function descend(
	pattern: GlobPattern,
	options: DescendOptions | DescendRecordOptions,
): Effect.Effect<ReadonlyArray<string> | DescendResult, DescendError, FileSystem.FileSystem | Path.Path> {
	return descendImpl(pattern, options);
}

/**
 * `descend` under `onUnreadable: "record"`, keeping each match's stat:
 * resolves to a {@link DescendEntriesResult}.
 *
 * @public
 */
export function descendEntries(
	pattern: GlobPattern,
	options: DescendRecordOptions,
): Effect.Effect<DescendEntriesResult, DescendError, FileSystem.FileSystem | Path.Path>;
/**
 * `descend`, keeping the stat the walk already read for each matched
 * file: resolves to {@link DescendEntry} values sorted by path.
 *
 * @remarks
 * The same walk, the same matches in the same order, the same errors — only
 * the element type differs, and at no extra syscall (the walk stats every
 * entry to classify it). For a cache signature over a tree, map each entry's
 * `path` and `info.mtime` (or `info.size`) into whatever key the cache needs;
 * the kit does not choose the fingerprint.
 *
 * @example
 * ```ts
 * import { GlobPattern, GlobPatternOptions } from "@effected/glob";
 * import { descendEntries } from "@effected/walker";
 * import { Effect, Option } from "effect";
 *
 * const signature = Effect.gen(function* () {
 * 	const pattern = yield* GlobPattern.compile("**", GlobPatternOptions.make({ dot: true }));
 * 	const entries = yield* descendEntries(pattern, { cwd: "/repo/src", boundaries: ["package.json"] });
 * 	return entries.map((e) => `${e.path}:${Option.match(e.info.mtime, { onNone: () => "", onSome: (d) => d.getTime() })}`).join("|");
 * });
 * ```
 *
 * @public
 */
export function descendEntries(
	pattern: GlobPattern,
	options: DescendOptions,
): Effect.Effect<ReadonlyArray<DescendEntry>, DescendError, FileSystem.FileSystem | Path.Path>;
export function descendEntries(
	pattern: GlobPattern,
	options: DescendOptions | DescendRecordOptions,
): Effect.Effect<ReadonlyArray<DescendEntry> | DescendEntriesResult, DescendError, FileSystem.FileSystem | Path.Path> {
	return descendEntriesImpl(pattern, options);
}
