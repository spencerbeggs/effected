import { Effect, FileSystem, Option, Path } from "effect";

/**
 * Options for {@link Walker.ascend}.
 *
 * @public
 */
export interface AscendOptions {
	/** Stop after this directory, inclusive. */
	readonly stopAt?: string;
	/** Hard cap on chain length. Defaults to 256. */
	readonly maxDepth?: number;
}

/**
 * Ascend from `start` toward the filesystem root, yielding each directory,
 * nearest first.
 *
 * @remarks
 * Lexical, not physical: `Path.dirname` does not resolve symlinks, so ascending
 * out of a symlinked directory follows the path you were given rather than the
 * real filesystem parent. That is deliberate — config discovery wants the file
 * nearest the path the user named.
 *
 * Bounded twice over: `dirname` is a fixpoint at the root, and `maxDepth` guards
 * a pathological `Path` implementation that never reaches one.
 *
 * @public
 */
const ascend = (start: string, options?: AscendOptions): Effect.Effect<ReadonlyArray<string>, never, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const maxDepth = options?.maxDepth ?? 256;
		if (!Number.isInteger(maxDepth) || maxDepth < 1) {
			return yield* Effect.die(new Error(`Walker.ascend: maxDepth must be a positive integer, received ${maxDepth}`));
		}
		const dirs: Array<string> = [];
		let current = start;
		for (let depth = 0; depth < maxDepth; depth++) {
			dirs.push(current);
			if (options?.stopAt !== undefined && current === options.stopAt) break;
			const parent = path.dirname(current);
			if (parent === current) break;
			current = parent;
		}
		return dirs;
	});

/**
 * The first candidate whose `predicate` reports true, or `Option.none()`.
 *
 * @remarks
 * Each predicate is absorbed **individually**: a failure on one candidate is
 * treated as "this candidate did not match" and the scan continues. One
 * unreadable ancestor must never abort the walk, or a permission error deep in
 * the tree would hide a valid root above it. Not-found and cannot-look are
 * therefore indistinguishable to the caller; discovery is best-effort.
 *
 * `Effect.catch` catches failures, **not defects**. A predicate that throws is
 * programmer error and surfaces as a defect. Do not change this to
 * `Effect.catchCause` — the distinction is load-bearing.
 *
 * @public
 */
const firstMatch = <E, R>(
	candidates: ReadonlyArray<string>,
	predicate: (candidate: string) => Effect.Effect<boolean, E, R>,
): Effect.Effect<Option.Option<string>, never, R> =>
	Effect.gen(function* () {
		for (const candidate of candidates) {
			const matched = yield* Effect.catch(predicate(candidate), () => Effect.succeed(false));
			if (matched) return Option.some(candidate);
		}
		return Option.none();
	});

/**
 * The first existing path among the candidates `candidatesFor` produces for each
 * directory in `dirs`, scanned in order. Nearer directories win.
 *
 * @remarks
 * Candidates materialize up front, bounded by `dirs.length × candidatesFor`'s
 * output — a few hundred strings under the default `maxDepth`.
 *
 * @public
 */
const findUpward = (
	dirs: ReadonlyArray<string>,
	candidatesFor: (dir: string) => ReadonlyArray<string>,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const candidates: Array<string> = [];
		for (const dir of dirs) candidates.push(...candidatesFor(dir));
		return yield* firstMatch(candidates, (candidate) => fs.exists(candidate));
	});

/**
 * The first directory in `dirs` that `isRoot` accepts.
 *
 * @remarks
 * `firstMatch` over the directories themselves — the candidate expansion is the
 * identity. `isRoot` is a caller-supplied marker test (a `.git` entry, a
 * `pnpm-workspace.yaml`), and its failures are absorbed per directory.
 *
 * @public
 */
const findRoot = <E, R>(
	dirs: ReadonlyArray<string>,
	isRoot: (dir: string) => Effect.Effect<boolean, E, R>,
): Effect.Effect<Option.Option<string>, never, R> => firstMatch(dirs, isRoot);

/**
 * Upward path traversal primitives.
 *
 * @public
 */
export const Walker = { ascend, firstMatch, findUpward, findRoot } as const;
