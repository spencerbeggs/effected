// Downward glob-file descent — walker's second concept module, and the first
// with a typed error channel.
//
// `@effected/glob` is a pure matching engine (no filesystem walker), and the
// workspaces enumerator is internal and package-dir-specific, so "files
// matching a glob under a directory" lives here. The walker is semantics-free:
// dotfile behavior, case folding and every other matching option are carried
// by the COMPILED pattern the caller hands in — this module never re-derives
// options, it only reads `hasMagic` / `negated` / `enumerationPrefix` /
// `crossesSegments` and calls `matches`.

import type { GlobPattern } from "@effected/glob";
import { Effect, FileSystem, Path, Schema } from "effect";

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
	 * What an unreadable directory mid-walk does. `"fail"` (the default) fails
	 * typed — downward enumeration must not silently swallow a subtree, or the
	 * answer is silently missing membership dressed as an empty one. `"skip"`
	 * absorbs the failure and continues, discarding which directory it was.
	 * `"record"` also absorbs and continues, but instead of discarding the
	 * offending directory it collects it: `descend` then resolves to a
	 * {@link DescendResult} rather than a bare match array, carrying every
	 * unreadable directory's `cwd`-relative path alongside the matches.
	 */
	readonly onUnreadable?: "fail" | "skip" | "record";
}

/**
 * `descend`'s success value under `onUnreadable: "record"`: the matched
 * FILE paths plus the `cwd`-relative path of every mid-walk directory whose
 * `readDirectory` failed for a reason other than `NotFound` (a vanished
 * directory stays a benign race in every mode and is never recorded).
 *
 * @public
 */
export interface DescendResult {
	/** Matching FILE paths relative to `cwd`, POSIX separators, sorted — identical in shape to the `"fail"`/`"skip"` success value. */
	readonly matches: ReadonlyArray<string>;
	/**
	 * `cwd`-relative paths of directories that could not be read, in walk order.
	 *
	 * @remarks
	 * **The walk base appears as the empty string `""`**, since its own
	 * `cwd`-relative path is empty — so an unreadable base yields
	 * `{ matches: [], unreadable: [""] }`. Code matching these entries as
	 * ordinary paths will not expect that; special-case it.
	 *
	 * No cause travels with an entry. A caller that must report WHY a directory
	 * was unreadable has to re-read it to obtain the `PlatformError`, which is
	 * a second syscall for information this walk had and discarded.
	 */
	readonly unreadable: ReadonlyArray<string>;
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
	// Schema.Literals, not Schema.Literal: the v3 variadic Literal silently
	// ignores every argument after the first in the beta.
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

/** Directory names never descended into unless the caller overrides `prune`. */
const DEFAULT_PRUNE: ReadonlyArray<string> = ["node_modules", ".git"];

/**
 * Whether a cwd-relative pattern path lexically climbs above `cwd` via `..`
 * segments. Walked paths never contain `..`, so such a pattern can never match
 * one — the answer is zero matches, and no filesystem access outside `cwd`
 * ever happens (a pattern must not enumerate the tree above its documented
 * root).
 */
const escapesCwd = (relative: string): boolean => {
	let depth = 0;
	for (const segment of relative.split("/")) {
		if (segment === "" || segment === ".") continue;
		depth += segment === ".." ? -1 : 1;
		if (depth < 0) return true;
	}
	return false;
};

/** A directory queued for reading: its cwd-relative POSIX path, its absolute path, and its depth below the base. */
interface DescendFrame {
	readonly relative: string;
	readonly absolute: string;
	readonly depth: number;
}

/** Not exported — `descend`'s overloads below carry the public documentation. */
const descendImpl: (
	pattern: GlobPattern,
	options: DescendOptions,
) => Effect.Effect<ReadonlyArray<string> | DescendResult, DescendError, FileSystem.FileSystem | Path.Path> = Effect.fn(
	"Walker.descend",
)(function* (pattern: GlobPattern, options: DescendOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const maxDepth = options.maxDepth ?? 256;
	if (!Number.isInteger(maxDepth) || maxDepth < 1) {
		return yield* Effect.die(new Error(`Walker.descend: maxDepth must be a positive integer, received ${maxDepth}`));
	}
	const prune = new Set(options.prune ?? DEFAULT_PRUNE);
	const onUnreadable = options.onUnreadable ?? "fail";
	// Populated only under "record"; the wrapper decides the return shape.
	const unreadable: Array<string> = [];

	/** The stat-resolved type of `absolute`, or `undefined` when it does not resolve (missing, dangling symlink, unstatable). */
	const typeOf = (absolute: string): Effect.Effect<FileSystem.File.Info["type"] | undefined> =>
		fs.stat(absolute).pipe(
			Effect.map((info) => info.type),
			Effect.orElseSucceed(() => undefined),
		);

	/** Whether `absolute` is itself a symlink. `readLink` succeeds only on links; any failure means "not one". */
	const isSymbolicLink = (absolute: string): Effect.Effect<boolean> =>
		fs.readLink(absolute).pipe(
			Effect.map(() => true),
			Effect.orElseSucceed(() => false),
		);

	/** Wrap the walk's success value per `onUnreadable`: a plain array unless "record" asked for the pair. */
	const finish = (matches: ReadonlyArray<string>): ReadonlyArray<string> | DescendResult =>
		onUnreadable === "record" ? { matches, unreadable } : matches;

	// Literal pattern: a single stat decides. Missing is zero matches, and so is
	// a literal that climbs above `cwd` — never stat outside the documented root.
	if (!pattern.hasMagic && !pattern.negated) {
		if (escapesCwd(pattern.source)) return finish([]);
		return finish((yield* typeOf(path.join(options.cwd, pattern.source))) === "File" ? [pattern.source] : []);
	}

	// Magic pattern: walk from the literal prefix. An absent base directory is
	// an EMPTY result, not an error — zero matches is a normal glob answer. A
	// NEGATED pattern matches everything its inner pattern does NOT — including
	// paths outside the inner pattern's literal prefix — so it walks from `cwd`
	// itself, never from the inner prefix (which would silently omit matches).
	// A prefix that climbs above `cwd` yields zero matches for the same reason
	// the literal fast-path refuses it.
	const base = pattern.negated ? "" : pattern.enumerationPrefix.replace(/\/+$/, "");
	if (escapesCwd(base)) return finish([]);
	const absoluteBase = base === "" ? options.cwd : path.join(options.cwd, base);
	if ((yield* typeOf(absoluteBase)) !== "Directory") return finish([]);

	// Only a pattern that can match below one level earns a descent; a negated
	// pattern matches everything its inner pattern does NOT, so it can match
	// arbitrarily deep paths and always walks.
	const deep = pattern.crossesSegments || pattern.negated;

	const results: Array<string> = [];
	const frames: Array<DescendFrame> = [{ relative: base, absolute: absoluteBase, depth: 0 }];
	// A head index, never Array.shift(): shift() re-indexes the whole array on
	// every dequeue, turning a large walk quadratic.
	for (let head = 0; head < frames.length; head += 1) {
		const frame = frames[head];
		if (frame === undefined) break;

		// A directory that vanished between its parent's listing and this read is
		// a benign race — treat it as empty, and never record it as unreadable:
		// `DescendResult.unreadable` documents only a non-`NotFound` failure.
		// Anything else means a subtree we were asked to enumerate is unreadable,
		// and (unlike walker's upward per-probe absorption, where the scan can
		// still succeed above) a swallowed subtree down here is silently missing
		// membership — so the default fails typed. `"record"` also absorbs and
		// continues, like `"skip"`, but keeps the offending relative path instead
		// of discarding it.
		const entries = yield* fs.readDirectory(frame.absolute).pipe(
			Effect.catch((error) => {
				if (error.reason._tag === "NotFound") return Effect.succeed<Array<string>>([]);
				if (onUnreadable === "fail") {
					return Effect.fail(
						new DescendError({ pattern: pattern.source, reason: "unreadableDirectory", path: frame.relative }),
					);
				}
				if (onUnreadable === "record") unreadable.push(frame.relative);
				return Effect.succeed<Array<string>>([]);
			}),
		);

		for (const entry of entries) {
			const relative = frame.relative === "" ? entry : `${frame.relative}/${entry}`;
			const absolute = path.join(frame.absolute, entry);

			const kind = yield* typeOf(absolute);
			if (kind === "File") {
				if (pattern.matches(relative)) results.push(relative);
				continue;
			}
			if (kind !== "Directory" || !deep) continue;
			// Prune suppresses DIRECTORIES only, per the option's contract — a
			// FILE named `.git` (a submodule or worktree gitlink) stays matchable.
			if (prune.has(entry)) continue;
			// Never descend into a symlinked directory (cycle safety).
			if (yield* isSymbolicLink(absolute)) continue;
			// Depth exhaustion is a typed failure, not a truncation.
			if (frame.depth + 1 > maxDepth) {
				return yield* new DescendError({
					pattern: pattern.source,
					reason: "depthExceeded",
					path: frame.relative,
					limit: maxDepth,
				});
			}
			frames.push({ relative, absolute, depth: frame.depth + 1 });
		}
	}

	results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return finish(results);
});

/**
 * Expand a compiled glob pattern against the filesystem under
 * `onUnreadable: "record"`, resolving to a {@link DescendResult} — the
 * matched FILE paths relative to `cwd` (POSIX separators, sorted) plus the
 * `cwd`-relative path of every mid-walk directory whose `readDirectory`
 * failed for a reason other than `NotFound`. The walk continues past each
 * such directory exactly as `"skip"` does; it never aborts and it never
 * discards the offending path.
 *
 * @public
 */
export function descend(
	pattern: GlobPattern,
	options: DescendOptions & { readonly onUnreadable: "record" },
): Effect.Effect<DescendResult, DescendError, FileSystem.FileSystem | Path.Path>;
/**
 * Expand a compiled glob pattern against the filesystem, returning matching
 * FILE paths relative to `cwd` (POSIX separators), sorted by relative path.
 *
 * @remarks
 * A literal pattern (no magic, not negated) fast-paths to a single stat: the
 * result is `[source]` when it resolves to a file, `[]` otherwise — a missing
 * path is zero matches, not an error. A magic pattern walks from its literal
 * directory prefix (`GlobPattern.enumerationPrefix`); a NEGATED pattern can
 * match paths outside that prefix, so it walks from `cwd` itself. A missing
 * base directory is likewise an empty result, because zero matches is a
 * normal glob answer — as is any pattern that lexically climbs above `cwd`
 * via `..` segments (walked paths never contain `..`, and the walk never
 * reads outside its documented root). Only an unreadable directory mid-walk
 * (under the default `onUnreadable: "fail"`) or a walk past `maxDepth` fails,
 * typed as {@link DescendError}.
 *
 * Only files match. A symlink counts when it stat-resolves to a file
 * (`FileSystem.stat` follows links, as node's does); a symlinked directory is
 * never descended into (cycle safety — detected by a `readLink` probe); a
 * dangling symlink is not a match. A directory that vanishes between its
 * parent's listing and its own read is a benign race and reads as empty. A
 * pattern that cannot match below one level (no globstar, no mid-pattern
 * magic segment) reads a single level and never descends.
 *
 * The descent is a worklist, not a recursion — it cannot overflow the stack —
 * dequeued by head index, never `Array.shift()`. Like `ascend`, `maxDepth`
 * must be a positive integer: anything else is a defect, never a
 * silently-empty result.
 *
 * Passing `onUnreadable: "record"` resolves to a {@link DescendResult}
 * instead — see that overload.
 *
 * @public
 */
export function descend(
	pattern: GlobPattern,
	options: DescendOptions,
): Effect.Effect<ReadonlyArray<string>, DescendError, FileSystem.FileSystem | Path.Path>;
export function descend(
	pattern: GlobPattern,
	options: DescendOptions,
): Effect.Effect<ReadonlyArray<string> | DescendResult, DescendError, FileSystem.FileSystem | Path.Path> {
	return descendImpl(pattern, options);
}
