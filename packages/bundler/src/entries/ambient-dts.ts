// packages/bundler/src/entries/ambient-dts.ts
import { ConfigValidationError } from "../errors.js";
import type { PackageJsonLike } from "./extract.js";
import { createEntryName } from "./extract.js";

const DECLARATION_EXTS = [".d.ts", ".d.cts", ".d.mts"] as const;

/** The declaration-file extension of a path, or undefined when it is not a declaration file. @public */
export function declarationExt(p: string): ".d.ts" | ".d.cts" | ".d.mts" | undefined {
	return DECLARATION_EXTS.find((e) => p.endsWith(e));
}

/** Classification of a single export value for ambient-.d.ts handling. @public */
export type DtsExportClass =
	| { readonly kind: "ambient"; readonly source: string }
	| { readonly kind: "mixed" }
	| { readonly kind: "none" };

/**
 * Classify an export value:
 * - `ambient` — a types-only declaration source (bare `.d.ts` string, or `{ types: "*.d.ts" }` with no runtime source).
 * - `mixed` — a declaration `types` AND a compilable runtime source (`import`/`require`/`default` → `.ts`/`.tsx`).
 * - `none` — anything else (normal runtime export, json, etc.).
 * @public
 */
export function classifyDtsExport(value: unknown): DtsExportClass {
	if (typeof value === "string") {
		return declarationExt(value) !== undefined ? { kind: "ambient", source: value } : { kind: "none" };
	}
	if (value && typeof value === "object") {
		const o = value as Record<string, unknown>;
		const typesVal = typeof o.types === "string" ? o.types : undefined;
		const typesIsDecl = typesVal !== undefined && declarationExt(typesVal) !== undefined;
		// Any non-`types` condition whose value is a string that is NOT itself a declaration file is a
		// runtime path (import/require/default, but also node/browser/.mts/.cts/.js branches): the export
		// carries runtime, so it is mixed, not ambient.
		const hasRuntime = Object.entries(o).some(
			([k, v]) => k !== "types" && typeof v === "string" && declarationExt(v) === undefined,
		);
		if (typesIsDecl) return hasRuntime ? { kind: "mixed" } : { kind: "ambient", source: typesVal };
	}
	return { kind: "none" };
}

/**
 * Output basename (including the preserved declaration extension) for an ambient export, derived
 * from the export KEY — consistent with how JS entries are named. @public
 */
export function ambientOutName(exportKey: string, source: string, exportsAsIndexes = false): string {
	const ext = declarationExt(source) ?? ".d.ts";
	return `${createEntryName(exportKey, exportsAsIndexes)}${ext}`;
}

/**
 * The shared mixed-export error (Decision 2), used by both the extractor and the manifest transform. The reason ends
 * with the bare-string form to write instead, naming the export's runtime target when `value` holds one: a
 * hand-written `{ "types": "./dist/foo.d.ts", "import": "./dist/foo.js" }` becomes `"./foo": "./dist/foo.js"`, which
 * the bundler builds from `./src/foo.ts` and gives generated types. @public
 */
export function mixedDtsExportError(exportKey: string, value?: unknown): ConfigValidationError {
	const conditions = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const runtime = ["import", "default"]
		.map((condition) => conditions[condition])
		.find((target): target is string => typeof target === "string");
	const example = runtime ?? "./src/<name>.ts";
	return new ConfigValidationError({
		path: `exports."${exportKey}"`,
		reason: `an export with a runtime source (import/require/default) cannot also hand-author its \`types\` as a .d.ts; the bundler generates types from the source. Drop the \`types\` condition and write "${exportKey}": "${example}"`,
	});
}

/** One ambient `.d.ts` export resolved for copy + manifest. @public */
export interface AmbientDtsEntry {
	readonly exportKey: string;
	readonly source: string;
	readonly outName: string;
}

/** @public */
export interface ExtractAmbientOptions {
	readonly exportsAsIndexes?: boolean | undefined;
}

/**
 * Extract the types-only `.d.ts` exports from a package's `exports` map. Pure.
 * Throws {@link ConfigValidationError} on a mixed export (Decision 2) or an ambient-vs-ambient
 * output-name collision. @public
 */
export function extractAmbientDts(
	pkg: PackageJsonLike,
	options: ExtractAmbientOptions = {},
): ReadonlyArray<AmbientDtsEntry> {
	const exports = pkg.exports;
	// A bare-string root export is a single runtime entry, never a types-only ambient map; nothing to do.
	if (!exports || typeof exports !== "object") return [];
	const exportsAsIndexes = options.exportsAsIndexes ?? false;
	const out: AmbientDtsEntry[] = [];
	const byName = new Map<string, string>();
	for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
		if (key === "./package.json" || key.endsWith(".json")) continue;
		// An export whose KEY is itself a declaration-file path (e.g. an RSPress "./rspress-env.d.ts"
		// public-asset re-export) is not an ambient subpath — pass it through, do not rewrite/copy it.
		if (declarationExt(key) !== undefined) continue;
		const cls = classifyDtsExport(value);
		if (cls.kind === "none") continue;
		if (cls.kind === "mixed") throw mixedDtsExportError(key, value);
		const outName = ambientOutName(key, cls.source, exportsAsIndexes);
		const prev = byName.get(outName);
		if (prev !== undefined) {
			throw new ConfigValidationError({
				path: `exports."${key}"`,
				reason: `ambient .d.ts export flattens to "${outName}", colliding with export key "${prev}". Rename one so each produces a distinct file.`,
			});
		}
		byName.set(outName, key);
		out.push({ exportKey: key, source: cls.source, outName });
	}
	return out;
}

/**
 * Throw {@link ConfigValidationError} if any ambient output name collides with a JS build-entry name.
 * The JS entry names carry no extension, so each ambient `outName` is compared with its declaration
 * extension stripped. @public
 */
export function assertNoEntryCollisions(
	jsEntryNames: ReadonlyArray<string>,
	ambient: ReadonlyArray<AmbientDtsEntry>,
): void {
	const js = new Set(jsEntryNames);
	for (const a of ambient) {
		const base = a.outName.replace(/\.d\.(ts|cts|mts)$/, "");
		if (js.has(base)) {
			throw new ConfigValidationError({
				path: `exports."${a.exportKey}"`,
				reason: `ambient .d.ts export "${a.outName}" collides with the JS build entry "${base}". Rename the export so each produces a distinct output.`,
			});
		}
	}
}
