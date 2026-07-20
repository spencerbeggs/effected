import { Effect, FileSystem, Option, Path } from "effect";

/**
 * Options for {@link Walker.ascend}.
 *
 * @public
 */
export interface AscendOptions {
	/**
	 * Stop after this directory, inclusive.
	 *
	 * **Must be absolute**, and is **normalized before comparison**. The ceiling
	 * is matched against each directory's `Path.resolve` form rather than by raw
	 * string equality, so a trailing separator, a `.` or `..` segment, or a
	 * duplicated separator all stop at the ancestor they name. Normalization is
	 * idempotent — an already-resolved absolute path is unchanged — so callers
	 * that resolve at the call site are unaffected.
	 *
	 * A **relative** ceiling is a **defect**, not a typed failure, and is never
	 * resolved against the process working directory. Two rules meet here:
	 *
	 * - Malformed *input* fails typed; bad *wiring* dies. A relative ceiling is
	 *   a caller-supplied option that is statically wrong at the call site — the
	 *   same category as a `NaN` `maxDepth` just below, not a recoverable
	 *   environmental condition — so it dies exactly as that does.
	 * - **Do not "upgrade" this to a typed error.** A typed error is only loud
	 *   if somebody handles it, and `@effected/config-file`'s resolver contract
	 *   absorbs every failure into `Option.none()`. A typed ceiling rejection
	 *   would be swallowed there and re-emerge as a clean-looking "no config
	 *   found" — the silent-wrong-answer failure this whole guard exists to
	 *   close, reappearing through a third door. `Effect.catch` does not catch
	 *   defects, so dying is what survives that absorption.
	 *
	 * Resolving a relative ceiling would be just as bad: the same `stopAt` would
	 * name different directories in a lint-staged hook, a CLI run from a package
	 * directory, and a test runner, with no way for the caller to see which they
	 * got. Rejecting costs one `path.resolve` at the site that knows the answer.
	 * It is also why `ascend` reads `process.cwd()` nowhere.
	 *
	 * Only the CEILING is constrained — a relative `start` is fine and ascends
	 * to the relative root. Absoluteness is judged by the injected `Path`
	 * service, so the win32 layer accepts `C:\repo` and posix does not.
	 *
	 * Normalization governs the comparison only: the chain `ascend` returns is
	 * still the lexical one derived from `start`, unrewritten. A ceiling naming
	 * no ancestor of `start` never matches and the ascent runs to the
	 * filesystem root.
	 */
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
 * `stopAt` is compared in normalized form — see {@link AscendOptions.stopAt}.
 * Raw string equality made the ceiling fail OPEN: an unnormalized ceiling
 * matched nothing and the ascent ran silently to the filesystem root, which is
 * the unbounded walk the option exists to prevent, with no error to notice it
 * by. A relative ceiling **dies** for the same reason — resolving one against
 * `process.cwd()` would reintroduce the silent-wrong-walk failure through a
 * different door. See {@link AscendOptions.stopAt} for why that is a defect
 * rather than a typed error; the error channel stays `never`.
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
		// A relative CEILING dies, exactly as an invalid maxDepth does — same
		// category, same construct. `start` is deliberately unconstrained: a
		// relative start still ascends to the relative root, exactly as before.
		if (options?.stopAt !== undefined && !path.isAbsolute(options.stopAt)) {
			return yield* Effect.die(
				new Error(
					`Walker.ascend: stopAt must be an absolute path, received ${JSON.stringify(options.stopAt)} (ascending from ${JSON.stringify(start)})`,
				),
			);
		}
		// Normalize the ceiling ONCE, then compare normalized forms. Both sides go
		// through `resolve`: normalizing only the ceiling would desynchronize it
		// from an unnormalized chain element (`/a/b/.` names `/a/b`). The raw
		// equality check stays as a fast path for the overwhelmingly common
		// already-resolved ceiling; it is an optimization, never the only
		// comparison.
		const ceiling = options?.stopAt === undefined ? undefined : path.resolve(options.stopAt);
		const dirs: Array<string> = [];
		let current = start;
		for (let depth = 0; depth < maxDepth; depth++) {
			dirs.push(current);
			if (ceiling !== undefined && (current === ceiling || path.resolve(current) === ceiling)) break;
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
