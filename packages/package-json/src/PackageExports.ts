// Subpath resolution over a manifest's `exports` and `imports`, the
// declaration-file view TypeScript takes of the same fields, and enumeration
// of every subpath a package exports.
//
// Pure and IO-free: every static here reads only the manifest object it is
// handed. The one filesystem step — expanding a pattern export against the
// files a package actually ships — is `PackageJsonFile.exportedFiles`, which
// is defined in terms of `PackageExports.entriesResult` and
// `PackageExports.resolveResult`.
//
// The algorithm lives in `internal/exports.ts` as a transcription of Node's
// resolver specification; this module validates input, applies the
// TypeScript rules on top, and turns the engine's raw failure into
// `PackageExportsError`.

import type { SemVer } from "@effected/semver";
import { Range } from "@effected/semver";
import { Effect, Option, Result, Schema } from "effect";
import type { ConditionMatcher, ExportsFailureReason, MatchedEntry } from "./internal/exports.js";
import {
	ExportsFailure,
	assertExportsShape,
	assertSubpath,
	confineLegacyPath,
	exportsResolve,
	finalizeFile,
	importsResolve,
	isRecord,
	isRootSugar,
	starCount,
	substituteFirstStar,
	targetResolve,
	toFilePath,
} from "./internal/exports.js";

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * The manifest fields subpath resolution reads.
 *
 * @remarks
 * Structural, like `EntryPointManifest`: a manifest parsed straight out of a
 * tarball or fetched from a registry or CDN resolves with nothing else
 * validated. Every field is `unknown` because the resolver is the validator —
 * a malformed `exports` is a typed failure, never a decode error first.
 *
 * @public
 */
export interface PackageExportsManifest {
	/** The `exports` field, in any of its legal shapes. */
	readonly exports?: unknown;
	/** The `imports` field: `#`-prefixed private subpaths. */
	readonly imports?: unknown;
	/** The `main` field; read only when `exports` is absent. */
	readonly main?: unknown;
	/** The `types` field; read by the TypeScript statics only when `exports` is absent. */
	readonly types?: unknown;
	/** The legacy spelling of `types`. */
	readonly typings?: unknown;
	/** The `typesVersions` field; read by the TypeScript statics only when `exports` is absent. */
	readonly typesVersions?: unknown;
}

/**
 * Options for {@link PackageExports.resolveResult},
 * {@link PackageExports.resolveImportResult} and
 * {@link PackageExports.entriesResult}.
 *
 * @public
 */
export interface PackageExportsOptions {
	/**
	 * The condition names the resolving environment matches. `default` always
	 * matches and need not be listed.
	 *
	 * @remarks
	 * This is a SET, not a priority list — unlike `resolveEntryPoint`'s
	 * `conditions`. Node walks a conditions object in the manifest's own key
	 * order and takes the first key the environment matches, so the package
	 * author's order decides between `import` and `require`, never the caller's.
	 *
	 * @defaultValue `["node", "import"]` — Node's own set for an ESM `import`
	 */
	readonly conditions?: ReadonlyArray<string>;
}

/**
 * Options for the TypeScript statics, {@link PackageExports.resolveTypesResult}
 * and {@link PackageExports.typesEntriesResult}.
 *
 * @public
 */
export interface PackageTypesOptions {
	/**
	 * The conditions matched alongside `types` and `default`, which always
	 * match.
	 *
	 * @defaultValue `["import"]` — TypeScript's `bundler` resolution of an ESM
	 *   import. Under `node16`/`nodenext` add `"node"`; for `require` pass
	 *   `["require"]`.
	 */
	readonly conditions?: ReadonlyArray<string>;
	/**
	 * The TypeScript version resolving, which selects a `typesVersions` entry
	 * and a versioned `types@<range>` condition.
	 *
	 * @remarks
	 * When omitted, no versioned `types@<range>` condition matches, and
	 * `typesVersions` contributes only an entry whose range is `*`.
	 */
	readonly typeScriptVersion?: SemVer;
}

/**
 * A package name and the subpath of it a specifier asks for.
 *
 * @public
 */
export interface PackageSpecifierParts {
	/** The package name: `pkg` or `@scope/pkg`. */
	readonly name: string;
	/** `"."` for the package itself, otherwise `"./"` followed by the rest of the specifier. */
	readonly subpath: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

const NODE_CODES: Record<ExportsFailureReason, string | undefined> = {
	invalidPackageConfiguration: "ERR_INVALID_PACKAGE_CONFIG",
	invalidPackageTarget: "ERR_INVALID_PACKAGE_TARGET",
	invalidModuleSpecifier: "ERR_INVALID_MODULE_SPECIFIER",
	packagePathNotExported: "ERR_PACKAGE_PATH_NOT_EXPORTED",
	packageImportNotDefined: "ERR_PACKAGE_IMPORT_NOT_DEFINED",
	limitExceeded: undefined,
};

/**
 * Raised when a subpath or import specifier does not resolve against a
 * manifest.
 *
 * @remarks
 * The reasons are Node's own error classes, so a caller can branch exactly
 * where Node would fail — {@link PackageExportsError.code} names the matching
 * `ERR_*` code:
 *
 * - `invalidPackageConfiguration` — an `exports` map mixing `"."` keys with
 *   condition keys, or a conditions object with an array-index key.
 * - `invalidPackageTarget` — a target that would leave the package: not
 *   starting with `./`, carrying a `..`, `.`, empty or `node_modules` segment
 *   (percent-encoded variants included), an encoded separator, or a URL.
 * - `invalidModuleSpecifier` — the REQUESTED subpath or specifier is
 *   malformed, a `*` pattern match would inject a forbidden segment (on its
 *   own or once substituted into the target), or an `imports` bare target is
 *   not a package name plus a confined subpath, as Node's PACKAGE_RESOLVE
 *   reports it.
 * - A resolved file target names no file once decoded as Node decodes it —
 *   an invalid UTF-8 escape or a `%` starting no escape (which Node rejects),
 *   a raw `?` or `#` (which Node would truncate as a query or fragment), or a
 *   decoded NUL: `invalidPackageTarget` for a target as written,
 *   `invalidModuleSpecifier` when the request's `*` match was substituted
 *   into it. Unlike an invalid target found during resolution, this does not
 *   fall back to the next entry of an array, as in Node.
 * - `packagePathNotExported` / `packageImportNotDefined` — nothing in the map
 *   answers the request.
 * - `limitExceeded` — a nesting depth or `*` count no real manifest reaches;
 *   this resolver's own guard, not a Node error.
 *
 * @public
 */
export class PackageExportsError extends Schema.TaggedError<PackageExportsError>()("PackageExportsError", {
	/** Which rule refused the request. */
	reason: Schema.Literals([
		"invalidPackageConfiguration",
		"invalidPackageTarget",
		"invalidModuleSpecifier",
		"packagePathNotExported",
		"packageImportNotDefined",
		"limitExceeded",
	]),
	/** The subpath or specifier that was requested. */
	request: Schema.String,
	/** The offending target string, when one string is to blame. */
	target: Schema.optionalKey(Schema.String),
}) {
	/** Node's error code for the same failure, or `undefined` for `limitExceeded`. */
	get code(): string | undefined {
		return NODE_CODES[this.reason];
	}

	override get message(): string {
		const target = this.target === undefined ? "" : ` (target ${JSON.stringify(this.target)})`;
		return this.reason === "invalidPackageConfiguration"
			? `The manifest's exports or imports configuration is invalid, resolving ${JSON.stringify(this.request)}`
			: this.reason === "invalidPackageTarget"
				? `${JSON.stringify(this.request)} resolves to a target outside the package${target}`
				: this.reason === "invalidModuleSpecifier"
					? `${JSON.stringify(this.request)} is not a valid subpath or import specifier${target}`
					: this.reason === "packagePathNotExported"
						? `${JSON.stringify(this.request)} is not exported by the package`
						: this.reason === "packageImportNotDefined"
							? `${JSON.stringify(this.request)} is not defined by the package's imports`
							: `Resolving ${JSON.stringify(this.request)} exceeded a nesting or pattern limit${target}`;
	}
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * A request resolved to a file of the package.
 *
 * @public
 */
export class PackageFileTarget extends Schema.Class<PackageFileTarget>("PackageFileTarget")({
	/** The discriminant: a package file. */
	kind: Schema.tag("file"),
	/** The subpath or `#` specifier that was resolved. */
	request: Schema.String,
	/**
	 * The package-relative file, always `./`-prefixed, `/`-separated and
	 * confined to the package — DECODED, as Node's resolution yields it.
	 *
	 * @remarks
	 * The path a filesystem call takes, not the target string as written:
	 * Node resolves a target as a URL and reads the file through
	 * `fileURLToPath`, so `"./dist/a%20b.js"` is the file `./dist/a b.js`,
	 * `%25` is a literal `%`, `+` stays `+`, and a UTF-8 escape is its
	 * character. Decoding happens once, after every validation.
	 */
	path: Schema.String,
	/** The `exports` or `imports` key that matched; absent when no map was read (`main`, a legacy subpath). */
	key: Schema.optionalKey(Schema.String),
	/** What the key's `*` matched, for a pattern key. */
	patternMatch: Schema.optionalKey(Schema.String),
}) {}

/**
 * An `imports` request resolved to another package's specifier, which the
 * caller resolves in turn.
 *
 * @public
 */
export class PackageSpecifierTarget extends Schema.Class<PackageSpecifierTarget>("PackageSpecifierTarget")({
	/** The discriminant: a bare specifier. */
	kind: Schema.tag("package"),
	/** The `#` specifier that was resolved. */
	request: Schema.String,
	/** The bare specifier the import maps to, e.g. `dep/feature`. */
	specifier: Schema.String,
	/** The `imports` key that matched. */
	key: Schema.String,
	/** What the key's `*` matched, for a pattern key. */
	patternMatch: Schema.optionalKey(Schema.String),
}) {}

/**
 * What an `imports` specifier resolves to: a file of the package, or another
 * package's specifier.
 *
 * @public
 */
export type PackageImportTarget = PackageFileTarget | PackageSpecifierTarget;

/**
 * One subpath a package exports, as {@link PackageExports.entriesResult}
 * enumerates it.
 *
 * @public
 */
export class ExportEntry extends Schema.Class<ExportEntry>("ExportEntry")({
	/** The exported subpath; for a pattern, still carrying its `*`. */
	subpath: Schema.String,
	/**
	 * The package-relative target, decoded as `PackageFileTarget.path`
	 * is; for a pattern, carrying a `*` wherever the match lands.
	 */
	path: Schema.String,
	/** The `exports` key the entry came from. */
	key: Schema.String,
	/** Whether `subpath` and `path` are templates rather than one concrete file. */
	pattern: Schema.Boolean,
}) {}

/**
 * Where TypeScript finds the declarations for one subpath.
 *
 * @remarks
 * `candidates` is the order TypeScript probes on disk, so the answer is a list
 * and not one path: a target `./index.js` is looked for as `./index.ts`,
 * `./index.tsx` and `./index.d.ts`. A resolver with a filesystem takes the
 * first candidate that exists; one without (a CDN-backed virtual project)
 * reads {@link TypesTarget.declaration}.
 *
 * @public
 */
export class TypesTarget extends Schema.Class<TypesTarget>("TypesTarget")({
	/** The subpath that was resolved. */
	subpath: Schema.String,
	/**
	 * The path the manifest named for it, before extension substitution.
	 *
	 * @remarks
	 * As WRITTEN, never percent-decoded, unlike `PackageFileTarget.path`:
	 * TypeScript reads an `exports`, `types` or `main` target as a literal
	 * file name, so `"./dist/a%20b.d.ts"` is the file `a%20b.d.ts` to it. The
	 * `candidates` are undecoded for the same reason.
	 */
	target: Schema.String,
	/** The files TypeScript probes, in order. */
	candidates: Schema.Array(Schema.String),
	/** Which field answered: `exports`, `typesVersions`, `types` (or `typings`), `main`, or `file` for a legacy subpath. */
	source: Schema.Literals(["exports", "typesVersions", "types", "main", "file"]),
	/** Whether this is a pattern template carrying `*`, from enumeration. */
	pattern: Schema.Boolean,
}) {
	/**
	 * The first candidate that is a declaration file (`.d.ts`, `.d.mts`,
	 * `.d.cts`), or none when every candidate is an implementation or other
	 * file.
	 */
	get declaration(): Option.Option<string> {
		return Option.fromNullishOr(this.candidates.find((candidate) => DECLARATION.test(candidate)));
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_CONDITIONS: ReadonlyArray<string> = ["node", "import"];
const DEFAULT_TYPES_CONDITIONS: ReadonlyArray<string> = ["import"];
const DECLARATION = /\.d\.[cm]?ts$/;
const TYPESCRIPT_SOURCE = /\.(?:[cm]?ts|tsx)$/;

const matcherOf = (conditions: ReadonlyArray<string>): ConditionMatcher => {
	const set = new Set(conditions);
	return (key) => set.has(key);
};

/** Does a `typesVersions` / `types@` selector admit the version? An unparseable selector admits nothing. */
const selectorMatches = (selector: string, version: SemVer | undefined): boolean => {
	if (version === undefined) return selector.trim() === "*";
	const range = Range.parseResult(selector);
	return Result.isSuccess(range) && range.success.test(version);
};

const typesMatcherOf = (options: PackageTypesOptions | undefined): ConditionMatcher => {
	const set = new Set(["types", ...(options?.conditions ?? DEFAULT_TYPES_CONDITIONS)]);
	const version = options?.typeScriptVersion;
	return (key) =>
		set.has(key) || (key.startsWith("types@") && version !== undefined && selectorMatches(key.slice(6), version));
};

/** TypeScript's extension substitution: the files probed for a target, in order. */
const declarationCandidates = (path: string): ReadonlyArray<string> => {
	if (DECLARATION.test(path) || TYPESCRIPT_SOURCE.test(path)) return [path];
	const swap = (from: string, to: ReadonlyArray<string>) => to.map((ext) => `${path.slice(0, -from.length)}${ext}`);
	if (path.endsWith(".mjs")) return swap(".mjs", [".mts", ".d.mts"]);
	if (path.endsWith(".cjs")) return swap(".cjs", [".cts", ".d.cts"]);
	if (path.endsWith(".jsx")) return swap(".jsx", [".tsx", ".d.ts"]);
	if (path.endsWith(".js")) return swap(".js", [".ts", ".tsx", ".d.ts"]);
	return [path];
};

/** A legacy file request: substitution for a known extension, else TypeScript's extension and index probing. */
const fileCandidates = (path: string): ReadonlyArray<string> => {
	if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return declarationCandidates(path);
	return [`${path}.ts`, `${path}.tsx`, `${path}.d.ts`, `${path}/index.ts`, `${path}/index.tsx`, `${path}/index.d.ts`];
};

/** The materialized error, carrying the request it was resolving. */
const toError = (failure: ExportsFailure, request: string): PackageExportsError =>
	new PackageExportsError({
		reason: failure.reason,
		request: failure.request ?? request,
		...(failure.target !== undefined && { target: failure.target }),
	});

/** Run the engine, materializing its one internal throw; anything else stays a defect. */
const attempt = <A>(request: string, run: () => A): Result.Result<A, PackageExportsError> => {
	try {
		return Result.succeed(run());
	} catch (error) {
		if (error instanceof ExportsFailure) return Result.fail(toError(error, request));
		throw error;
	}
};

const hasExports = (manifest: PackageExportsManifest): boolean =>
	manifest.exports !== undefined && manifest.exports !== null;

/**
 * A matched target as the file it names, decoded as Node decodes it — after
 * every validation, never before. A written target that names no file blames
 * the target; a substituted one blames the request whose match it carries.
 */
const fileTarget = (request: string, matched: MatchedEntry): PackageFileTarget =>
	PackageFileTarget.make({
		request,
		path: finalizeFile(
			matched.target.value,
			matched.patternMatch === null ? "invalidPackageTarget" : "invalidModuleSpecifier",
		),
		key: matched.key,
		...(matched.patternMatch !== null && { patternMatch: matched.patternMatch }),
	});

/** The legacy `main` (else `index.js`), confined but still as written: TypeScript reads it undecoded. */
const legacyMain = (manifest: PackageExportsManifest): string =>
	confineLegacyPath(typeof manifest.main === "string" && manifest.main !== "" ? manifest.main : "index.js");

/** The legacy (no `exports`) answer for a subpath: `main` for the root, the subpath itself otherwise, decoded. */
const legacyFile = (manifest: PackageExportsManifest, subpath: string): PackageFileTarget =>
	subpath === "."
		? PackageFileTarget.make({ request: subpath, path: finalizeFile(legacyMain(manifest), "invalidPackageTarget") })
		: PackageFileTarget.make({ request: subpath, path: finalizeFile(subpath, "invalidModuleSpecifier") });

/**
 * TypeScript's `matchPatternOrExact` over one `typesVersions` mapping: an exact
 * key first, then the single-`*` key with the longest prefix. Keys with more
 * than one `*` never match — the bound is applied by counting, before any
 * matching, and nothing is compiled to a regular expression.
 */
const typesVersionsMatch = (
	mapping: Record<string, unknown>,
	path: string,
): { readonly key: string; readonly star: string | null } | undefined => {
	if (Object.hasOwn(mapping, path) && !path.includes("*")) return { key: path, star: null };
	let best: { readonly key: string; readonly star: string } | undefined;
	let bestPrefix = -1;
	for (const key of Object.keys(mapping)) {
		if (starCount(key) !== 1) continue;
		const index = key.indexOf("*");
		const prefix = key.slice(0, index);
		const suffix = key.slice(index + 1);
		if (
			path.length >= prefix.length + suffix.length &&
			path.startsWith(prefix) &&
			path.endsWith(suffix) &&
			prefix.length > bestPrefix
		) {
			best = { key, star: path.slice(prefix.length, path.length - suffix.length) };
			bestPrefix = prefix.length;
		}
	}
	return best;
};

/** Apply `typesVersions` to a package-relative path (no leading `./`), or answer undefined when it does not apply. */
const applyTypesVersions = (
	typesVersions: unknown,
	path: string,
	version: SemVer | undefined,
): ReadonlyArray<string> | undefined => {
	if (!isRecord(typesVersions)) return undefined;
	const selector = Object.keys(typesVersions).find((key) => selectorMatches(key, version));
	if (selector === undefined) return undefined;
	const mapping = typesVersions[selector];
	if (!isRecord(mapping)) return undefined;
	const matched = typesVersionsMatch(mapping, path);
	if (matched === undefined) return undefined;
	const targets = mapping[matched.key];
	if (!Array.isArray(targets)) throw new ExportsFailure("invalidPackageConfiguration");
	return targets.map((target) => {
		if (typeof target !== "string") throw new ExportsFailure("invalidPackageConfiguration");
		// TypeScript substitutes the FIRST `*` only (its `typesVersions` path
		// mapping); the match is drawn from a subpath already held to the
		// segment rule, and the result is confined.
		return confineLegacyPath(matched.star === null ? target : substituteFirstStar(target, matched.star));
	});
};

const typesFromExports = (
	manifest: PackageExportsManifest,
	subpath: string,
	options: PackageTypesOptions | undefined,
): TypesTarget => {
	const matched = exportsResolve(manifest.exports, subpath, typesMatcherOf(options));
	return TypesTarget.make({
		subpath,
		target: matched.target.value,
		candidates: declarationCandidates(matched.target.value),
		source: "exports",
		pattern: false,
	});
};

const typesLegacy = (
	manifest: PackageExportsManifest,
	subpath: string,
	options: PackageTypesOptions | undefined,
): TypesTarget => {
	const version = options?.typeScriptVersion;
	const typesField =
		typeof manifest.types === "string" && manifest.types !== ""
			? manifest.types
			: typeof manifest.typings === "string" && manifest.typings !== ""
				? manifest.typings
				: undefined;
	// The path TypeScript hands to `typesVersions`: the subpath itself, or for
	// the root the `types` field (else `index.d.ts`).
	const requested =
		subpath === "." ? (typesField !== undefined ? confineLegacyPath(typesField) : "./index.d.ts") : subpath;
	const remapped = applyTypesVersions(manifest.typesVersions, requested.slice(2), version);
	if (remapped !== undefined && remapped.length > 0) {
		return TypesTarget.make({
			subpath,
			target: remapped[0] ?? "",
			candidates: remapped.flatMap(fileCandidates),
			source: "typesVersions",
			pattern: false,
		});
	}
	if (subpath !== ".") {
		return TypesTarget.make({
			subpath,
			target: subpath,
			candidates: fileCandidates(subpath),
			source: "file",
			pattern: false,
		});
	}
	if (typesField !== undefined) {
		return TypesTarget.make({
			subpath,
			target: requested,
			candidates: fileCandidates(requested),
			source: "types",
			pattern: false,
		});
	}
	const main = legacyMain(manifest);
	return TypesTarget.make({ subpath, target: main, candidates: fileCandidates(main), source: "main", pattern: false });
};

/** The (subpath key, target) pairs an `exports` value declares, in manifest order. */
const exportKeys = (exports: unknown): ReadonlyArray<readonly [string, unknown]> => {
	assertExportsShape(exports);
	if (isRootSugar(exports)) return [[".", exports]];
	return isRecord(exports) ? Object.entries(exports) : [];
};

const enumerate = <A>(
	manifest: PackageExportsManifest,
	matches: ConditionMatcher,
	make: (subpath: string, path: string, key: string, pattern: boolean) => A,
	legacy: () => ReadonlyArray<A>,
): ReadonlyArray<A> => {
	if (!hasExports(manifest)) return legacy();
	const entries: Array<A> = [];
	for (const [key, target] of exportKeys(manifest.exports)) {
		const stars = starCount(key);
		// A trailing-"/" key (the removed folder mapping) and a multi-"*" key can
		// never match a request, so neither exports anything.
		if (key.endsWith("/") || stars > 1) continue;
		const pattern = stars === 1;
		let resolved: ReturnType<typeof targetResolve>;
		try {
			// A pattern resolves with "*" as its own match, which passes the
			// segment rule and leaves the template's stars where the match lands.
			resolved = targetResolve(target, pattern ? "*" : null, false, matches);
		} catch (error) {
			if (error instanceof ExportsFailure) throw new ExportsFailure(error.reason, error.target, key);
			throw error;
		}
		// `null` excludes the subpath; `undefined` means no condition matched.
		if (resolved == null) continue;
		entries.push(make(key, resolved.value, key, pattern));
	}
	return entries;
};

/**
 * An enumerated runtime target as the file (or, for a pattern, the template of
 * files) it names, decoded as {@link PackageExports.resolveResult} decodes
 * one. A target naming no file fails the enumeration, naming the key.
 */
const entryPath = (path: string, pattern: boolean, key: string): string => {
	const decoded = toFilePath(path, pattern);
	if (decoded === undefined) throw new ExportsFailure("invalidPackageTarget", path, key);
	return decoded;
};

// ── The facade ───────────────────────────────────────────────────────────────

/**
 * Subpath resolution over a manifest's `exports` and `imports`, the view
 * TypeScript takes of the same fields, and enumeration of what a package
 * exports — Node's resolver algorithm, pure over the manifest.
 *
 * @remarks
 * Every static is a sync `*Result` primitive with an `Effect` twin defined in
 * terms of it behind a named span. Each implements a named step of Node's
 * "Resolution Algorithm Specification":
 *
 * - {@link PackageExports.resolveResult} — PACKAGE_EXPORTS_RESOLVE, with
 *   PACKAGE_IMPORTS_EXPORTS_RESOLVE, PATTERN_KEY_COMPARE and
 *   PACKAGE_TARGET_RESOLVE beneath it; the legacy `main` / bare-subpath
 *   reading when `exports` is absent.
 * - {@link PackageExports.resolveImportResult} — PACKAGE_IMPORTS_RESOLVE.
 * - {@link PackageExports.resolveTypesResult} — TypeScript's reading: the
 *   `types` and `types@<range>` conditions, extension substitution, and
 *   `typesVersions` when `exports` is absent.
 * - {@link PackageExports.entriesResult} / {@link PackageExports.typesEntriesResult}
 *   — every subpath the map declares, resolved under the same rules.
 *
 * **A resolved path never leaves the package.** A target must start with `./`
 * and carry no `..`, `.`, empty or `node_modules` segment after the first,
 * case-insensitively and percent-decoded; a `*` pattern match is held to the
 * same rule, so `"./*": "./dist/*.js"` resolves `./a` but refuses
 * `./%2e%2e/secret`. Every check runs under every percent-decoding of the
 * string, not just one, and the SUBSTITUTED target is checked again whole, so
 * a match completing an escape the template began (`"./%2*"` with `e%2e`)
 * is refused too. Five checks here are stricter than Node, each because a
 * pure resolver hands back a string its caller will decode or follow: an
 * encoded `/` or `\` is refused outright; an `imports` bare target must be a
 * package name plus a subpath with no forbidden segment, and a `*` match
 * substituted into one is checked too; `main`, `types` and `typesVersions`
 * targets, which Node does not confine, are confined; and a request ending in
 * `/` is refused, where Node's `exports` resolution still answers one through
 * a pattern under the DEP0155 deprecation warning. A `..` in `main`, `types`
 * or `typesVersions` that stays inside the package is resolved as Node
 * resolves it (`./lib/../index.js` is `./index.js`); one that climbs out, or
 * that shares the path with a `\`, a tab or newline, or a percent-encoded dot
 * segment, is refused.
 *
 * **A resolved path is the decoded file.** Once a target has passed every
 * check above, it is decoded the way Node's resolution decodes it — parsed as
 * a URL against the package and read through `fileURLToPath`'s POSIX
 * percent-decoding — so `PackageFileTarget.path` and
 * `ExportEntry.path` are the paths a filesystem call takes:
 * `./dist/a b.js` for a target written `./dist/a%20b.js`. Decoding a target
 * whose escapes Node would reject fails closed. The TypeScript statics are
 * the exception: TypeScript reads targets undecoded, so a
 * {@link TypesTarget} keeps the written form.
 *
 * **The manifest's key order decides between conditions.** A conditions
 * object is walked in insertion order and the first key the environment
 * matches wins, so a `types` key written AFTER `default` is never reached —
 * that is TypeScript's rule too, and why the `types` condition must come
 * first. Membership checks use own keys only, so a request for
 * `"./constructor"` or a `"__proto__"` key in the manifest reads nothing off
 * `Object.prototype`.
 *
 * @public
 */
export class PackageExports {
	private constructor() {}

	/**
	 * Split a bare specifier into its package name and subpath, or none when
	 * it is not a valid bare specifier.
	 *
	 * @remarks
	 * Node's PACKAGE_RESOLVE parsing: a scoped name is the first two segments,
	 * any other name the first. That is the path-boundary rule —
	 * `"pkg2/x"` names package `pkg2`, never `pkg` plus `2/x` — and a name
	 * starting with `.` or containing `\` or `%` is no package name at all.
	 *
	 * @example
	 * ```ts
	 * import { PackageExports } from "@effected/package-json";
	 * import { Option } from "effect";
	 *
	 * console.log(Option.getOrNull(PackageExports.splitSpecifier("@effect/platform/Http")));
	 * // => { name: "@effect/platform", subpath: "./Http" }
	 * ```
	 */
	static splitSpecifier(specifier: string): Option.Option<PackageSpecifierParts> {
		if (specifier === "") return Option.none();
		const first = specifier.indexOf("/");
		let end: number;
		if (specifier.startsWith("@")) {
			if (first === -1) return Option.none();
			const second = specifier.indexOf("/", first + 1);
			end = second === -1 ? specifier.length : second;
		} else {
			end = first === -1 ? specifier.length : first;
		}
		const name = specifier.slice(0, end);
		if (name.startsWith(".") || name.includes("\\") || name.includes("%") || name.endsWith("/")) return Option.none();
		return Option.some({ name, subpath: `.${specifier.slice(end)}` });
	}

	/**
	 * Resolve a subpath of a package to the file that serves it.
	 *
	 * @remarks
	 * `subpath` is `"."` or starts with `"./"` (see
	 * {@link PackageExports.splitSpecifier} to get one from a specifier).
	 * When `exports` is present it encapsulates the package: a subpath it does
	 * not export is `packagePathNotExported`, and `main` is never consulted.
	 * When `exports` is absent the legacy reading applies — `"."` is `main`
	 * (else `index.js`), any other subpath is itself — with no extension or
	 * directory probing, which needs a filesystem.
	 *
	 * The answer's `path` is decoded as Node decodes the resolved URL: a
	 * request `"./a%20b"` against `"./*": "./dist/*.js"` is the file
	 * `./dist/a b.js`.
	 *
	 * Patterns, `null` exclusions and fallback arrays all follow the
	 * specification: the most specific pattern key decides
	 * (`"./internal/*": null` beats `"./*"`), and an array tries each entry,
	 * skipping invalid targets.
	 *
	 * @example
	 * ```ts
	 * import { PackageExports } from "@effected/package-json";
	 * import { Result } from "effect";
	 *
	 * const manifest = { exports: { ".": "./index.js", "./*": { types: "./types/*.d.ts", import: "./dist/*.js" } } };
	 * const resolved = PackageExports.resolveResult(manifest, "./Http");
	 * console.log(Result.isSuccess(resolved) && resolved.success.path);
	 * // => ./dist/Http.js
	 * ```
	 */
	static resolveResult(
		manifest: PackageExportsManifest,
		subpath: string,
		options?: PackageExportsOptions,
	): Result.Result<PackageFileTarget, PackageExportsError> {
		return attempt(subpath, () => {
			assertSubpath(subpath);
			if (!hasExports(manifest)) return legacyFile(manifest, subpath);
			return fileTarget(
				subpath,
				exportsResolve(manifest.exports, subpath, matcherOf(options?.conditions ?? DEFAULT_CONDITIONS)),
			);
		});
	}

	/** The `Effect` form of {@link PackageExports.resolveResult}, behind a named span. */
	static readonly resolve = Effect.fn("PackageExports.resolve")(
		(manifest: PackageExportsManifest, subpath: string, options?: PackageExportsOptions) =>
			Effect.fromResult(PackageExports.resolveResult(manifest, subpath, options)),
	);

	/**
	 * Resolve a `#` import specifier through the manifest's `imports`.
	 *
	 * @remarks
	 * PACKAGE_IMPORTS_RESOLVE. Unlike `exports`, an `imports` target may name
	 * another package (`"#dep": "dep/feature"`), answered as a
	 * {@link PackageSpecifierTarget} for the caller to resolve in turn; a
	 * relative `../` target, an absolute path or a URL is still refused. The
	 * specifier must be a package name (npm's characters, no leading `.` or
	 * `_`, no backslash or `%`) and an optional subpath with no `.`, `..`,
	 * empty or `node_modules` segment, so `".."`, `"..\\evil"` and a UNC
	 * path are refused as Node refuses them, and `"dep/../x"` is refused where
	 * Node would hand it to `dep`'s own resolution. Only
	 * `"#"` itself is an invalid specifier — `"#/x"` is a legal key.
	 */
	static resolveImportResult(
		manifest: PackageExportsManifest,
		specifier: string,
		options?: PackageExportsOptions,
	): Result.Result<PackageImportTarget, PackageExportsError> {
		return attempt(specifier, (): PackageImportTarget => {
			const matched = importsResolve(manifest.imports, specifier, matcherOf(options?.conditions ?? DEFAULT_CONDITIONS));
			if (matched.target.kind === "file") return fileTarget(specifier, matched);
			return PackageSpecifierTarget.make({
				request: specifier,
				specifier: matched.target.value,
				key: matched.key,
				...(matched.patternMatch !== null && { patternMatch: matched.patternMatch }),
			});
		});
	}

	/** The `Effect` form of {@link PackageExports.resolveImportResult}, behind a named span. */
	static readonly resolveImport = Effect.fn("PackageExports.resolveImport")(
		(manifest: PackageExportsManifest, specifier: string, options?: PackageExportsOptions) =>
			Effect.fromResult(PackageExports.resolveImportResult(manifest, specifier, options)),
	);

	/**
	 * Resolve where TypeScript finds the declarations for a subpath.
	 *
	 * @remarks
	 * With `exports` present, it is resolved as Node would, matching `types`,
	 * `default`, `options.conditions` and any `types@<range>` admitting
	 * `options.typeScriptVersion` — in the MANIFEST's key order, so `types`
	 * wins over `import` and `default` only when it is written before them, as
	 * TypeScript requires. `typesVersions` is not read then, again as
	 * TypeScript does. The resolved target goes through extension
	 * substitution (`./x.js` probes `./x.ts`, `./x.tsx`, `./x.d.ts`).
	 *
	 * With `exports` absent, `typesVersions` is applied first: the first entry
	 * whose range admits `options.typeScriptVersion` (only `*` without one),
	 * then within it an exact key before the longest-prefix single-`*`
	 * pattern. Then `types` / `typings`, then `main`, for the root; a legacy
	 * subpath probes itself with extensions and as a directory.
	 *
	 * @example
	 * ```ts
	 * import { PackageExports } from "@effected/package-json";
	 * import { Option, Result } from "effect";
	 *
	 * const resolved = PackageExports.resolveTypesResult(
	 *   { exports: { ".": { types: "./index.d.ts", import: "./index.js" } } },
	 *   ".",
	 * );
	 * console.log(Result.isSuccess(resolved) && Option.getOrNull(resolved.success.declaration));
	 * // => ./index.d.ts
	 * ```
	 */
	static resolveTypesResult(
		manifest: PackageExportsManifest,
		subpath: string,
		options?: PackageTypesOptions,
	): Result.Result<TypesTarget, PackageExportsError> {
		return attempt(subpath, () => {
			assertSubpath(subpath);
			return hasExports(manifest)
				? typesFromExports(manifest, subpath, options)
				: typesLegacy(manifest, subpath, options);
		});
	}

	/** The `Effect` form of {@link PackageExports.resolveTypesResult}, behind a named span. */
	static readonly resolveTypes = Effect.fn("PackageExports.resolveTypes")(
		(manifest: PackageExportsManifest, subpath: string, options?: PackageTypesOptions) =>
			Effect.fromResult(PackageExports.resolveTypesResult(manifest, subpath, options)),
	);

	/**
	 * Every subpath the manifest's `exports` declares, resolved under
	 * `options.conditions`, in manifest order.
	 *
	 * @remarks
	 * A pattern key is enumerated as ONE template entry (`pattern: true`),
	 * because which files it reaches is a question about the package on disk —
	 * `PackageJsonFile.exportedFiles` answers it. An entry whose target is
	 * `null`, or matches none of the conditions, exports nothing and is left
	 * out; a trailing-`/` or multi-`*` key can never match a request and is
	 * left out too. An invalid target fails the whole enumeration, naming the
	 * key. With `exports` absent, only `"."` is enumerated: a package without
	 * `exports` exposes every file, which no manifest can list.
	 */
	static entriesResult(
		manifest: PackageExportsManifest,
		options?: PackageExportsOptions,
	): Result.Result<ReadonlyArray<ExportEntry>, PackageExportsError> {
		return attempt(".", () =>
			enumerate(
				manifest,
				matcherOf(options?.conditions ?? DEFAULT_CONDITIONS),
				(subpath, path, key, pattern) =>
					ExportEntry.make({ subpath, path: entryPath(path, pattern, key), key, pattern }),
				() => [ExportEntry.make({ subpath: ".", path: legacyFile(manifest, ".").path, key: ".", pattern: false })],
			),
		);
	}

	/** The `Effect` form of {@link PackageExports.entriesResult}, behind a named span. */
	static readonly entries = Effect.fn("PackageExports.entries")(
		(manifest: PackageExportsManifest, options?: PackageExportsOptions) =>
			Effect.fromResult(PackageExports.entriesResult(manifest, options)),
	);

	/**
	 * Every subpath that exposes declarations, as TypeScript resolves them —
	 * the input for building a virtual TypeScript project from a manifest.
	 *
	 * @remarks
	 * The same enumeration as {@link PackageExports.entriesResult} under the
	 * TypeScript conditions of {@link PackageExports.resolveTypesResult}, each
	 * entry carrying its extension-substituted candidates. A pattern entry's
	 * subpath, target and candidates keep their `*`. With `exports` absent,
	 * only `"."` is enumerated, through `typesVersions`, `types` and `main`.
	 */
	static typesEntriesResult(
		manifest: PackageExportsManifest,
		options?: PackageTypesOptions,
	): Result.Result<ReadonlyArray<TypesTarget>, PackageExportsError> {
		return attempt(".", () =>
			enumerate(
				manifest,
				typesMatcherOf(options),
				(subpath, path, _key, pattern) =>
					TypesTarget.make({
						subpath,
						target: path,
						candidates: declarationCandidates(path),
						source: "exports",
						pattern,
					}),
				() => [typesLegacy(manifest, ".", options)],
			),
		);
	}

	/** The `Effect` form of {@link PackageExports.typesEntriesResult}, behind a named span. */
	static readonly typesEntries = Effect.fn("PackageExports.typesEntries")(
		(manifest: PackageExportsManifest, options?: PackageTypesOptions) =>
			Effect.fromResult(PackageExports.typesEntriesResult(manifest, options)),
	);
}
