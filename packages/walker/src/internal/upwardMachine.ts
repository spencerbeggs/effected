// The upward walk and the physical confinement check, written ONCE as
// generators that yield filesystem requests — the move `descendMachine.ts`
// makes for the downward walk.
//
// `Walker.*` and `confineReal` answer each request with core's `FileSystem`;
// their `*Sync` twins answer it from the caller-supplied synchronous port.
// Every rule — the depth cap, the ceiling comparison, the marker stop, the
// directory-major candidate order, the segment-wise physical resolution —
// lives here, so the two worlds cannot disagree. Pure: no IO, no platform.
// Path arithmetic is a caller-supplied set of functions, not a request,
// because it is pure in both worlds.

import { isCurrentDriveRooted, isPinnedAbsolute } from "./absolute.js";
import { trimTrailing } from "./trimTrailing.js";

/** The pure path operations the upward walk and the confinement check use. */
export interface PathOps {
	readonly sep: string;
	readonly dirname: (path: string) => string;
	readonly resolve: (...segments: ReadonlyArray<string>) => string;
	readonly isAbsolute: (path: string) => boolean;
	readonly join: (...segments: ReadonlyArray<string>) => string;
}

/**
 * One filesystem request: whether a path exists (links followed), its real
 * path, or whether ANY entry — a dangling link included — lives at the path
 * itself (`lstat`, links not followed).
 */
export type UpwardRequest =
	| { readonly _tag: "Exists"; readonly path: string }
	| { readonly _tag: "RealPath"; readonly path: string }
	| { readonly _tag: "Present"; readonly path: string };

/** A presence answer: something lives at the path, nothing does, or the probe failed. */
export type PresentAnswer<C> =
	| { readonly _tag: "Present" }
	| { readonly _tag: "NotFound" }
	| { readonly _tag: "Failed"; readonly cause: C };

/**
 * A real-path answer. `NotFound` keeps the failure that reported it: a
 * dangling link reports `NotFound` too, and its refusal carries that cause.
 */
export type RealPathAnswer<C> =
	| { readonly _tag: "Ok"; readonly value: string }
	| { readonly _tag: "NotFound"; readonly cause: C }
	| { readonly _tag: "Failed"; readonly cause: C };

/** The driver's answer to each request kind. `Exists` absorbs every failure as `false`. */
export interface UpwardResponses<C> {
	readonly Exists: boolean;
	readonly RealPath: RealPathAnswer<C>;
	readonly Present: PresentAnswer<C>;
}

/** How a machine ended: a value, or a wiring defect the driver dies (or throws) with. */
export type UpwardResult<A> =
	| { readonly _tag: "Done"; readonly value: A }
	| { readonly _tag: "Defect"; readonly message: string };

type Walk<A> = Generator<UpwardRequest, A, unknown>;

/** Asks for the real path at `path`. */
function* realPath<C>(path: string): Walk<RealPathAnswer<C>> {
	return (yield { _tag: "RealPath", path }) as UpwardResponses<C>["RealPath"];
}

/** Asks whether anything — a dangling link included — lives at `path` itself. */
function* present<C>(path: string): Walk<PresentAnswer<C>> {
	return (yield { _tag: "Present", path }) as UpwardResponses<C>["Present"];
}

/** Asks whether `path` exists. */
function* exists(path: string): Walk<boolean> {
	return (yield { _tag: "Exists", path }) as UpwardResponses<unknown>["Exists"];
}

const done = <A>(value: A): UpwardResult<A> => ({ _tag: "Done", value });
const defect = (message: string): UpwardResult<never> => ({ _tag: "Defect", message });

/** The options the chain itself reads. */
export interface ChainOptions {
	readonly stopAt?: string | undefined;
	readonly maxDepth?: number | undefined;
}

/**
 * The lexical chain from `start` toward the root, nearest first — `ascend`'s
 * whole algorithm. Pure: it reads no filesystem, so it is not a generator.
 * `name` prefixes the defect messages, so each public form reports itself.
 */
export const ascendChain = (
	name: string,
	start: string,
	options: ChainOptions | undefined,
	path: PathOps,
): UpwardResult<ReadonlyArray<string>> => {
	const maxDepth = options?.maxDepth ?? 256;
	if (!Number.isInteger(maxDepth) || maxDepth < 1) {
		return defect(`${name}: maxDepth must be a positive integer, received ${maxDepth}`);
	}
	// A relative CEILING dies, exactly as an invalid maxDepth does — same
	// category, same construct. `start` is deliberately unconstrained: a
	// relative start still ascends to the relative root.
	if (options?.stopAt !== undefined && !isPinnedAbsolute(options.stopAt, path)) {
		return defect(
			`${name}: stopAt must be an absolute path, received ${JSON.stringify(options.stopAt)} (ascending from ${JSON.stringify(start)})`,
		);
	}
	// Normalize the ceiling ONCE, then compare normalized forms. Both sides go
	// through `resolve`: normalizing only the ceiling would desynchronize it
	// from an unnormalized chain element (`/a/b/.` names `/a/b`). The raw
	// equality check is a fast path for the common already-resolved ceiling,
	// never the only comparison.
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
	return done(dirs);
};

/** The real path at `path`, or `undefined` when it cannot be resolved for any reason. */
function* realPathOrUndefined(path: string): Walk<string | undefined> {
	const answer = yield* realPath<unknown>(path);
	return answer._tag === "Ok" ? answer.value : undefined;
}

/**
 * `ascendWithin`: the lexical chain, stopped at the nearest ancestor whose real
 * path is the ceiling's. `ceiling === undefined` is `Option.none()` — the chain
 * runs to the root exactly as `ascend` gives it.
 */
export function* ascendWithinMachine(
	name: string,
	start: string,
	ceiling: string | undefined,
	options: Omit<ChainOptions, "stopAt"> | undefined,
	path: PathOps,
): Walk<UpwardResult<ReadonlyArray<string>>> {
	const maxDepth = options?.maxDepth === undefined ? {} : { maxDepth: options.maxDepth };
	if (ceiling === undefined) return ascendChain(name, start, maxDepth, path);
	if (!isPinnedAbsolute(ceiling, path)) {
		return defect(
			`${name}: ceiling must be an absolute path, received ${JSON.stringify(ceiling)} (ascending from ${JSON.stringify(start)})`,
		);
	}
	// The lexical pass first: a ceiling the chain already spells needs no I/O.
	const lexical = ascendChain(name, start, { ...maxDepth, stopAt: ceiling }, path);
	if (lexical._tag === "Defect") return lexical;
	const dirs = lexical.value;
	const last = dirs.at(-1);
	if (last !== undefined && path.resolve(last) === path.resolve(ceiling)) return lexical;
	// A ceiling that cannot be resolved names nothing physical to match; the
	// lexical answer stands, exactly as `ascend` would give it.
	const physical = yield* realPathOrUndefined(ceiling);
	if (physical === undefined) return lexical;
	// A failed probe on an ancestor is "not the ceiling", as `firstMatch` absorbs one.
	for (let index = 0; index < dirs.length; index += 1) {
		if ((yield* realPathOrUndefined(dirs[index] ?? "")) === physical) return done(dirs.slice(0, index + 1));
	}
	return lexical;
}

/**
 * `ascendToMarker`: the lexical chain, stopped at the nearest directory that
 * holds any of `markers`, inclusive. Probes stop at the hit — nothing above it
 * is ever touched.
 */
export function* ascendToMarkerMachine(
	name: string,
	start: string,
	markers: ReadonlyArray<string>,
	options: Omit<ChainOptions, "stopAt"> | undefined,
	path: PathOps,
): Walk<UpwardResult<ReadonlyArray<string>>> {
	if (markers.length === 0) {
		return defect(`${name}: markers must name at least one entry (ascending from ${JSON.stringify(start)})`);
	}
	const empty = markers.find((marker) => marker === "");
	if (empty !== undefined) {
		return defect(`${name}: a marker must be a non-empty entry name (ascending from ${JSON.stringify(start)})`);
	}
	const chain = ascendChain(name, start, options?.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }, path);
	if (chain._tag === "Defect") return chain;
	const dirs = chain.value;
	for (let index = 0; index < dirs.length; index += 1) {
		const dir = dirs[index] ?? "";
		for (const marker of markers) {
			if (yield* exists(path.join(dir, marker))) return done(dirs.slice(0, index + 1));
		}
	}
	return chain;
}

/** `findUpward`: the first existing candidate, directory-major, or `undefined`. */
export function* findUpwardMachine(
	dirs: ReadonlyArray<string>,
	candidatesFor: (dir: string) => ReadonlyArray<string>,
): Walk<UpwardResult<string | undefined>> {
	// Candidates materialize up front, so a throwing `candidatesFor` throws
	// before any probe, as it always has.
	const candidates: Array<string> = [];
	for (const dir of dirs) candidates.push(...candidatesFor(dir));
	for (const candidate of candidates) if (yield* exists(candidate)) return done(candidate);
	return done(undefined);
}

/** `findUpwardAll`'s answer: the nearest directory with any hit, and every hit in it. */
export interface UpwardHits {
	readonly dir: string;
	readonly found: readonly [string, ...Array<string>];
}

/**
 * `findUpwardAll`: every existing candidate of the nearest directory with any
 * hit, in candidate order — that directory's candidates are ALL probed, so a
 * second hit (an ambiguity) is never hidden; nothing above it is probed.
 */
export function* findUpwardAllMachine(
	dirs: ReadonlyArray<string>,
	candidatesFor: (dir: string) => ReadonlyArray<string>,
): Walk<UpwardResult<UpwardHits | undefined>> {
	const expanded = dirs.map((dir) => ({ dir, candidates: candidatesFor(dir) }));
	for (const { dir, candidates } of expanded) {
		const found: Array<string> = [];
		for (const candidate of candidates) if (yield* exists(candidate)) found.push(candidate);
		const [first, ...rest] = found;
		if (first !== undefined) return done({ dir, found: [first, ...rest] });
	}
	return done(undefined);
}

// ---------------------------------------------------------------------------
// Physical confinement.

/** Why `confineReal` refused a candidate, plus the failure an unresolvable path carried. */
export type ConfineRefusal<C> =
	| { readonly _tag: "Refused"; readonly reason: "nulByte" | "absolute" | "empty" | "reservedName" | "outside" }
	| { readonly _tag: "Unresolvable"; readonly cause: C };

/** A segment of dots and spaces only, which win32 trims to nothing or to `..`. */
const DOTS_AND_SPACES = /^[. ]+$/;
/** A win32 reserved device name, with or without an extension, in any case. */
const DEVICE_NAME =
	/^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$) *(?:\..*)?$/i;
/** A win32 drive designator at the start of a path: `C:`, `C:x`, `C:\x`. */
const DRIVE = /^[A-Za-z]:/;

/** Whether win32 reads a segment as something other than a plain entry (`.` and `..` are handled before). */
const isWin32Reserved = (segment: string): boolean =>
	segment.includes(":") || DOTS_AND_SPACES.test(segment) || DEVICE_NAME.test(segment);

/**
 * Resolve `absolute` physically, segment by segment, the way the operating
 * system would: a `..` after a link climbs out of the link's TARGET, never
 * lexically out of the link. A first `RealPath` on the whole path settles the
 * common case in one request when no `..` is present (a lexical-first
 * `realpath` — node's JS `fs.realpath` — would otherwise collapse `link/..`
 * before resolving the link). A path, or tail, that does not exist yet is
 * resolved lexically from its real existing ancestor — but `NotFound` from a
 * real-path request is NOT proof of absence: a dangling link answers it too,
 * and a write through one creates its target wherever it points. So every
 * `NotFound` segment is checked with `Present`, and only "nothing lives here"
 * continues lexically; a dangling link (or an entry that appeared between the
 * two requests) is unresolvable, its target unverified. Any failure other
 * than `NotFound` makes the path unresolvable too. Fail closed throughout.
 */
function* resolvePhysical<C>(
	absolute: string,
	path: PathOps,
	win32: boolean,
	checkSegments: boolean,
	requireExisting = false,
): Walk<{ readonly _tag: "Ok"; readonly value: string } | ConfineRefusal<C>> {
	let root = absolute;
	for (let parent = path.dirname(root); parent !== root; parent = path.dirname(root)) root = parent;
	const rest = absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
	const segments = rest.split(win32 ? /[\\/]/ : "/").filter((segment) => segment !== "");
	if (checkSegments && win32) {
		for (const segment of segments) {
			if (segment !== "." && segment !== ".." && isWin32Reserved(segment)) {
				return { _tag: "Refused", reason: "reservedName" };
			}
		}
	}
	const isSep = (character: string): boolean => character === path.sep || (win32 && character === "/");
	const real = (target: string) => realPath<C>(target);
	if (!segments.includes("..")) {
		const whole = yield* real(absolute);
		if (whole._tag === "Ok") return whole;
		if (whole._tag === "Failed") return { _tag: "Unresolvable", cause: whole.cause };
	}
	const rootAnswer = yield* real(root);
	if (rootAnswer._tag === "Failed") return { _tag: "Unresolvable", cause: rootAnswer.cause };
	let current = rootAnswer._tag === "Ok" ? rootAnswer.value : root;
	for (const segment of segments) {
		if (segment === ".") continue;
		// `current` is always real (or does not exist), so its lexical parent is its physical one.
		if (segment === "..") {
			current = path.dirname(current);
			continue;
		}
		const next = `${trimTrailing(current, isSep)}${path.sep}${segment}`;
		const answer = yield* real(next);
		if (answer._tag === "Failed") return { _tag: "Unresolvable", cause: answer.cause };
		if (answer._tag === "Ok") {
			current = answer.value;
			continue;
		}
		// `NotFound`: absent, or a dangling link. Only absence continues lexically.
		const entry = yield* present<C>(next);
		if (entry._tag === "Failed") return { _tag: "Unresolvable", cause: entry.cause };
		// A link whose target does not resolve, or an entry that appeared between
		// the two requests: either way nothing proves where it leads.
		if (entry._tag === "Present") return { _tag: "Unresolvable", cause: answer.cause };
		// A caller that needs an existing path is not told where an absent one would land.
		if (requireExisting) return { _tag: "Refused", reason: "outside" };
		current = next;
	}
	return { _tag: "Ok", value: current };
}

/**
 * `confineReal`: the candidate's real path when it lies strictly inside the
 * base's real path, or why not. A relative `base` is a wiring defect.
 */
export function* confineRealMachine<C>(
	name: string,
	base: string,
	candidate: string,
	path: PathOps,
	within: false | { readonly requireExisting: boolean } = false,
): Walk<UpwardResult<{ readonly _tag: "Ok"; readonly value: string } | ConfineRefusal<C>>> {
	// A win32 `\repo` is absolute to `isAbsolute`, yet which drive it names
	// depends on the process working directory: a wiring defect like `C:repo`.
	if (base.includes("\0") || !isPinnedAbsolute(base, path)) {
		return defect(`${name}: base must be an absolute path, received ${JSON.stringify(base)}`);
	}
	const refuse = (reason: Extract<ConfineRefusal<C>, { _tag: "Refused" }>["reason"]) =>
		done<ConfineRefusal<C>>({ _tag: "Refused", reason });
	if (candidate.includes("\0")) return refuse("nulByte");
	if (candidate === "") return refuse("empty");
	// `within` answers a base-relative path for an absolute candidate only.
	if (within && !path.isAbsolute(candidate)) return refuse("absolute");
	const win32 = path.sep === "\\";
	const isSep = (character: string): boolean => character === path.sep || (win32 && character === "/");
	// A drive-relative `C:x` is not absolute to win32's `isAbsolute`, yet it is
	// not relative to the base either: it names the current directory of drive C.
	// A driveless `\x` is its mirror image — absolute, but on the current drive.
	if (win32 && DRIVE.test(candidate) && !path.isAbsolute(candidate)) return refuse("absolute");
	if (isCurrentDriveRooted(candidate, path.sep)) return refuse("absolute");
	// Joined by concatenation, never `path.join`, which would collapse `link/..`
	// lexically before the physical resolution below ever saw it.
	const full = path.isAbsolute(candidate) ? candidate : `${trimTrailing(base, isSep)}${path.sep}${candidate}`;
	const baseReal = yield* resolvePhysical<C>(base, path, win32, false);
	if (baseReal._tag !== "Ok") return done(baseReal);
	const candidateReal = yield* resolvePhysical<C>(full, path, win32, true, within !== false && within.requireExisting);
	if (candidateReal._tag !== "Ok") return done(candidateReal);
	const root = trimTrailing(baseReal.value, isSep);
	const resolved = trimTrailing(candidateReal.value, isSep);
	if (within && resolved === root) return done({ _tag: "Ok", value: "" });
	if (resolved === root) return refuse("empty");
	// `root` is `""` for a filesystem-root base, so the prefix is the separator alone.
	if (!resolved.startsWith(`${root}${path.sep}`)) return refuse("outside");
	if (within)
		return done({
			_tag: "Ok",
			value: resolved
				.slice(root.length + 1)
				.split(path.sep)
				.join("/"),
		});
	return done({ _tag: "Ok", value: candidateReal.value });
}
