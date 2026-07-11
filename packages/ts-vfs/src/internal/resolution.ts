/**
 * Exports-map resolution machinery. Every input here — `exports` values,
 * `typesVersions` maps, wildcard patterns — is untrusted JSON fetched from a
 * CDN, so every recursive surface carries a depth guard, wildcard patterns
 * are bounded before regex compilation, and untrusted keys are only read
 * through `Object.hasOwn` (a JSON-parsed `{"__proto__": …}` key would
 * otherwise read or, worse, assign the prototype).
 */

import { MAX_NESTING_DEPTH, MAX_WILDCARDS_PER_PATTERN } from "./limits.js";

/** Keys that are never data on a plain object. Skipped everywhere. */
const DUNDER_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Whether a path names a TypeScript declaration file. */
export const isTypeDefinition = (filePath: string): boolean =>
	filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts");

/** Normalize backslashes to forward slashes. */
export const normalizePath = (path: string): string => path.replace(/\\/g, "/");

const escapeRegex = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/**
 * Compile an exports/typesVersions wildcard pattern to a regex, or `null`
 * when the pattern exceeds the wildcard bound. npm semantics use exactly one
 * `*`; a hostile pattern with many wildcards would compile to a
 * catastrophic-backtracking regex, so past the bound it simply does not
 * match.
 */
export const compileWildcard = (pattern: string): RegExp | null => {
	let stars = 0;
	for (const char of pattern) {
		if (char === "*") stars += 1;
	}
	if (stars === 0 || stars > MAX_WILDCARDS_PER_PATTERN) return null;
	return new RegExp(`^${escapeRegex(pattern).replace(/\\?\*/g, "(.*)")}$`);
};

/**
 * Substitute a captured wildcard segment into an exports value.
 *
 * @remarks
 * This is where v3 had a live prototype-pollution defect: it copied untrusted
 * keys into a plain object literal, so an `exports` map containing a
 * `"__proto__"` key assigned the prototype of the result. Substituted maps
 * are built with `Object.create(null)` and dunder keys are skipped. Past the
 * depth guard nothing resolves (`null`).
 */
export const substituteWildcard = (value: unknown, captured: string, depth = 0): unknown => {
	if (depth > MAX_NESTING_DEPTH) return null;
	if (typeof value === "string") return value.replace(/\*/g, captured);
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const key of Object.keys(value)) {
			if (DUNDER_KEYS.has(key)) continue;
			const entry = (value as Record<string, unknown>)[key];
			result[key] =
				typeof entry === "string" || (typeof entry === "object" && entry !== null)
					? substituteWildcard(entry, captured, depth + 1)
					: entry;
		}
		return result;
	}
	return value;
};

/**
 * Look up a subpath in an `exports` map: exact key first (with and without
 * the `./` prefix), then bounded wildcard patterns. Returns the export value
 * (wildcards substituted) or `null`.
 */
export const getExportValue = (exports: unknown, subpath: string): unknown => {
	if (exports === undefined || exports === null) return null;
	if (typeof exports === "string") return subpath === "." ? exports : null;
	if (typeof exports !== "object" || Array.isArray(exports)) return null;
	const exportsObj = exports as Record<string, unknown>;
	const withoutDot = subpath.replace(/^\.\//, "");
	for (const key of [subpath, withoutDot]) {
		if (!DUNDER_KEYS.has(key) && Object.hasOwn(exportsObj, key)) {
			return exportsObj[key];
		}
	}
	for (const pattern of Object.keys(exportsObj)) {
		if (DUNDER_KEYS.has(pattern) || !pattern.includes("*")) continue;
		const regex = compileWildcard(pattern);
		if (regex === null) continue;
		const match = regex.exec(subpath) ?? regex.exec(withoutDot);
		if (match !== null) {
			return substituteWildcard(exportsObj[pattern], match[1] ?? "");
		}
	}
	return null;
};

/**
 * Extract a types-bearing path from an export value: `types` first, then
 * `import` / `default`, recursing into nested condition objects under the
 * depth guard.
 */
export const extractTypesFromExport = (exportValue: unknown, depth = 0): string | null => {
	if (depth > MAX_NESTING_DEPTH) return null;
	if (exportValue === undefined || exportValue === null) return null;
	if (typeof exportValue === "string") return exportValue;
	if (typeof exportValue !== "object" || Array.isArray(exportValue)) return null;
	const conditions = exportValue as Record<string, unknown>;
	for (const condition of ["types", "import", "default"]) {
		if (!Object.hasOwn(conditions, condition)) continue;
		const value = conditions[condition];
		if (typeof value === "string") return value;
		if (typeof value === "object" && value !== null) {
			const nested = extractTypesFromExport(value, depth + 1);
			if (nested !== null) return nested;
		}
	}
	return null;
};

/** The conventional lookup candidates for a bare subpath, most specific first. */
export const tryExtensions = (basePath: string): Array<string> =>
	[
		basePath,
		`${basePath}.d.ts`,
		`${basePath}.d.mts`,
		`${basePath}.d.cts`,
		`${basePath}.ts`,
		`${basePath}.mts`,
		`${basePath}.cts`,
		`${basePath}.js`,
		`${basePath}.mjs`,
		`${basePath}.cjs`,
		`${basePath}/index.d.ts`,
		`${basePath}/index.d.mts`,
		`${basePath}/index.d.cts`,
		`${basePath}/index.ts`,
		`${basePath}/index.js`,
	].map(normalizePath);

/**
 * The main type entry for a manifest: `types`/`typings`, then the root
 * export's types condition, then a declaration-extension swap of `main`,
 * with the documented `index.d.ts` convention floor — which is what makes
 * `TypeResolver.resolveMainEntry` genuinely total.
 */
export const findMainTypePath = (manifest: {
	readonly types?: string;
	readonly typings?: string;
	readonly main?: string;
	readonly exports?: unknown;
}): string => {
	if (manifest.types !== undefined) return manifest.types;
	if (manifest.typings !== undefined) return manifest.typings;
	if (manifest.exports !== undefined) {
		const rootExport = getExportValue(manifest.exports, ".");
		const typesPath = extractTypesFromExport(rootExport);
		if (typesPath !== null) return typesPath;
	}
	if (manifest.main !== undefined) {
		const mainWithoutExt = manifest.main.replace(/\.(m?[jt]s|cjs)$/, "");
		const found = tryExtensions(mainWithoutExt).find(isTypeDefinition);
		if (found !== undefined) return found;
		return manifest.main;
	}
	return "index.d.ts";
};
