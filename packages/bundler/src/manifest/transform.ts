// packages/bundler/src/manifest/transform.ts
import { PackageJsonFormat } from "@effected/package-json";
import { ambientOutName, classifyDtsExport, mixedDtsExportError } from "../entries/ambient-dts.js";
import { createEntryName } from "../entries/extract.js";
import { ConfigValidationError } from "../errors.js";

/** @public */
export type Json = Record<string, unknown>;

/**
 * Which exports get a CJS `require` condition. `true`/`false` apply uniformly to every
 * TS export; a Set marks ONLY the listed export keys (e.g. "./changesets/markdownlint")
 * as dual — used by per-entry format overrides.
 * @public
 */
export type DualExports = boolean | ReadonlySet<string>;

const isDualKey = (dual: DualExports, exportKey: string): boolean =>
	typeof dual === "boolean" ? dual : dual.has(exportKey);

/**
 * Package.json fields that are never wanted in a published manifest: they describe
 * how the package is BUILT/DEVELOPED, not how it is CONSUMED. The bundler reads
 * everything it needs from the source manifest before transforms run (entry
 * detection, `publishConfig.targets` for the byte-variant groups, catalog
 * resolution), so dropping these from the emitted manifest is always safe.
 */
const NON_PUBLISHED_FIELDS = [
	"devDependencies",
	"bundleDependencies",
	"scripts",
	"publishConfig",
	"packageManager",
	"devEngines",
] as const;

/**
 * The default `transform` applied to every package's manifest when its
 * build config does not provide one of its own. Strips the build/dev-only
 * fields in `NON_PUBLISHED_FIELDS` from the emitted package.json.
 *
 * This is the pattern nearly every package repeated by hand (inherited from
 * rslib-builder); `defineBuild` now applies it automatically so a package needs a
 * `transform` only when it has genuinely custom manifest work to do (e.g. silk
 * promoting workspace deps to peerDependencies). A custom transform REPLACES this
 * default — re-export it and call it from a custom transform to keep the stripping.
 *
 * `targetGroup` is accepted (so this is assignable wherever the full transform
 * signature is expected) but unused; the strip is identical for every group.
 *
 * `options.drop` names further top-level keys (for example `dependencies`) to delete after the
 * standard stripping.
 *
 * Pure: the supplied `pkg` is NOT mutated — a shallow copy with the fields removed
 * is returned, so external callers invoking this from a custom transform keep their
 * input intact.
 * @public
 */
export function defaultManifestTransform(
	{ pkg }: { pkg: Json },
	options: { readonly drop?: ReadonlyArray<string> | undefined } = {},
): Json {
	const out: Json = { ...pkg };
	for (const field of NON_PUBLISHED_FIELDS) delete out[field];
	for (const key of options.drop ?? []) delete out[key];
	return out;
}

const stripLeadingDotSlash = (p: string): string => (p.startsWith("./") ? p.slice(2) : p);

/**
 * Describes a SEA binary the bundler compiled for this package. When present,
 * {@link transformManifest} rewrites every `exports`/`bin` value equal to `source`
 * to the emitted binary path and adds it to `files` so it ships in the tarball.
 * @public
 */
export interface ExeRewrite {
	/** The exe entry source path (matches exports/bin values to rewrite). */
	readonly source: string;
	/** The emitted SEA filename (already suffixed, incl. .exe on win). */
	readonly fileName: string;
	/** Relative dir the binary is emitted into (e.g. "bin"). */
	readonly dir: string;
}

const sameSource = (a: string, b: string): boolean => stripLeadingDotSlash(a) === stripLeadingDotSlash(b);

/** The export-path ("./bin/<file>") and files-entry ("bin/<file>") forms for a SEA. */
const exeRelPath = (r: ExeRewrite): { exportPath: string; filesEntry: string } => {
	const filesEntry = `${r.dir}/${r.fileName}`;
	return { exportPath: `./${filesEntry}`, filesEntry };
};

/** Rewrite exports values that equal the exe source to a plain SEA-path string. */
const rewriteExeExports = (exports: unknown, r: ExeRewrite): unknown => {
	const { exportPath } = exeRelPath(r);
	if (typeof exports === "string") return sameSource(exports, r.source) ? exportPath : exports;
	if (exports && typeof exports === "object") {
		const out: Json = {};
		for (const [key, value] of Object.entries(exports as Json)) {
			out[key] = typeof value === "string" && sameSource(value, r.source) ? exportPath : value;
		}
		return out;
	}
	return exports;
};

/**
 * Built .js output basename for an export, derived from the entry NAME (the basename
 * the build actually emits) rather than the source path. The entry namer flattens
 * nested subpaths to a dash-joined basename (e.g. `./commitlint` to `commitlint.js`,
 * `./changesets/markdownlint` to `changesets-markdownlint.js`), so the declared path
 * always matches the file tsdown emits. The build never sets exportsAsIndexes, so the
 * manifest mirrors the flat (false) naming here.
 */
const toBuiltJs = (exportKey: string, subdirExports?: ReadonlySet<string>): string =>
	subdirExports?.has(exportKey)
		? `./${createEntryName(exportKey, false)}/index.js`
		: `./${createEntryName(exportKey, false)}.js`;
const toBuiltDts = (exportKey: string, subdirExports?: ReadonlySet<string>): string =>
	toBuiltJs(exportKey, subdirExports).replace(/\.js$/, ".d.ts");
const toBuiltCjs = (exportKey: string, subdirExports?: ReadonlySet<string>): string =>
	toBuiltJs(exportKey, subdirExports).replace(/\.js$/, ".cjs");

const isDeclarationFile = (p: string): boolean => p.endsWith(".d.ts") || p.endsWith(".d.cts") || p.endsWith(".d.mts");
const isTs = (p: string): boolean => !isDeclarationFile(p) && (p.endsWith(".ts") || p.endsWith(".tsx"));

/**
 * Build the conditions object for a TS export target (adds require when dual-format). `emitDts`
 * gates the `types` condition: when `false` (the build's dts pass was skipped, see issue #198),
 * omitting `types` avoids pointing the published manifest at a declaration file that was never
 * written. Defaults to `true` (current behavior, byte-identical).
 *
 * The trailing `default` condition mirrors the ESM artifact so `require(esm)` resolves on the
 * Node range every published package supports (engines >=24.11.0): Node's require() matches
 * `node`/`require`/`default` but never `import`, so an import-only map dies with
 * ERR_PACKAGE_PATH_NOT_EXPORTED even where require(esm) works. Dual-format entries keep their
 * dedicated CJS artifact under `require`, which wins over `default` by condition order.
 */
const tsConditions = (exportKey: string, dual: boolean, subdirExports?: ReadonlySet<string>, emitDts = true): Json => ({
	...(emitDts ? { types: toBuiltDts(exportKey, subdirExports) } : {}),
	import: toBuiltJs(exportKey, subdirExports),
	...(dual ? { require: toBuiltCjs(exportKey, subdirExports) } : {}),
	default: toBuiltJs(exportKey, subdirExports),
});

/**
 * A `./public/<path>` export value points into the staged `public/` dir, whose CONTENTS `copyPublicDir`
 * copies into the package root (only the `public/` segment is dropped; substructure is kept). So the
 * published manifest value drops that same `public/` segment: `./public/tsconfig/ecma.json` becomes
 * `./tsconfig/ecma.json`, resolving the file copyPublicDir placed at `<pkg>/tsconfig/ecma.json`.
 * Non-strings and non-public values pass through unchanged.
 */
function stripPublicPrefix(value: unknown): unknown {
	return typeof value === "string" && value.startsWith("./public/") ? `./${value.slice("./public/".length)}` : value;
}

/** The conditions the entry pass reads a source from, in its order (`resolveSourcePath` in `entries/extract.ts`). */
const ENTRY_SOURCE_CONDITIONS = ["import", "default", "types"] as const;

/** Whether `value`, at any depth, holds a TS source string. */
const holdsTsSource = (value: unknown): boolean =>
	typeof value === "string"
		? isTs(value)
		: value !== null && typeof value === "object" && Object.values(value as Json).some(holdsTsSource);

const conditionObjectError = (exportKey: string, reason: string): ConfigValidationError =>
	new ConfigValidationError({ path: `exports."${exportKey}"`, reason });

/**
 * The TS source a condition-object export value names, when it names one the manifest can rewrite;
 * `undefined` when it holds no TS source at all (it passes through as authored).
 *
 * The entry pass builds a condition object from ONE source, the first of `import`, `default` and
 * `types` that is set, and names the output after the export KEY (`"./foo": { "import": "./src/foo.ts" }`
 * emits `foo.js`). So a condition object whose every condition is one of those three, each naming that
 * same TS source, maps unambiguously onto the export key's own conditions and is rewritten exactly as
 * the bare-string form is. Any other shape holding a TS source is refused with a
 * {@link ConfigValidationError} rather than rewritten, because the manifest would point at files the
 * build never writes: two different sources (only the first is built), a condition the entry pass
 * does not read (`node`, `browser`, `require`, ...; write the bare string and configure dual output
 * instead of a hand-written `require`), or a nested condition object.
 */
const conditionObjectSource = (exportKey: string, value: unknown): string | undefined => {
	if (value === null || typeof value !== "object" || !holdsTsSource(value)) return undefined;
	const conditions = value as Json;
	const sources = new Set<unknown>();
	for (const [condition, target] of Object.entries(conditions)) {
		if (!(ENTRY_SOURCE_CONDITIONS as ReadonlyArray<string>).includes(condition) || typeof target !== "string") {
			throw conditionObjectError(
				exportKey,
				`a condition object holding a TypeScript source may use only flat ${ENTRY_SOURCE_CONDITIONS.join("/")} conditions; "${condition}" is not one the build reads its entry from`,
			);
		}
		sources.add(target);
	}
	const [source] = sources;
	if (sources.size !== 1 || typeof source !== "string" || !isTs(source)) {
		throw conditionObjectError(
			exportKey,
			"every condition of a condition object holding a TypeScript source must name that one source; the build emits one entry per export key",
		);
	}
	return source;
};

/**
 * Refuse, before any build work, every subpath export {@link transformExports} would refuse as an
 * unbuildable condition object (see {@link conditionObjectSource}). `Bundler.build` calls it beside
 * the ambient `.d.ts` validation, so the refusal is a {@link ConfigValidationError} up front rather
 * than a throw from inside the JS pass's manifest plugin; the transform keeps its own throw as a
 * backstop. Walks the same keys the transform rewrites, skipping `.json`/`.d.ts` keys and ambient
 * exports; a mixed `.d.ts` export is left to `extractAmbientDts`, which runs first.
 *
 * @internal
 */
export function assertBuildableConditionExports(exports: unknown): void {
	if (exports === null || typeof exports !== "object") return;
	for (const [key, value] of Object.entries(exports as Json)) {
		if (key === "./package.json" || key.endsWith(".json") || isDeclarationFile(key)) continue;
		if (classifyDtsExport(value).kind !== "none") continue;
		conditionObjectSource(key, value);
	}
}

/**
 * Rewrite an exports map: TS string targets become a types/import conditions object.
 * Each TS condition also gets a `require` entry when `dual` is `true` (uniform) or when
 * the export key is in the `dual` Set (per-entry).
 *
 * The output path is derived from the export KEY via the shared entry-name function,
 * never from the source path, so the manifest target always matches the emitted file.
 *
 * Export keys in `subdirExports` are built into an isolated `<key>/index.*` subdir (e.g. an
 * RSPress `./runtime`), so their conditions gain an `/index` segment.
 *
 * `emitDts` gates the `types` condition on every GENERATED (non-ambient) TS export: pass `false`
 * when the build's dts pass was skipped (issue #198) so the manifest does not point at a `.d.ts`
 * that was never written. Defaults to `true`. Ambient `.d.ts` exports (hand-authored, copied
 * verbatim regardless of the dts pass) are unaffected — their `types` condition is always kept.
 *
 * A condition-object value whose flat `import`/`default`/`types` conditions all name one TS source
 * (`"./foo": { "import": "./src/foo.ts" }`) is rewritten like the bare string, named after the export
 * key as the entry pass names it. Any other condition object holding a TS source throws
 * {@link ConfigValidationError}, since its targets would never be built; one holding none passes
 * through as authored.
 * @public
 */
export function transformExports(
	exports: unknown,
	dual: DualExports = false,
	subdirExports?: ReadonlySet<string>,
	emitDts = true,
): unknown {
	// A bare string export is the root (`.`) target. Root ambient is unsupported — a whole-exports
	// bare .d.ts string is returned verbatim; only subpath ambient exports are rewritten.
	if (typeof exports === "string") {
		return isTs(exports) ? tsConditions(".", isDualKey(dual, "."), subdirExports, emitDts) : stripPublicPrefix(exports);
	}
	if (exports && typeof exports === "object") {
		const out: Json = {};
		for (const [key, value] of Object.entries(exports as Json)) {
			if (key === "./package.json" || key.endsWith(".json") || isDeclarationFile(key)) {
				out[key] = stripPublicPrefix(value);
				continue;
			}
			const cls = classifyDtsExport(value);
			if (cls.kind === "mixed") throw mixedDtsExportError(key);
			if (cls.kind === "ambient") {
				out[key] = { types: `./${ambientOutName(key, cls.source)}` };
				continue;
			}
			if ((typeof value === "string" && isTs(value)) || conditionObjectSource(key, value) !== undefined) {
				out[key] = tsConditions(key, isDualKey(dual, key), subdirExports, emitDts);
			} else {
				out[key] = transformExports(value, dual, subdirExports, emitDts);
			}
		}
		return out;
	}
	return exports;
}

/**
 * Rewrite bin: TS targets to bin/[command].js (string to bin/cli.js); strip leading ./ otherwise.
 *
 * @public
 */
export function transformBin(bin: unknown): unknown {
	if (typeof bin === "string") return isTs(bin) ? "bin/cli.js" : stripLeadingDotSlash(bin);
	if (bin && typeof bin === "object") {
		const out: Record<string, string> = {};
		for (const [command, p] of Object.entries(bin as Record<string, string>)) {
			out[command] = isTs(p) ? `bin/${command}.js` : stripLeadingDotSlash(p);
		}
		return out;
	}
	return bin;
}

/**
 * FINAL guard: strip leading ./ from bin paths (npm 11.x drops ./-prefixed bins).
 *
 * @public
 */
export function normalizeBinPaths(bin: unknown): unknown {
	if (typeof bin === "string") return stripLeadingDotSlash(bin);
	if (bin && typeof bin === "object") {
		const out: Record<string, string> = {};
		for (const [command, p] of Object.entries(bin as Record<string, string>)) out[command] = stripLeadingDotSlash(p);
		return out;
	}
	return bin;
}

/** @public */
export interface TransformManifestOptions {
	/** Run after the standard transforms, before the bin final-guard + sort. */
	readonly transform?: ((pkg: Json) => Json) | undefined;
	/** Which exports emit dual import/require conditions. boolean = uniform; Set = per-export-key. */
	readonly dual?: DualExports | undefined;
	/** Export keys built into a `<key>/index.*` subdir (e.g. an RSPress `./runtime`). */
	readonly subdirExports?: ReadonlySet<string> | undefined;
	/** When set, rewrite exports/bin values equal to `source` to the SEA path and add it to `files`. */
	readonly exeRewrite?: ExeRewrite | undefined;
	/**
	 * Whether the build's dts pass ran. `false` omits the `types` condition from generated (non-
	 * ambient) TS exports — the manifest must not point at a `.d.ts` that was never written
	 * (issue #198). Defaults to `true`.
	 */
	readonly emitDts?: boolean | undefined;
}

/**
 * Apply the full standard manifest transform (excluding catalog resolution, done upstream).
 *
 * @public
 */
export function transformManifest(pkg: Json, options: TransformManifestOptions = {}): Json {
	const { publishConfig, scripts, ...rest } = pkg as Json & {
		publishConfig?: { access?: string };
		scripts?: unknown;
	};
	const isPrivate = !(publishConfig?.access === "public");
	let result: Json = { ...rest, private: isPrivate };
	// Exe rewrite runs FIRST so the matched exports/bin values become plain SEA-path strings
	// (not `.ts` sources), which the standard transforms below then leave untouched. Also adds
	// the binary to `files` so it ships in the tarball (the NAPI-RS/rspack invariant).
	if (options.exeRewrite) {
		const r = options.exeRewrite;
		const { exportPath, filesEntry } = exeRelPath(r);
		if (result.exports !== undefined && result.exports !== null) {
			result.exports = rewriteExeExports(result.exports, r);
		}
		// Mirror rewriteExeExports: rewrite without mutating the caller's nested object (after the shallow
		// `...rest` spread, result.bin is the same reference as pkg.bin). Handle string-form bin too —
		// otherwise a `"bin": "./src/bin.ts"` declaration misses the rewrite and falls through to a JS path.
		if (typeof result.bin === "string") {
			if (sameSource(result.bin, r.source)) result.bin = exportPath;
		} else if (result.bin && typeof result.bin === "object") {
			const nextBin: Record<string, string> = {};
			for (const [cmd, val] of Object.entries(result.bin as Record<string, string>)) {
				nextBin[cmd] = sameSource(val, r.source) ? exportPath : val;
			}
			result.bin = nextBin;
		}
		const files = Array.isArray(result.files) ? (result.files as string[]).slice() : [];
		if (!files.includes(filesEntry)) files.push(filesEntry);
		result.files = files;
	}
	// Auto-expose the package.json itself — standard npm practice so consumers can
	// import "name/package.json". Only when an exports field is present (a package with no
	// exports already exposes everything; injecting a single-key map would REGRESS that to
	// package.json-only). The wrap decision keys off the ORIGINAL exports type, not the
	// transformed value: a bare-string exports becomes a single conditions object after
	// transformExports, indistinguishable from a map, so it must be wrapped under "." here.
	// Runs before the user transform (next line), so a package can still strip it.
	if (result.exports !== undefined && result.exports !== null) {
		const original = result.exports;
		const transformed = transformExports(
			original,
			options.dual ?? false,
			options.subdirExports,
			options.emitDts ?? true,
		);
		const asMap: Json = typeof original === "string" ? { ".": transformed } : { ...(transformed as Json) };
		if (!("./package.json" in asMap)) asMap["./package.json"] = "./package.json";
		result.exports = asMap;
	}
	if (result.bin) result.bin = transformBin(result.bin);
	if (options.transform) result = options.transform(result);
	if (result.bin) result.bin = normalizeBinPaths(result.bin);
	return PackageJsonFormat.sortValue(result as never) as unknown as Json;
}
