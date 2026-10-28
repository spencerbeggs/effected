import type { FileSystem } from "effect";
import { Effect, Option, Path } from "effect";
import type { WalkerSyncOps, WalkerSyncPath } from "./DescendSync.js";
import { runUpward, runUpwardSync } from "./internal/upwardDrivers.js";
import {
	ascendChain,
	ascendToMarkerMachine,
	ascendWithinMachine,
	findUpwardAllMachine,
	findUpwardMachine,
} from "./internal/upwardMachine.js";

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
	 *
	 * **Lexical, never physical.** A ceiling spelled with symlinks resolved —
	 * `Git.repoRoot`'s answer is one — does not match a chain reached through a
	 * symlink, and the ascent runs to the filesystem root. Use
	 * {@link Walker.ascendWithin} for a physical ceiling.
	 */
	readonly stopAt?: string;
	/** Hard cap on chain length. Defaults to 256. */
	readonly maxDepth?: number;
}

/**
 * Options for {@link Walker.ascendSync}: every {@link AscendOptions} field,
 * plus the path implementation the chain is computed with.
 *
 * @public
 */
export interface AscendSyncOptions extends AscendOptions {
	/** Path arithmetic — `node:path` satisfies it (`nodeWalkerPath` from `@effected/walker/node-sync`). */
	readonly path: WalkerSyncPath;
}

/**
 * Options for the synchronous upward forms that touch the filesystem —
 * {@link Walker.ascendWithinSync} and {@link Walker.ascendToMarkerSync}: the
 * depth cap, plus the platform (spread `nodeWalkerSyncOps` from
 * `@effected/walker/node-sync`).
 *
 * @public
 */
export interface AscendWithinSyncOptions extends Pick<AscendOptions, "maxDepth">, WalkerSyncOps {}

/**
 * {@link Walker.findUpwardAll}'s answer: the nearest directory holding any
 * candidate, and every candidate that exists there.
 *
 * @public
 */
export interface UpwardMatches {
	/** The directory whose candidates produced the hits. */
	readonly dir: string;
	/** Every existing candidate of `dir`, in the order `candidatesFor` gave them. Never empty. */
	readonly found: readonly [string, ...Array<string>];
}

/**
 * Upward path traversal primitives: the directory chain from a start path to the
 * root, and first-match scans over it.
 *
 * @public
 */
export class Walker {
	private constructor() {}

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
	 * Comparing raw strings would let an unnormalized ceiling match nothing and
	 * the ascent run silently to the filesystem root, which is the unbounded walk
	 * the option exists to prevent. A relative ceiling **dies** for the same
	 * reason — resolving one against `process.cwd()` would reintroduce the
	 * silent-wrong-walk failure through a different door. See
	 * {@link AscendOptions.stopAt} for why that is a defect rather than a typed
	 * error; the error channel stays `never`.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { Effect } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 * 	// => ["/repo/packages/app", "/repo/packages", "/repo"]
	 * 	return yield* Walker.ascend("/repo/packages/app", { stopAt: "/repo" });
	 * });
	 * // Requires `Path` from the platform layer.
	 * ```
	 */
	static ascend(start: string, options?: AscendOptions): Effect.Effect<ReadonlyArray<string>, never, Path.Path> {
		return Effect.gen(function* () {
			const path = yield* Path.Path;
			const chain = ascendChain("Walker.ascend", start, options, path);
			if (chain._tag === "Defect") return yield* Effect.die(new Error(chain.message));
			return chain.value;
		});
	}

	/**
	 * {@link Walker.ascend} bounded by a PHYSICAL ceiling: stops at the nearest
	 * directory whose real path is the ceiling's real path, inclusive.
	 *
	 * @remarks
	 * Use this when the ceiling came from something that resolves symlinks —
	 * `Git.repoRoot` (`git rev-parse --show-toplevel`) above all. `ascend`
	 * compares `stopAt` lexically, so when `start` is reached through a symlink
	 * (every macOS tmpdir: `/var` → `/private/var`; any symlinked checkout) the
	 * chain never spells git's root, the ceiling never matches, and the walk
	 * runs silently to the filesystem root.
	 *
	 * The chain is still the lexical one derived from `start`, exactly as
	 * `ascend` yields it; only the stopping test is physical. A ceiling the
	 * chain already spells stops without touching the filesystem. Otherwise each
	 * ancestor's `realPath` is compared with the ceiling's, and a failed probe
	 * is absorbed as "not the ceiling", as {@link Walker.firstMatch} absorbs
	 * one. A ceiling that names no ancestor, or cannot itself be resolved,
	 * leaves the chain running to the filesystem root, as `ascend` does.
	 *
	 * The ceiling is an `Option` so "no ceiling" is spelled explicitly:
	 * `Option.none()` ascends to the filesystem root exactly as `ascend(start)`
	 * does, which is the natural answer outside any repository —
	 * `Walker.ascendWithin(start, yield* Effect.option(git.repoRoot(start)))`.
	 * A present ceiling must be absolute; a relative one **dies**, for the
	 * reasons {@link AscendOptions.stopAt} gives.
	 */
	static ascendWithin(
		start: string,
		ceiling: Option.Option<string>,
		options?: Pick<AscendOptions, "maxDepth">,
	): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
		return Effect.gen(function* () {
			const path = yield* Path.Path;
			// Absence is explicit: `Option.none()` is the only way to ask for an
			// unbounded walk, so a stray `undefined` cannot become one by accident.
			return yield* runUpward(
				ascendWithinMachine("Walker.ascendWithin", start, Option.getOrUndefined(ceiling), options, path),
			);
		});
	}

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
	 */
	static firstMatch<E, R>(
		candidates: ReadonlyArray<string>,
		predicate: (candidate: string) => Effect.Effect<boolean, E, R>,
	): Effect.Effect<Option.Option<string>, never, R> {
		return Effect.gen(function* () {
			for (const candidate of candidates) {
				const matched = yield* Effect.catch(predicate(candidate), () => Effect.succeed(false));
				if (matched) return Option.some(candidate);
			}
			return Option.none();
		});
	}

	/**
	 * The first existing path among the candidates `candidatesFor` produces for each
	 * directory in `dirs`, scanned in order. Nearer directories win.
	 *
	 * @remarks
	 * Candidates materialize up front, bounded by `dirs.length × candidatesFor`'s
	 * output — a few hundred strings under the default `maxDepth`.
	 */
	static findUpward(
		dirs: ReadonlyArray<string>,
		candidatesFor: (dir: string) => ReadonlyArray<string>,
	): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> {
		return Effect.map(runUpward(findUpwardMachine(dirs, candidatesFor)), Option.fromUndefinedOr);
	}

	/**
	 * The first directory in `dirs` that `isRoot` accepts.
	 *
	 * @remarks
	 * `firstMatch` over the directories themselves — the candidate expansion is the
	 * identity. `isRoot` is a caller-supplied marker test (a `.git` entry, a
	 * `pnpm-workspace.yaml`), and its failures are absorbed per directory.
	 */
	static findRoot<E, R>(
		dirs: ReadonlyArray<string>,
		isRoot: (dir: string) => Effect.Effect<boolean, E, R>,
	): Effect.Effect<Option.Option<string>, never, R> {
		return Walker.firstMatch(dirs, isRoot);
	}

	/**
	 * {@link Walker.ascend} stopped at the nearest directory that holds any of
	 * `markers`, inclusive: the chain from `start` up to and including the
	 * first directory with a `.git` (or whatever the markers name) entry.
	 *
	 * @remarks
	 * A marker is an entry NAME probed with `FileSystem.exists` in each
	 * directory, nearest first, so any entry kind counts — a `.git` directory,
	 * or the `.git` FILE of a worktree or submodule — and a link counts when it
	 * resolves. The probes stop at the hit: nothing above the directory that
	 * holds a marker is ever touched. With no marker anywhere the chain runs to
	 * the filesystem root, exactly as `ascend(start)` gives it.
	 *
	 * A failed probe is absorbed as "no marker here", as
	 * {@link Walker.firstMatch} absorbs one, so one unreadable directory never
	 * hides a marker above it. An empty `markers` list, or an empty marker
	 * name, is a **defect**: the first would silently ask for the unbounded
	 * walk and the second would match every directory, and both are
	 * statically wrong at the call site. An invalid `maxDepth` dies exactly as
	 * `ascend`'s does.
	 *
	 * There is no `stopAt` here: a marker stop and a lexical ceiling answer the
	 * same question two ways. To bound a marker walk by a ceiling as well,
	 * take the shorter of the two chains.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { Effect } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 * 	// With `.git` in /repo: ["/repo/packages/app", "/repo/packages", "/repo"]
	 * 	return yield* Walker.ascendToMarker("/repo/packages/app", [".git"]);
	 * });
	 * // Requires `FileSystem` and `Path` from the platform layer.
	 * ```
	 */
	static ascendToMarker(
		start: string,
		markers: ReadonlyArray<string>,
		options?: Pick<AscendOptions, "maxDepth">,
	): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
		return Effect.gen(function* () {
			const path = yield* Path.Path;
			return yield* runUpward(ascendToMarkerMachine("Walker.ascendToMarker", start, markers, options, path));
		});
	}

	/**
	 * Every existing candidate of the NEAREST directory in `dirs` that has any,
	 * or `Option.none()` — {@link Walker.findUpward} for a caller that must see
	 * a second hit (an ambiguity) rather than have the first one chosen.
	 *
	 * @remarks
	 * Directories are scanned in order, and every candidate of a directory is
	 * probed before the scan ascends; the scan stops after the first directory
	 * with a hit, so nothing above it is probed. `found` keeps the order
	 * `candidatesFor` produced and is never empty. A failed probe is absorbed
	 * as "not there", as in `findUpward`, so not-found and cannot-look are
	 * indistinguishable here too.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { Effect, Option } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 * 	const dirs = yield* Walker.ascend("/repo/packages/app");
	 * 	const hits = yield* Walker.findUpwardAll(dirs, (dir) => [`${dir}/tool.config.ts`, `${dir}/tool.config.js`]);
	 * 	// Two config files in one directory is the caller's ambiguity to report.
	 * 	return Option.map(hits, ({ found }) => found.length > 1);
	 * });
	 * ```
	 */
	static findUpwardAll(
		dirs: ReadonlyArray<string>,
		candidatesFor: (dir: string) => ReadonlyArray<string>,
	): Effect.Effect<Option.Option<UpwardMatches>, never, FileSystem.FileSystem> {
		return Effect.map(runUpward(findUpwardAllMachine(dirs, candidatesFor)), Option.fromUndefinedOr);
	}

	/**
	 * {@link Walker.ascend}, synchronously, over a caller-supplied path
	 * implementation.
	 *
	 * @remarks
	 * The same chain from the same code: lexical, nearest first, `stopAt`
	 * inclusive and compared in resolved form. A relative `stopAt` or an
	 * invalid `maxDepth` is a defect, which here THROWS, since there is no
	 * error channel to die through. For a caller with no Effect runtime (a CLI
	 * helper that runs before one, a bundler-plugin hook); inside Effect, use
	 * `ascend`.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { nodeWalkerPath } from "@effected/walker/node-sync";
	 *
	 * const dirs = Walker.ascendSync("/repo/packages/app", { stopAt: "/repo", path: nodeWalkerPath });
	 * // => ["/repo/packages/app", "/repo/packages", "/repo"]
	 * ```
	 */
	static ascendSync(start: string, options: AscendSyncOptions): ReadonlyArray<string> {
		const chain = ascendChain("Walker.ascendSync", start, options, options.path);
		if (chain._tag === "Defect") throw new Error(chain.message);
		return chain.value;
	}

	/**
	 * {@link Walker.ascendWithin}, synchronously, over a caller-supplied port:
	 * the lexical chain stopped at the nearest directory whose `realPath` is
	 * the ceiling's.
	 *
	 * @remarks
	 * The same walk from the same code as `ascendWithin`: `Option.none()` is
	 * exactly `ascendSync(start)`, a ceiling the chain already spells costs no
	 * `realPath`, a `realPath` that throws is absorbed as "not the ceiling",
	 * and an unresolvable ceiling leaves the lexical chain standing. A
	 * relative ceiling or an invalid `maxDepth` throws.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
	 * import { Option } from "effect";
	 *
	 * const dirs = Walker.ascendWithinSync("/repo/packages/app", Option.some("/repo"), nodeWalkerSyncOps);
	 * ```
	 */
	static ascendWithinSync(
		start: string,
		ceiling: Option.Option<string>,
		options: AscendWithinSyncOptions,
	): ReadonlyArray<string> {
		return runUpwardSync(
			ascendWithinMachine("Walker.ascendWithinSync", start, Option.getOrUndefined(ceiling), options, options.path),
			options.fileSystem,
		);
	}

	/**
	 * {@link Walker.ascendToMarker}, synchronously, over a caller-supplied port.
	 *
	 * @remarks
	 * The same walk from the same code. A marker exists when the port's `stat`
	 * (links followed) answers for it; a `stat` that throws, for any reason,
	 * is "no marker here", as the `Effect` form absorbs a failed probe. An
	 * empty `markers` list, an empty marker name or an invalid `maxDepth`
	 * throws.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
	 *
	 * const dirs = Walker.ascendToMarkerSync("/repo/packages/app", [".git"], nodeWalkerSyncOps);
	 * ```
	 */
	static ascendToMarkerSync(
		start: string,
		markers: ReadonlyArray<string>,
		options: AscendWithinSyncOptions,
	): ReadonlyArray<string> {
		return runUpwardSync(
			ascendToMarkerMachine("Walker.ascendToMarkerSync", start, markers, options, options.path),
			options.fileSystem,
		);
	}

	/**
	 * {@link Walker.findUpward}, synchronously, over a caller-supplied port: the
	 * first existing candidate, directory-major, or `Option.none()`.
	 *
	 * @remarks
	 * The same scan from the same code. A candidate exists when the port's
	 * `stat` (links followed) answers for it; a `stat` that throws is "not
	 * there". A throwing `candidatesFor` throws before any probe.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
	 *
	 * const dirs = Walker.ascendSync("/repo/packages/app", { path: nodeWalkerSyncOps.path });
	 * const workspace = Walker.findUpwardSync(dirs, (dir) => [`${dir}/pnpm-workspace.yaml`], nodeWalkerSyncOps);
	 * ```
	 */
	static findUpwardSync(
		dirs: ReadonlyArray<string>,
		candidatesFor: (dir: string) => ReadonlyArray<string>,
		ops: WalkerSyncOps,
	): Option.Option<string> {
		return Option.fromUndefinedOr(runUpwardSync(findUpwardMachine(dirs, candidatesFor), ops.fileSystem));
	}

	/**
	 * {@link Walker.findUpwardAll}, synchronously, over a caller-supplied port.
	 *
	 * @remarks
	 * The same scan from the same code: every existing candidate of the
	 * nearest directory with any, in candidate order, and nothing above it
	 * probed. A candidate exists when the port's `stat` answers for it.
	 *
	 * @example
	 * ```ts
	 * import { Walker } from "@effected/walker";
	 * import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
	 *
	 * const dirs = Walker.ascendSync("/repo/packages/app", { path: nodeWalkerSyncOps.path });
	 * const hits = Walker.findUpwardAllSync(dirs, (dir) => [`${dir}/a.config.ts`, `${dir}/a.config.js`], nodeWalkerSyncOps);
	 * ```
	 */
	static findUpwardAllSync(
		dirs: ReadonlyArray<string>,
		candidatesFor: (dir: string) => ReadonlyArray<string>,
		ops: WalkerSyncOps,
	): Option.Option<UpwardMatches> {
		return Option.fromUndefinedOr(runUpwardSync(findUpwardAllMachine(dirs, candidatesFor), ops.fileSystem));
	}
}
