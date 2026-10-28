// The `exports` / `imports` resolution engine: Node's resolver algorithm
// specification (the "Resolution Algorithm Specification" section of the
// Node.js ECMAScript modules documentation), transcribed function by function.
//
// The engine is pure and total over its input except for one controlled
// throw: `ExportsFailure`, the internal carrier the facade (`PackageExports`)
// catches and materializes into the public `PackageExportsError`. Node's own
// algorithm is written in terms of thrown errors — the array fallback rule
// ("continuing the loop on any Invalid Package Target error") is a catch — so
// the carrier keeps the transcription faithful instead of threading a result
// through every step.
//
// Where this engine is STRICTER than Node, it says so at the site. Each case
// closes a way for a manifest-controlled string to name a file outside the
// package, which Node closes later (at URL finalization) and a pure resolver
// returning a path string never reaches.

/** @internal */
export type ExportsFailureReason =
	| "invalidPackageConfiguration"
	| "invalidPackageTarget"
	| "invalidModuleSpecifier"
	| "packagePathNotExported"
	| "packageImportNotDefined"
	| "limitExceeded";

/**
 * The engine's raw failure carrier. Never escapes the package: the facade
 * catches it and builds the typed error.
 *
 * @internal
 */
export class ExportsFailure extends Error {
	constructor(
		readonly reason: ExportsFailureReason,
		readonly target?: string,
		readonly request?: string,
	) {
		super(reason);
	}
}

/** A resolved target: a package-relative file, or (from `imports`) a bare specifier. @internal */
export interface RawTarget {
	readonly kind: "file" | "package";
	readonly value: string;
}

/** Which condition keys a target object honours. `default` always matches. @internal */
export type ConditionMatcher = (key: string) => boolean;

/**
 * How deep conditions and fallback arrays may nest. Real manifests nest two or
 * three levels; the cap only exists so a hostile document cannot overflow the
 * stack through `targetResolve`'s recursion.
 *
 * @internal
 */
export const MAX_TARGET_DEPTH = 32;

/**
 * How many `*` a pattern target may carry. Every `*` is replaced by the whole
 * pattern match, so the output grows as stars × match length; real targets
 * carry one or two.
 *
 * @internal
 */
export const MAX_TARGET_STARS = 16;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** ECMA-262 §6.1.7 array index: a canonical numeric string below 2^32 − 1. */
const isArrayIndex = (key: string): boolean => /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295;

/** Node's "is a valid URL" test for a target string: anything with a scheme. */
const hasScheme = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value);

/** `%2f` / `%5c`: an encoded separator, which would hide a segment boundary from the segment checks. */
const hasEncodedSeparator = (value: string): boolean => /%2f|%5c/i.test(value);

/** A segment percent-decoded and lower-cased, so `%2E%2e` and `NODE_MODULES` compare as what they spell. */
const normalizeSegment = (segment: string): string => {
	try {
		return decodeURIComponent(segment).toLowerCase();
	} catch {
		// A malformed escape decodes to nothing in particular; compare it raw.
		return segment.toLowerCase();
	}
};

/** Node's forbidden segment set: `""`, `.`, `..`, `node_modules`, case-insensitive and percent-decoded. */
const isForbiddenSegment = (segment: string): boolean => {
	const normalized = normalizeSegment(segment);
	return normalized === "" || normalized === "." || normalized === ".." || normalized === "node_modules";
};

/** Every segment of `value` split on `/` or `\`, from `from` on, passes the forbidden-segment check. */
const segmentsAreSafe = (value: string, from: number): boolean => {
	const segments = value.split(/[/\\]/);
	for (let index = from; index < segments.length; index++) {
		if (isForbiddenSegment(segments[index] ?? "")) return false;
	}
	return true;
};

const countStars = (value: string): number => value.split("*").length - 1;

/**
 * PACKAGE_TARGET_RESOLVE(packageURL, target, patternMatch, isImports, conditions).
 *
 * Returns the resolved target, `null` (an explicit exclusion), or `undefined`
 * (no condition matched). Throws `ExportsFailure` exactly where the
 * specification throws.
 *
 * @internal
 */
export const targetResolve = (
	target: unknown,
	patternMatch: string | null,
	isImports: boolean,
	matches: ConditionMatcher,
	depth = 0,
): RawTarget | null | undefined => {
	if (depth > MAX_TARGET_DEPTH) throw new ExportsFailure("limitExceeded");

	// 1. If target is a String
	if (typeof target === "string") {
		if (patternMatch !== null && countStars(target) > MAX_TARGET_STARS) {
			throw new ExportsFailure("limitExceeded", target);
		}
		// 1.1 If target does not start with "./"
		if (!target.startsWith("./")) {
			// 1.1.1 Only `imports` may name something other than a package file,
			// and never a relative escape, an absolute path or a URL.
			if (!isImports || target.startsWith("../") || target.startsWith("/") || hasScheme(target)) {
				throw new ExportsFailure("invalidPackageTarget", target);
			}
			if (patternMatch === null) return { kind: "package", value: target };
			// STRICTER than Node: a bare-specifier pattern match is held to the
			// same segment rule as a file one, so a `*` cannot carry `../` into
			// the specifier handed on to the next package's resolution.
			if (!segmentsAreSafe(patternMatch, 0) || hasEncodedSeparator(patternMatch)) {
				throw new ExportsFailure("invalidModuleSpecifier", target);
			}
			return { kind: "package", value: target.replaceAll("*", patternMatch) };
		}
		// 1.2 No "", ".", "..", or "node_modules" segment after the first "."
		// segment. STRICTER than Node: an encoded separator is rejected here
		// rather than at URL finalization, because the caller of a pure resolver
		// is the one who would decode it.
		if (!segmentsAreSafe(target, 1) || hasEncodedSeparator(target)) {
			throw new ExportsFailure("invalidPackageTarget", target);
		}
		// 1.5 No pattern: the target is the answer.
		if (patternMatch === null) return { kind: "file", value: target };
		// 1.6 The pattern match may not smuggle a forbidden segment in either.
		if (!segmentsAreSafe(patternMatch, 0) || hasEncodedSeparator(patternMatch)) {
			throw new ExportsFailure("invalidModuleSpecifier", target);
		}
		// 1.7 Every "*" is replaced, not just the first.
		return { kind: "file", value: target.replaceAll("*", patternMatch) };
	}

	// 2. If target is a non-null Object
	if (isPlainObject(target)) {
		const keys = Object.keys(target);
		// 2.1 Index keys make the object an array in disguise.
		if (keys.some(isArrayIndex)) throw new ExportsFailure("invalidPackageConfiguration");
		// 2.2 Object insertion order — the MANIFEST's order is the priority.
		for (const key of keys) {
			if (key === "default" || matches(key)) {
				const resolved = targetResolve(target[key], patternMatch, isImports, matches, depth + 1);
				if (resolved === undefined) continue;
				return resolved;
			}
		}
		return undefined;
	}

	// 3. If target is an Array — fallbacks.
	if (Array.isArray(target)) {
		if (target.length === 0) return null;
		// Node's implementation (`resolvePackageTarget` in lib/internal/modules/esm/
		// resolve.js) records a `null` and continues, where the specification's
		// prose reads as returning it; the implementation is what runs.
		let last: ExportsFailure | null | undefined;
		for (const item of target) {
			let resolved: RawTarget | null | undefined;
			try {
				resolved = targetResolve(item, patternMatch, isImports, matches, depth + 1);
			} catch (error) {
				if (error instanceof ExportsFailure && error.reason === "invalidPackageTarget") {
					last = error;
					continue;
				}
				throw error;
			}
			if (resolved === undefined) continue;
			if (resolved === null) {
				last = null;
				continue;
			}
			return resolved;
		}
		if (last === undefined || last === null) return last;
		throw last;
	}

	// 4. If target is null — an explicit exclusion.
	if (target === null) return null;

	// 5. Anything else.
	throw new ExportsFailure("invalidPackageTarget");
};

/**
 * PATTERN_KEY_COMPARE(keyA, keyB): descending specificity — the longer base
 * first, then the longer key.
 *
 * @internal
 */
export const patternKeyCompare = (keyA: string, keyB: string): number => {
	const baseLengthA = keyA.indexOf("*");
	const baseLengthB = keyB.indexOf("*");
	if (baseLengthA > baseLengthB) return -1;
	if (baseLengthB > baseLengthA) return 1;
	if (keyA.length > keyB.length) return -1;
	if (keyB.length > keyA.length) return 1;
	return 0;
};

/** One matched entry of an `exports` or `imports` map. @internal */
export interface MatchedEntry {
	readonly key: string;
	readonly patternMatch: string | null;
	readonly target: RawTarget;
}

/**
 * PACKAGE_IMPORTS_EXPORTS_RESOLVE(matchKey, matchObj, packageURL, isImports, conditions).
 *
 * Linear in the number of keys plus a sort: patterns are matched by prefix and
 * suffix, never compiled to a regular expression, so a manifest carrying
 * thousands of `*` keys costs a sort and a scan, not a backtracking match.
 *
 * @internal
 */
export const importsExportsResolve = (
	matchKey: string,
	matchObj: Record<string, unknown>,
	isImports: boolean,
	matches: ConditionMatcher,
): MatchedEntry | null => {
	// 1. A trailing "/" is a directory request, which no map can answer.
	if (matchKey.endsWith("/")) throw new ExportsFailure("invalidModuleSpecifier");
	// 2. An exact key without "*". Own keys only: `"constructor"` is not a key
	// of a manifest that does not write one.
	if (Object.hasOwn(matchObj, matchKey) && !matchKey.includes("*")) {
		const target = targetResolve(matchObj[matchKey], null, isImports, matches);
		return target == null ? null : { key: matchKey, patternMatch: null, target };
	}
	// 3. The single-"*" keys, most specific first.
	const expansionKeys = Object.keys(matchObj)
		.filter((key) => countStars(key) === 1)
		.sort(patternKeyCompare);
	// 4.
	for (const expansionKey of expansionKeys) {
		const star = expansionKey.indexOf("*");
		const patternBase = expansionKey.slice(0, star);
		if (matchKey.startsWith(patternBase) && matchKey !== patternBase) {
			const patternTrailer = expansionKey.slice(star + 1);
			if (
				patternTrailer.length === 0 ||
				(matchKey.endsWith(patternTrailer) && matchKey.length >= expansionKey.length)
			) {
				const patternMatch = matchKey.slice(patternBase.length, matchKey.length - patternTrailer.length);
				const target = targetResolve(matchObj[expansionKey], patternMatch, isImports, matches);
				// The specification RETURNS here: the most specific matching key
				// decides, and a `null` there excludes the subpath outright.
				return target == null ? null : { key: expansionKey, patternMatch, target };
			}
		}
	}
	// 5.
	return null;
};

/**
 * The PACKAGE_EXPORTS_RESOLVE step 1 check: a map mixing `"."` keys and
 * condition keys is an invalid configuration.
 *
 * @internal
 */
export const assertExportsShape = (exports: unknown): void => {
	if (!isPlainObject(exports)) return;
	const keys = Object.keys(exports);
	if (keys.some((key) => key.startsWith(".")) && keys.some((key) => !key.startsWith("."))) {
		throw new ExportsFailure("invalidPackageConfiguration");
	}
};

/** Whether an `exports` value is root sugar (string, array, or conditions object) for `{ ".": … }`. @internal */
export const isRootSugar = (exports: unknown): boolean =>
	typeof exports === "string" ||
	Array.isArray(exports) ||
	(isPlainObject(exports) && !Object.keys(exports).some((key) => key.startsWith(".")));

/**
 * PACKAGE_EXPORTS_RESOLVE(packageURL, subpath, exports, conditions).
 *
 * `subpath` is `"."` or starts with `"./"`; the facade validates it first.
 *
 * @internal
 */
export const exportsResolve = (exports: unknown, subpath: string, matches: ConditionMatcher): MatchedEntry => {
	// 1.
	assertExportsShape(exports);
	// 2.
	if (subpath === ".") {
		let mainExport: unknown;
		if (isRootSugar(exports)) mainExport = exports;
		else if (isPlainObject(exports) && Object.hasOwn(exports, ".")) mainExport = exports["."];
		if (mainExport !== undefined) {
			const target = targetResolve(mainExport, null, false, matches);
			if (target != null) return { key: ".", patternMatch: null, target };
		}
	} else if (isPlainObject(exports) && Object.keys(exports).every((key) => key.startsWith("."))) {
		// 3.
		const matched = importsExportsResolve(subpath, exports, false, matches);
		if (matched !== null) return matched;
	}
	// 4.
	throw new ExportsFailure("packagePathNotExported");
};

/**
 * PACKAGE_IMPORTS_RESOLVE(specifier, parentURL, conditions), from step 2 on —
 * the package scope is the manifest the caller handed in.
 *
 * @internal
 */
export const importsResolve = (imports: unknown, specifier: string, matches: ConditionMatcher): MatchedEntry => {
	// 1–2. Only "#" itself is refused; "#/x" is a legal key.
	if (!specifier.startsWith("#") || specifier === "#") throw new ExportsFailure("invalidModuleSpecifier");
	// 4.
	if (isPlainObject(imports)) {
		const matched = importsExportsResolve(specifier, imports, true, matches);
		if (matched !== null) return matched;
	}
	// 5.
	throw new ExportsFailure("packageImportNotDefined");
};

/**
 * A package-relative path from a field Node reads without `exports` (`main`,
 * `types`, a legacy subpath), confined to the package.
 *
 * @remarks
 * Node itself does not confine `main` — `"main": "../x.js"` loads a file
 * outside the package. This resolver answers "a file of this package", so a
 * path that leaves the package, is absolute or is a URL is refused rather than
 * answered. A leading `./` is optional in these fields and normalized on.
 *
 * @internal
 */
export const confineLegacyPath = (value: string): string => {
	const bare = value.startsWith("./") ? value.slice(2) : value;
	if (bare === "" || bare.startsWith("/") || bare.startsWith("\\") || hasScheme(bare) || hasEncodedSeparator(bare)) {
		throw new ExportsFailure("invalidPackageTarget", value);
	}
	for (const segment of bare.split(/[/\\]/)) {
		const normalized = normalizeSegment(segment);
		if (normalized === ".." || normalized === "node_modules") throw new ExportsFailure("invalidPackageTarget", value);
	}
	return `./${bare}`;
};

/** A subpath a caller asked for, held to the segment rule. @internal */
export const assertSubpath = (subpath: string): void => {
	if (subpath === ".") return;
	if (!subpath.startsWith("./") || !segmentsAreSafe(subpath, 1) || hasEncodedSeparator(subpath)) {
		throw new ExportsFailure("invalidModuleSpecifier");
	}
};

/** The number of `*` in a key: the pattern facade needs it to skip unmatchable keys. @internal */
export const starCount = countStars;

/** Re-exported for the facade's typesVersions and enumeration paths. @internal */
export const isRecord = isPlainObject;
