// packages/bundler/src/passes/loose-files.ts
import { basename, extname } from "node:path";
import { ConfigValidationError } from "../errors.js";
import type { BuildFormat } from "./target-groups.js";

/**
 * One standalone bundled output file, declared by its literal output filename.
 *
 * @public
 */
export interface LooseFileSpec {
	/** Source module to bundle into the file. */
	readonly source: string;
	/** Module format. Required only for an ambiguous `.js` key; inferred from `.mjs`/`.cjs`. */
	readonly format?: BuildFormat | undefined;
}

/**
 * Map of literal output filename to its source (bare string) or a `{ source, format }` spec.
 *
 * @public
 */
export type LooseFiles = Record<string, string | LooseFileSpec>;

/**
 * A loose file resolved to a concrete build descriptor.
 *
 * @public
 */
export interface NormalizedLooseFile {
	/** Literal output filename written into the package dir, e.g. `pnpmfile.mjs`. */
	readonly outFile: string;
	/** tsdown entry name (outFile without its extension), e.g. `pnpmfile`. */
	readonly entryName: string;
	/** Source module to bundle. */
	readonly source: string;
	/** Resolved module format. */
	readonly format: BuildFormat;
	/**
	 * Whether tsdown should use fixed extensions. `.mjs`/`.cjs` need `true` (tsdown derives
	 * `.mjs` for esm and `.cjs` for cjs); a `.js` + esm output needs `false` (tsdown derives `.js`).
	 */
	readonly fixedExtension: boolean;
}

/** Extension to its implied format; `.js` is ambiguous (undefined). */
const EXT_FORMAT: Readonly<Record<string, BuildFormat | undefined>> = {
	".mjs": "esm",
	".cjs": "cjs",
	".js": undefined,
};

/**
 * Resolve a `looseFiles` map into normalized build descriptors. Pure (no filesystem):
 * a missing `source` is surfaced later by tsdown's entry resolution. Throws
 * {@link ConfigValidationError} on any structural problem so the bundler's ConfigValidator
 * surfaces it as a typed, fast-fail config error.
 * @public
 */
export function normalizeLooseFiles(files: LooseFiles): ReadonlyArray<NormalizedLooseFile> {
	const out: NormalizedLooseFile[] = [];
	for (const [outFile, raw] of Object.entries(files)) {
		if (basename(outFile) !== outFile) {
			throw new ConfigValidationError({
				path: `looseFiles."${outFile}"`,
				reason: "a loose file must be a root-level filename with no path separator",
			});
		}
		const ext = extname(outFile);
		if (!(ext in EXT_FORMAT)) {
			throw new ConfigValidationError({
				path: `looseFiles."${outFile}"`,
				reason: `unsupported output extension "${ext}" — use .mjs, .cjs, or .js`,
			});
		}
		const source = typeof raw === "string" ? raw : raw.source;
		const explicit = typeof raw === "string" ? undefined : raw.format;
		const inferred = EXT_FORMAT[ext];
		if (inferred !== undefined && explicit !== undefined && explicit !== inferred) {
			throw new ConfigValidationError({
				path: `looseFiles."${outFile}".format`,
				reason: `format "${explicit}" contradicts the "${ext}" extension (which implies "${inferred}")`,
			});
		}
		if (inferred === undefined && explicit === undefined) {
			throw new ConfigValidationError({
				path: `looseFiles."${outFile}".format`,
				reason: 'a ".js" output is format-ambiguous — set format: "esm"',
			});
		}
		const format = (inferred ?? explicit) as BuildFormat;
		// A CJS file named ".js" would need a post-emit rename (tsdown derives ".cjs" for cjs). Deferred.
		if (ext === ".js" && format === "cjs") {
			throw new ConfigValidationError({
				path: `looseFiles."${outFile}"`,
				reason: 'a CJS file named ".js" is not supported yet — name it ".cjs"',
			});
		}
		out.push({
			outFile,
			entryName: basename(outFile, ext),
			source,
			format,
			fixedExtension: ext !== ".js",
		});
	}
	return out;
}
