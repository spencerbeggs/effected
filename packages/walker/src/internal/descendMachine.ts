// The downward walk, written ONCE as a generator that yields filesystem
// requests.
//
// `descend` / `descendEntries` answer each request with core's `FileSystem`;
// `descendSync` / `descendEntriesSync` answer it from a caller-supplied
// synchronous port. Every rule — the literal fast path, the enumeration
// prefix, prune, boundaries, the per-branch symlink cycle guard, the
// unreadable-directory posture, the depth cap, the sort — lives here, so the
// two worlds cannot disagree about what a pattern matches (the move
// `WorkspacesSync` makes with one traversal state machine for both).
// Pure: no IO, no platform. Path joining is a caller-supplied function, not a
// request, because it is pure in both worlds.

import type { GlobPattern } from "@effected/glob";
import { resolveSegments } from "./segments.js";
import { trimTrailing } from "./trimTrailing.js";

/** What a stat answers: the resolved kind (links followed) and the raw info, or `undefined` when it does not resolve. */
export type StatAnswer<S> = { readonly kind: "File" | "Directory" | "Other"; readonly info: S } | undefined;

/**
 * What an lstat answers: the entry's own kind. A link carries no info — the
 * walk follows it with a `Stat` when it needs to. `undefined` when nothing is there.
 */
export type LstatAnswer<S> =
	| { readonly kind: "File" | "Directory" | "Other"; readonly info: S }
	| { readonly kind: "SymbolicLink" }
	| undefined;

/** A read that distinguishes the benign vanished-path race from a real failure. */
export type ReadAnswer<T, C> =
	| { readonly _tag: "Ok"; readonly value: T }
	| { readonly _tag: "NotFound" }
	| { readonly _tag: "Failed"; readonly cause: C };

/** One filesystem request the walk makes of its driver. */
export type DescendRequest =
	| { readonly _tag: "Stat"; readonly path: string }
	| { readonly _tag: "Lstat"; readonly path: string }
	| { readonly _tag: "RealPath"; readonly path: string }
	| { readonly _tag: "ReadDirectory"; readonly path: string };

/** The driver's answer to each request kind. */
export interface DescendResponses<S, C> {
	readonly Stat: StatAnswer<S>;
	readonly Lstat: LstatAnswer<S>;
	readonly RealPath: ReadAnswer<string, C>;
	readonly ReadDirectory: ReadAnswer<ReadonlyArray<string>, C>;
}

/** The walk's settings, already defaulted. */
export interface DescendMachineOptions {
	readonly cwd: string;
	readonly maxDepth?: number | undefined;
	readonly prune?: ReadonlyArray<string> | undefined;
	readonly boundaries?: ReadonlyArray<string> | undefined;
	readonly onUnreadable?: "fail" | "skip" | "record" | undefined;
	readonly followSymlinks?: boolean | undefined;
}

/** One matched file. */
export interface MachineEntry<S> {
	readonly path: string;
	readonly info: S;
}

/** How the walk ended. The driver builds the typed error / defect from the description. */
export type DescendMachineResult<S, C> =
	| {
			readonly _tag: "Done";
			readonly entries: ReadonlyArray<MachineEntry<S>>;
			readonly unreadable: ReadonlyArray<{ readonly path: string; readonly cause: C }>;
	  }
	| {
			readonly _tag: "Fail";
			readonly reason: "unreadableDirectory" | "depthExceeded";
			readonly path: string;
			readonly limit?: number;
	  }
	| { readonly _tag: "Defect"; readonly message: string };

/** Directory names never descended into unless the caller overrides `prune`. */
export const DEFAULT_PRUNE: ReadonlyArray<string> = ["node_modules", ".git"];

/** A glob pattern's one separator: its backslash is an escape, never a separator. */
const isSlash = (character: string): boolean => character === "/";

/** Shared empty ancestor chain: frames under `followSymlinks: false` never consult theirs. */
const NO_ANCESTORS: ReadonlyArray<string> = Object.freeze([]);

/**
 * A directory queued for reading: its cwd-relative POSIX path, its absolute
 * path, its depth below the base, and — only under `followSymlinks` — the
 * real paths of this branch's ancestors (`@actions/glob`'s `traversalChain`,
 * carried per branch, never walk-global).
 */
interface Frame {
	readonly relative: string;
	readonly absolute: string;
	readonly depth: number;
	readonly ancestors: ReadonlyArray<string>;
}

type Walk<A> = Generator<DescendRequest, A, unknown>;

/** The walk. */
export function* descendMachine<S, C>(
	pattern: GlobPattern,
	options: DescendMachineOptions,
	join: (directory: string, name: string) => string,
): Walk<DescendMachineResult<S, C>> {
	/** Yields one request; the answer is typed by the request's tag. */
	function* ask<R extends DescendRequest>(request: R): Walk<DescendResponses<S, C>[R["_tag"]]> {
		return (yield request) as DescendResponses<S, C>[R["_tag"]];
	}
	const maxDepth = options.maxDepth ?? 256;
	if (!Number.isInteger(maxDepth) || maxDepth < 1) {
		return { _tag: "Defect", message: `Walker.descend: maxDepth must be a positive integer, received ${maxDepth}` };
	}
	const prune = new Set(options.prune ?? DEFAULT_PRUNE);
	const boundaries = options.boundaries ?? [];
	const onUnreadable = options.onUnreadable ?? "fail";
	const followSymlinks = options.followSymlinks ?? false;
	const unreadable: Array<{ readonly path: string; readonly cause: C }> = [];
	const done = (entries: Array<MachineEntry<S>>): DescendMachineResult<S, C> => {
		entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return { _tag: "Done", entries, unreadable };
	};
	const unreadableFail = (path: string): DescendMachineResult<S, C> => ({
		_tag: "Fail",
		reason: "unreadableDirectory",
		path,
	});

	/**
	 * Whether the directory at `absolute` is a boundary: it holds a marker
	 * FILE. `listing`, when the directory was just read, spares the stat for
	 * every marker it does not name; a directory named like a marker is not one.
	 */
	function* isBoundary(absolute: string, listing: ReadonlyArray<string> | undefined): Walk<boolean> {
		for (const marker of boundaries) {
			if (listing !== undefined && !listing.includes(marker)) continue;
			const answer = yield* ask({ _tag: "Stat", path: join(absolute, marker) });
			if (answer?.kind === "File") return true;
		}
		return false;
	}

	/**
	 * Whether the way down `segments` (below `cwd`) is closed: a directory among
	 * the first `boundaryCount` is a boundary, or — without followSymlinks,
	 * where a symlinked directory is never entered — a link is among the first
	 * `directoryCount`. Either way the answer is nothing.
	 */
	function* blocked(segments: ReadonlyArray<string>, directoryCount: number, boundaryCount: number): Walk<boolean> {
		if (boundaries.length === 0 && followSymlinks) return false;
		let absolute = options.cwd;
		for (let index = 0; index < directoryCount; index += 1) {
			absolute = join(absolute, segments[index] ?? "");
			if (index < boundaryCount && (yield* isBoundary(absolute, undefined))) return true;
			if (!followSymlinks && (yield* ask({ _tag: "Lstat", path: absolute }))?.kind === "SymbolicLink") return true;
		}
		return false;
	}

	/** The real path of a directory the cycle guard must identify, or `undefined` when the walk must not enter it. */
	function* realPathOf(absolute: string, relative: string): Walk<string | undefined | { readonly fail: true }> {
		const answer = yield* ask({ _tag: "RealPath", path: absolute });
		if (answer._tag === "Ok") return answer.value;
		if (answer._tag === "NotFound") return undefined;
		if (onUnreadable === "fail") return { fail: true };
		if (onUnreadable === "record") unreadable.push({ path: relative, cause: answer.cause });
		return undefined;
	}

	// Literal pattern: a single stat decides. Missing is zero matches, and so is
	// a literal that climbs above `cwd`, one inside a boundary, or — without
	// followSymlinks — one reached through a symlinked directory. Braces count
	// as magic here: `hasMagic` ignores a brace group, but `src/{a,b}.ts` is
	// not a path — stat-ing its source would match nothing.
	if (!pattern.hasMagic && !pattern.negated && !/[{}]/.test(pattern.source)) {
		const segments = resolveSegments(pattern.source.split("/"));
		if (segments === undefined) return done([]);
		if (yield* blocked(segments, segments.length - 1, segments.length - 1)) return done([]);
		const answer = yield* ask({ _tag: "Stat", path: join(options.cwd, pattern.source) });
		return done(answer?.kind === "File" ? [{ path: pattern.source, info: answer.info }] : []);
	}

	const results: Array<MachineEntry<S>> = [];

	/**
	 * Walks one root: the literal directory `base` and everything below it a
	 * match can lie in — one level, or all of it when `deep`. An absent base,
	 * one that climbs above `cwd`, or one behind a boundary or a link is
	 * skipped; a `Fail` aborts the walk.
	 *
	 * The walk itself is canonical (`cwd` is `""`, never `.`), so each directory
	 * is read once however many spellings name it. What it answers is spelled
	 * the way the pattern spells it: a file matches when its path, re-spelled
	 * through one of the root's spellings, matches the pattern, and it is
	 * answered ONCE, in the first such spelling — the earliest brace
	 * alternative's, since spellings come in pattern order. A directory the
	 * walk reports (unreadable, too deep) is spelled through the root's own
	 * earliest spelling.
	 */
	function* walkRoot(
		rawBase: string,
		deep: boolean,
		spellings: ReadonlyArray<string>,
	): Walk<DescendMachineResult<S, C> | undefined> {
		// Each spelling paired with the canonical prefix it stands for; a spelling
		// that is already canonical is the path itself.
		const spelled = spellings.map((spelling) => {
			const canonical = resolveSegments(spelling.split("/"))?.join("/") ?? "";
			return { spelling, canonical: canonical === "" ? "" : `${canonical}/` };
		});
		/** The file at canonical `relative`, in the first spelling the pattern matches it under, or `undefined`. */
		const matchedAs = (relative: string): string | undefined => {
			for (const { spelling, canonical } of spelled) {
				if (canonical !== "" && !relative.startsWith(canonical)) continue;
				const candidate = spelling + relative.slice(canonical.length);
				if (pattern.matches(candidate)) return candidate;
			}
			return undefined;
		};
		// A base that lexically climbs above `cwd` can match no walked path (none holds `..`): zero matches, and no
		// filesystem access outside `cwd`.
		const baseSegments = resolveSegments(rawBase.split("/"));
		if (baseSegments === undefined) return undefined;
		// The base in canonical form: `cwd` itself is `""`, never `.`, so it is never mistaken for a boundary below it.
		const base = baseSegments.join("/");
		const baseCanonical = base === "" ? "" : `${base}/`;
		// The root's own earliest spelling, for the directories it reports: the base as the pattern spells it
		// (`./` reports `.`), and a directory below it as that spelling plus the rest.
		const own = spelled.find(({ canonical }) => canonical === baseCanonical)?.spelling ?? baseCanonical;
		const shown = (relative: string): string =>
			relative === base ? trimTrailing(own, isSlash) : own + relative.slice(baseCanonical.length);
		const absoluteBase = base === "" ? options.cwd : join(options.cwd, base);
		const baseStat = yield* ask({ _tag: "Stat", path: absoluteBase });
		if (baseStat?.kind !== "Directory") return undefined;
		if (yield* blocked(baseSegments, baseSegments.length, baseSegments.length - 1)) return undefined;
		let baseAncestors: ReadonlyArray<string> = NO_ANCESTORS;
		if (followSymlinks) {
			const real = yield* realPathOf(absoluteBase, shown(base));
			if (typeof real === "object") return unreadableFail(shown(base));
			if (real === undefined) return undefined;
			baseAncestors = [real];
		}

		const frames: Array<Frame> = [{ relative: base, absolute: absoluteBase, depth: 0, ancestors: baseAncestors }];
		// A head index, never Array.shift(): shift() re-indexes the whole array on
		// every dequeue, turning a large walk quadratic.
		for (let head = 0; head < frames.length; head += 1) {
			const frame = frames[head];
			if (frame === undefined) break;

			// A vanished directory is a benign race — empty, never recorded. Any
			// other failure is a subtree we were asked to enumerate and cannot.
			const read = yield* ask({ _tag: "ReadDirectory", path: frame.absolute });
			let entries: ReadonlyArray<string> = [];
			if (read._tag === "Ok") entries = read.value;
			else if (read._tag === "Failed") {
				if (onUnreadable === "fail") return unreadableFail(shown(frame.relative));
				if (onUnreadable === "record") unreadable.push({ path: shown(frame.relative), cause: read.cause });
			}

			// A boundary below `cwd` contributes nothing: neither its files nor its
			// subtree. `cwd` itself is never a boundary.
			if (frame.relative !== "" && (yield* isBoundary(frame.absolute, entries))) continue;

			for (const entry of entries) {
				const relative = frame.relative === "" ? entry : `${frame.relative}/${entry}`;
				const absolute = join(frame.absolute, entry);

				// One lstat classifies the entry; only a link pays a stat to resolve it.
				const own = yield* ask({ _tag: "Lstat", path: absolute });
				const link = own?.kind === "SymbolicLink";
				const stat = link ? yield* ask({ _tag: "Stat", path: absolute }) : own;
				if (stat === undefined) continue;
				if (stat.kind === "File") {
					const path = matchedAs(relative);
					if (path !== undefined) results.push({ path, info: stat.info });
					continue;
				}
				if (stat.kind !== "Directory" || !deep) continue;
				// Prune suppresses DIRECTORIES only — a FILE named `.git` stays matchable.
				if (prune.has(entry)) continue;
				// Symlinked directories: skipped unless followSymlinks; when followed,
				// the per-branch real-path chain detects a cycle. Only a LINK pays a
				// realPath — a plain directory's real path is its parent's plus its name.
				let ancestors = frame.ancestors;
				if (followSymlinks) {
					const parentReal = frame.ancestors[frame.ancestors.length - 1] ?? frame.absolute;
					const real = link ? yield* realPathOf(absolute, shown(relative)) : join(parentReal, entry);
					if (typeof real === "object") return unreadableFail(shown(relative));
					if (real === undefined || frame.ancestors.includes(real)) continue;
					ancestors = [...frame.ancestors, real];
				} else if (link) {
					continue;
				}
				// Depth exhaustion is a typed failure, not a truncation.
				if (frame.depth + 1 > maxDepth) {
					return { _tag: "Fail", reason: "depthExceeded", path: shown(frame.relative), limit: maxDepth };
				}
				frames.push({ relative, absolute, depth: frame.depth + 1, ancestors });
			}
		}
		return undefined;
	}

	// Magic pattern: walk each root of its brace alternatives (a NEGATED pattern
	// walks from `cwd`, since its matches can land anywhere). The roots' prefixes
	// are canonical and distinct and none lies inside a deep one, so no directory
	// is read twice and no file is found by two roots.
	const roots = pattern.negated ? [{ prefix: "", deep: true, spellings: [""] }] : pattern.enumerationRoots;
	for (const root of roots) {
		const failed = yield* walkRoot(trimTrailing(root.prefix, isSlash), root.deep, root.spellings);
		if (failed !== undefined) return failed;
	}
	return done(results);
}

/** The typed error a `Fail` result describes — the one conversion both drivers share. */
export const failureOf = <S, C>(
	pattern: GlobPattern,
	result: Extract<DescendMachineResult<S, C>, { readonly _tag: "Fail" }>,
): {
	readonly pattern: string;
	readonly reason: typeof result.reason;
	readonly path: string;
	readonly limit?: number;
} => ({
	pattern: pattern.source,
	reason: result.reason,
	path: result.path,
	...(result.limit === undefined ? {} : { limit: result.limit }),
});
