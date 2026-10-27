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

/** What a stat answers: the resolved kind (links followed) and the raw info, or `undefined` when it does not resolve. */
export type StatAnswer<S> = { readonly kind: "File" | "Directory" | "Other"; readonly info: S } | undefined;

/** A read that distinguishes the benign vanished-path race from a real failure. */
export type ReadAnswer<T, C> =
	| { readonly _tag: "Ok"; readonly value: T }
	| { readonly _tag: "NotFound" }
	| { readonly _tag: "Failed"; readonly cause: C };

/** One filesystem request the walk makes of its driver. */
export type DescendRequest =
	| { readonly _tag: "Stat"; readonly path: string }
	| { readonly _tag: "IsSymbolicLink"; readonly path: string }
	| { readonly _tag: "RealPath"; readonly path: string }
	| { readonly _tag: "ReadDirectory"; readonly path: string };

/** The driver's answer to each request kind. */
export interface DescendResponses<S, C> {
	readonly Stat: StatAnswer<S>;
	readonly IsSymbolicLink: boolean;
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

/** Shared empty ancestor chain: frames under `followSymlinks: false` never consult theirs. */
const NO_ANCESTORS: ReadonlyArray<string> = Object.freeze([]);

/**
 * Whether a cwd-relative pattern path lexically climbs above `cwd` via `..`
 * segments. Walked paths never contain `..`, so such a pattern can never match
 * one — the answer is zero matches, and no filesystem access outside `cwd`
 * ever happens.
 */
const escapesCwd = (relative: string): boolean => resolveSegments(relative.split("/")) === undefined;

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

/** Yields one request; the call site narrows the answer to the request's response type. */
function* ask(request: DescendRequest): Walk<unknown> {
	return yield request;
}

/** The walk. */
export function* descendMachine<S, C>(
	pattern: GlobPattern,
	options: DescendMachineOptions,
	join: (directory: string, name: string) => string,
): Walk<DescendMachineResult<S, C>> {
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
			if ((answer as StatAnswer<S>)?.kind === "File") return true;
		}
		return false;
	}

	/**
	 * Whether any directory strictly below `cwd` on the way to `segments` (the
	 * first `count` of them) is a boundary — so a walk that starts below one,
	 * or a literal that names a file inside one, answers what a walk from
	 * `cwd` would have: nothing.
	 */
	function* crossesBoundary(segments: ReadonlyArray<string>, count: number): Walk<boolean> {
		if (boundaries.length === 0) return false;
		let absolute = options.cwd;
		for (let index = 0; index < count; index += 1) {
			absolute = join(absolute, segments[index] ?? "");
			if (yield* isBoundary(absolute, undefined)) return true;
		}
		return false;
	}

	/** The real path of a directory the cycle guard must identify, or `undefined` when the walk must not enter it. */
	function* realPathOf(absolute: string, relative: string): Walk<string | undefined | { readonly fail: true }> {
		const answer = (yield* ask({ _tag: "RealPath", path: absolute })) as ReadAnswer<string, C>;
		if (answer._tag === "Ok") return answer.value;
		if (answer._tag === "NotFound") return undefined;
		if (onUnreadable === "fail") return { fail: true };
		if (onUnreadable === "record") unreadable.push({ path: relative, cause: answer.cause });
		return undefined;
	}

	// Literal pattern: a single stat decides. Missing is zero matches, and so is
	// a literal that climbs above `cwd`, or one inside a boundary.
	if (!pattern.hasMagic && !pattern.negated) {
		const segments = resolveSegments(pattern.source.split("/"));
		if (segments === undefined) return done([]);
		if (yield* crossesBoundary(segments, segments.length - 1)) return done([]);
		const answer = (yield* ask({
			_tag: "Stat",
			path: join(options.cwd, pattern.source),
		})) as StatAnswer<S>;
		return done(answer?.kind === "File" ? [{ path: pattern.source, info: answer.info }] : []);
	}

	// Magic pattern: walk from the literal prefix (a NEGATED pattern walks from
	// `cwd`, since its matches can land anywhere). An absent base is an empty
	// result; a prefix that climbs above `cwd` is zero matches.
	const base = pattern.negated ? "" : pattern.enumerationPrefix.replace(/\/+$/, "");
	if (escapesCwd(base)) return done([]);
	const absoluteBase = base === "" ? options.cwd : join(options.cwd, base);
	const baseStat = (yield* ask({ _tag: "Stat", path: absoluteBase })) as StatAnswer<S>;
	if (baseStat?.kind !== "Directory") return done([]);
	const baseSegments = resolveSegments(base.split("/")) ?? [];
	if (yield* crossesBoundary(baseSegments, baseSegments.length - 1)) return done([]);
	let baseAncestors: ReadonlyArray<string> = NO_ANCESTORS;
	if (followSymlinks) {
		const real = yield* realPathOf(absoluteBase, base);
		if (typeof real === "object") return unreadableFail(base);
		if (real === undefined) return done([]);
		baseAncestors = [real];
	}

	// Only a pattern that can match below one level earns a descent.
	const deep = pattern.crossesSegments || pattern.negated;

	const results: Array<MachineEntry<S>> = [];
	const frames: Array<Frame> = [{ relative: base, absolute: absoluteBase, depth: 0, ancestors: baseAncestors }];
	// A head index, never Array.shift(): shift() re-indexes the whole array on
	// every dequeue, turning a large walk quadratic.
	for (let head = 0; head < frames.length; head += 1) {
		const frame = frames[head];
		if (frame === undefined) break;

		// A vanished directory is a benign race — empty, never recorded. Any
		// other failure is a subtree we were asked to enumerate and cannot.
		const read = (yield* ask({
			_tag: "ReadDirectory",
			path: frame.absolute,
		})) as ReadAnswer<ReadonlyArray<string>, C>;
		let entries: ReadonlyArray<string> = [];
		if (read._tag === "Ok") entries = read.value;
		else if (read._tag === "Failed") {
			if (onUnreadable === "fail") return unreadableFail(frame.relative);
			if (onUnreadable === "record") unreadable.push({ path: frame.relative, cause: read.cause });
		}

		// A boundary below `cwd` contributes nothing: neither its files nor its
		// subtree. `cwd` itself is never a boundary.
		if (frame.relative !== "" && (yield* isBoundary(frame.absolute, entries))) continue;

		for (const entry of entries) {
			const relative = frame.relative === "" ? entry : `${frame.relative}/${entry}`;
			const absolute = join(frame.absolute, entry);

			const stat = (yield* ask({ _tag: "Stat", path: absolute })) as StatAnswer<S>;
			if (stat?.kind === "File") {
				if (pattern.matches(relative)) results.push({ path: relative, info: stat.info });
				continue;
			}
			if (stat?.kind !== "Directory" || !deep) continue;
			// Prune suppresses DIRECTORIES only — a FILE named `.git` stays matchable.
			if (prune.has(entry)) continue;
			// Symlinked directories: skipped unless followSymlinks; when followed,
			// the per-branch real-path chain detects a cycle. Only a LINK pays a
			// realPath — a plain directory's real path is its parent's plus its name.
			let ancestors = frame.ancestors;
			const link = (yield* ask({ _tag: "IsSymbolicLink", path: absolute })) as boolean;
			if (followSymlinks) {
				const parentReal = frame.ancestors[frame.ancestors.length - 1] ?? frame.absolute;
				const real = link ? yield* realPathOf(absolute, relative) : join(parentReal, entry);
				if (typeof real === "object") return unreadableFail(relative);
				if (real === undefined || frame.ancestors.includes(real)) continue;
				ancestors = [...frame.ancestors, real];
			} else if (link) {
				continue;
			}
			// Depth exhaustion is a typed failure, not a truncation.
			if (frame.depth + 1 > maxDepth) {
				return { _tag: "Fail", reason: "depthExceeded", path: frame.relative, limit: maxDepth };
			}
			frames.push({ relative, absolute, depth: frame.depth + 1, ancestors });
		}
	}

	return done(results);
}
