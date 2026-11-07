// POSIX path arithmetic as plain synchronous functions, reading no working
// directory.
//
// `normalize`, `join`, `dirname`, `basename`, `extname`, `isAbsolute` and the
// absolute half of `relative` are ported from the POSIX implementation behind
// core's `Path.layer` (`effect`, `packages/effect/src/Path.ts`: `posixImpl` and
// `normalizeStringPosix`), which core in turn adapted from Node.js
// (`lib/path.js`, MIT License, Copyright Node.js contributors). `resolve` is
// absent and `relative` never reads `process.cwd()`: those are the two members
// core's implementation cannot answer without one.

const SLASH = 47; // "/"
const DOT = 46; // "."

/** Resolves `.` and `..` elements in a path with directory names (core's `normalizeStringPosix`). */
const normalizeString = (path: string, allowAboveRoot: boolean): string => {
	let res = "";
	let lastSegmentLength = 0;
	let lastSlash = -1;
	let dots = 0;
	let code = 0;
	for (let i = 0; i <= path.length; ++i) {
		if (i < path.length) code = path.charCodeAt(i);
		else if (code === SLASH) break;
		else code = SLASH;
		if (code === SLASH) {
			if (lastSlash === i - 1 || dots === 1) {
				// NOOP
			} else if (dots === 2) {
				if (
					res.length < 2 ||
					lastSegmentLength !== 2 ||
					res.charCodeAt(res.length - 1) !== DOT ||
					res.charCodeAt(res.length - 2) !== DOT
				) {
					if (res.length > 2) {
						const lastSlashIndex = res.lastIndexOf("/");
						if (lastSlashIndex !== res.length - 1) {
							if (lastSlashIndex === -1) {
								res = "";
								lastSegmentLength = 0;
							} else {
								res = res.slice(0, lastSlashIndex);
								lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
							}
							lastSlash = i;
							dots = 0;
							continue;
						}
					} else if (res.length === 2 || res.length === 1) {
						res = "";
						lastSegmentLength = 0;
						lastSlash = i;
						dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) {
					res = res.length > 0 ? `${res}/..` : "..";
					lastSegmentLength = 2;
				}
			} else {
				res = res.length > 0 ? `${res}/${path.slice(lastSlash + 1, i)}` : path.slice(lastSlash + 1, i);
				lastSegmentLength = i - lastSlash - 1;
			}
			lastSlash = i;
			dots = 0;
		} else if (code === DOT && dots !== -1) {
			++dots;
		} else {
			dots = -1;
		}
	}
	return res;
};

const isAbsolute = (path: string): boolean => path.length > 0 && path.charCodeAt(0) === SLASH;

const normalize = (path: string): string => {
	if (path.length === 0) return ".";
	const absolute = isAbsolute(path);
	const trailingSeparator = path.charCodeAt(path.length - 1) === SLASH;
	let normalized = normalizeString(path, !absolute);
	if (normalized.length === 0 && !absolute) normalized = ".";
	if (normalized.length > 0 && trailingSeparator) normalized += "/";
	return absolute ? `/${normalized}` : normalized;
};

const join = (paths: ReadonlyArray<string>): string => {
	let joined: string | undefined;
	for (const path of paths) {
		if (path.length > 0) joined = joined === undefined ? path : `${joined}/${path}`;
	}
	return joined === undefined ? "." : normalize(joined);
};

/** An absolute path as core's `resolve` answers it: normalized, no trailing slash, `/` for the root. */
const resolveAbsolute = (path: string): string => {
	const normalized = normalizeString(path, false);
	return normalized.length > 0 ? `/${normalized}` : "/";
};

/** Core's `relative`, over two already-resolved absolute paths. */
const relativeAbsolute = (from: string, to: string): string => {
	if (from === to) return "";
	let fromStart = 1;
	for (; fromStart < from.length; ++fromStart) if (from.charCodeAt(fromStart) !== SLASH) break;
	const fromEnd = from.length;
	const fromLen = fromEnd - fromStart;
	let toStart = 1;
	for (; toStart < to.length; ++toStart) if (to.charCodeAt(toStart) !== SLASH) break;
	const toEnd = to.length;
	const toLen = toEnd - toStart;
	const length = Math.min(fromLen, toLen);
	let lastCommonSep = -1;
	let i = 0;
	for (; i <= length; ++i) {
		if (i === length) {
			if (toLen > length) {
				// `from` is the exact base of `to` (`/foo/bar` → `/foo/bar/baz`), or the root.
				if (to.charCodeAt(toStart + i) === SLASH) return to.slice(toStart + i + 1);
				if (i === 0) return to.slice(toStart + i);
			} else if (fromLen > length) {
				// `to` is the exact base of `from` (`/foo/bar/baz` → `/foo/bar`), or the root.
				if (from.charCodeAt(fromStart + i) === SLASH) lastCommonSep = i;
				else if (i === 0) lastCommonSep = 0;
			}
			break;
		}
		const fromCode = from.charCodeAt(fromStart + i);
		if (fromCode !== to.charCodeAt(toStart + i)) break;
		if (fromCode === SLASH) lastCommonSep = i;
	}
	let out = "";
	for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
		if (i === fromEnd || from.charCodeAt(i) === SLASH) out += out.length === 0 ? ".." : "/..";
	}
	if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
	toStart += lastCommonSep;
	if (to.charCodeAt(toStart) === SLASH) ++toStart;
	return to.slice(toStart);
};

/** A relative path's normalized segments, split into its leading climb and the rest. */
const climbAndRest = (path: string): { readonly climb: number; readonly rest: ReadonlyArray<string> } => {
	const segments = normalizeString(path, true)
		.split("/")
		.filter((segment) => segment !== "");
	let climb = 0;
	while (segments[climb] === "..") climb += 1;
	return { climb, rest: segments.slice(climb) };
};

const relative = (from: string, to: string): string => {
	if (from === to) return "";
	const fromAbsolute = isAbsolute(from);
	if (fromAbsolute !== isAbsolute(to)) {
		throw new Error(
			`PosixPath.relative: one absolute and one relative path need a working directory, received ${JSON.stringify(from)} and ${JSON.stringify(to)}`,
		);
	}
	if (fromAbsolute) return relativeAbsolute(resolveAbsolute(from), resolveAbsolute(to));
	// Two paths relative to one unnamed directory. Each climbs some way above it
	// (its leading `..`), then descends. The answer needs no names only when
	// both climb equally — then it is the absolute answer under any root — or
	// when `to` merely climbs higher, an ancestor of `from`. Anything else must
	// spell the names of the directories above the shared one.
	const a = climbAndRest(from);
	const b = climbAndRest(to);
	if (a.climb === b.climb) return relativeAbsolute(`/${a.rest.join("/")}`, `/${b.rest.join("/")}`);
	if (a.climb < b.climb && b.rest.length === 0) {
		return Array.from({ length: a.rest.length + b.climb - a.climb }, () => "..").join("/");
	}
	throw new Error(
		`PosixPath.relative: ${JSON.stringify(from)} to ${JSON.stringify(to)} depends on the names of directories above the working directory`,
	);
};

const dirname = (path: string): string => {
	if (path.length === 0) return ".";
	const hasRoot = path.charCodeAt(0) === SLASH;
	let end = -1;
	let matchedSlash = true;
	for (let i = path.length - 1; i >= 1; --i) {
		if (path.charCodeAt(i) === SLASH) {
			if (!matchedSlash) {
				end = i;
				break;
			}
		} else {
			matchedSlash = false;
		}
	}
	if (end === -1) return hasRoot ? "/" : ".";
	if (hasRoot && end === 1) return "//";
	return path.slice(0, end);
};

const basename = (path: string, suffix?: string): string => {
	let start = 0;
	let end = -1;
	let matchedSlash = true;
	if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
		if (suffix === path) return "";
		let extIdx = suffix.length - 1;
		let firstNonSlashEnd = -1;
		for (let i = path.length - 1; i >= 0; --i) {
			const code = path.charCodeAt(i);
			if (code === SLASH) {
				if (!matchedSlash) {
					start = i + 1;
					break;
				}
			} else {
				if (firstNonSlashEnd === -1) {
					matchedSlash = false;
					firstNonSlashEnd = i + 1;
				}
				if (extIdx >= 0) {
					if (code === suffix.charCodeAt(extIdx)) {
						if (--extIdx === -1) end = i;
					} else {
						extIdx = -1;
						end = firstNonSlashEnd;
					}
				}
			}
		}
		if (start === end) end = firstNonSlashEnd;
		else if (end === -1) end = path.length;
		return path.slice(start, end);
	}
	for (let i = path.length - 1; i >= 0; --i) {
		if (path.charCodeAt(i) === SLASH) {
			if (!matchedSlash) {
				start = i + 1;
				break;
			}
		} else if (end === -1) {
			matchedSlash = false;
			end = i + 1;
		}
	}
	return end === -1 ? "" : path.slice(start, end);
};

const extname = (path: string): string => {
	let startDot = -1;
	let startPart = 0;
	let end = -1;
	let matchedSlash = true;
	// The state of what precedes the first dot after the last separator.
	let preDotState = 0;
	for (let i = path.length - 1; i >= 0; --i) {
		const code = path.charCodeAt(i);
		if (code === SLASH) {
			if (!matchedSlash) {
				startPart = i + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			matchedSlash = false;
			end = i + 1;
		}
		if (code === DOT) {
			if (startDot === -1) startDot = i;
			else if (preDotState !== 1) preDotState = 1;
		} else if (startDot !== -1) {
			preDotState = -1;
		}
	}
	if (
		startDot === -1 ||
		end === -1 ||
		preDotState === 0 ||
		(preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
	) {
		return "";
	}
	return path.slice(startDot, end);
};

/**
 * POSIX path arithmetic as plain synchronous functions, for pure code that
 * cannot put `Path` in `R` — a link resolver, a graph builder, a config-time
 * hook. Every member is total over strings except `relative`, and none reads
 * the working directory.
 *
 * @remarks
 * Ported from the POSIX implementation behind core's `Path.layer`
 * (`packages/effect/src/Path.ts` in `effect`, itself adapted from Node.js
 * `lib/path.js`, MIT), so every answer is the one `Path.layer` — and
 * `node:path/posix` — gives. Two members are deliberately different:
 *
 * - There is no `resolve`. Resolving a relative path means reading
 *   `process.cwd()`, which is exactly what pure code must not do.
 * - `relative` never resolves against the working directory. Two absolute
 *   paths answer as core does. Two relative paths are read as relative to
 *   the same unnamed directory and answer whenever the answer does not depend
 *   on its name — always when both climb (`..`) equally, and when `to` is an
 *   ancestor of `from`. One absolute and one relative path, or a pair whose
 *   answer would spell a directory above the shared one, throw: there is no
 *   answer without a working directory, and inventing one is the silent wrong
 *   answer this module exists to avoid.
 *
 * The members are static methods that never read `this`, so they pass as
 * callbacks unbound (`paths.map((p) => PosixPath.basename(p))`; `basename`'s
 * second parameter is a suffix, not an index).
 *
 * For POSIX vs win32 chosen once at the edge, keep `Path` in `R`; this is the
 * POSIX answer always.
 *
 * @example
 * ```ts
 * import { PosixPath } from "@effected/walker";
 *
 * PosixPath.join("docs", "../okf", "./index.md"); // => "okf/index.md"
 * PosixPath.relative("okf/modules", "okf/decisions/x.md"); // => "../decisions/x.md"
 * PosixPath.dirname("/repo/okf/index.md"); // => "/repo/okf"
 * ```
 *
 * @public
 */
export class PosixPath {
	private constructor() {}

	/** The separator, `/`. */
	static readonly sep = "/";

	/**
	 * Join the non-empty `paths` with `/` and normalize; no non-empty path is
	 * `"."`. A leading `..` survives on a relative result.
	 */
	static join(...paths: ReadonlyArray<string>): string {
		return join(paths);
	}

	/**
	 * Collapse `.`, `..` and repeated separators. A relative path keeps its
	 * leading `..`; an absolute one clamps at the root. A trailing separator
	 * survives, and `""` is `"."`.
	 */
	static normalize(path: string): string {
		return normalize(path);
	}

	/** Whether `path` is absolute: it starts with `/`. */
	static isAbsolute(path: string): boolean {
		return isAbsolute(path);
	}

	/**
	 * The relative path from `from` to `to`, `""` when they name the same
	 * place, computed without the working directory.
	 *
	 * @remarks
	 * Two absolute paths answer exactly as core's `Path.relative` does. Two
	 * relative paths are taken as relative to the same unnamed directory:
	 * `relative("a/b", "a/c")` is `"../c"` and `relative("a/b", "..")` is
	 * `"../../.."`. It **throws** when only a working directory could answer:
	 * one absolute and one relative path, or a `from` that climbs above the
	 * shared directory further than `to` (`relative("../a", "b")` must name
	 * the directory `b` sits in), or a `to` that climbs further and then
	 * descends (`relative("a", "../b")` is `"../../b"` unless the working
	 * directory is itself named `b`).
	 */
	static relative(from: string, to: string): string {
		return relative(from, to);
	}

	/**
	 * The directory part of `path`: `"."` for a bare name, `"/"` for a
	 * root-level absolute path. Trailing separators are ignored.
	 */
	static dirname(path: string): string {
		return dirname(path);
	}

	/**
	 * The last segment of `path`, trailing separators ignored; `""` for `""`
	 * and `"/"`. With `suffix`, a matching ending is removed unless it is the
	 * whole segment.
	 */
	static basename(path: string, suffix?: string): string {
		return basename(path, suffix);
	}

	/**
	 * The extension of the last segment, from its last `.`: `".ts"` for
	 * `"a.b.ts"`, `""` for `".env"`, `"a"` or `".."`.
	 */
	static extname(path: string): string {
		return extname(path);
	}
}
