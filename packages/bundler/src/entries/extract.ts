// packages/bundler/src/entries/extract.ts

/** @public */
export interface PackageJsonLike {
	readonly exports?: unknown;
	readonly bin?: unknown;
}

/** @public */
export interface ExtractOptions {
	readonly exportsAsIndexes?: boolean | undefined;
	/** Source paths to NOT turn into JS build entries (e.g. an exe entry compiled as a SEA). */
	readonly excludeSources?: ReadonlyArray<string> | undefined;
}

/** @public */
export interface ExtractResult {
	/** entry name to TS source path */
	readonly entries: Record<string, string>;
	/** entry name to original export key (for downstream output-map alignment) */
	readonly exportPaths: Record<string, string>;
}

const isDeclarationFile = (p: string): boolean => p.endsWith(".d.ts") || p.endsWith(".d.cts") || p.endsWith(".d.mts");
const isTypeScriptFile = (p: string): boolean => !isDeclarationFile(p) && (p.endsWith(".ts") || p.endsWith(".tsx"));

/**
 * `/dist/*.js` to `/src/*.ts`; otherwise unchanged. The entry pass builds a `./dist/foo.js` export from
 * `./src/foo.ts`, and the manifest transform reads the same mapping to point that export at the emitted file.
 *
 * @internal
 */
export const resolveToTypeScript = (p: string): string =>
	p.endsWith(".js") && p.includes("/dist/") ? p.replace("/dist/", "/src/").replace(/\.js$/, ".ts") : p;

/** Resolve an export value to a source path: import || default || types (NOT require). */
const resolveSourcePath = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const o = value as Record<string, unknown>;
		return (o.import as string) || (o.default as string) || (o.types as string) || undefined;
	}
	return undefined;
};

/**
 * Map an export key to the tsdown entry name (the emitted output basename).
 *
 * `.` becomes `index`; otherwise the leading `./` is stripped and, unless
 * `exportsAsIndexes` is set, nested slashes are flattened to dashes
 * (e.g. `./changesets/markdownlint` to `changesets-markdownlint`). The manifest
 * transform reuses this so the declared output path always matches the emitted file.
 *
 * @internal
 */
export const createEntryName = (exportKey: string, exportsAsIndexes: boolean): string => {
	if (exportKey === ".") return "index";
	const withoutPrefix = exportKey.replace(/^\.\//, "");
	return exportsAsIndexes ? `${withoutPrefix}/index` : withoutPrefix.replace(/\//g, "-");
};

/** @public */
export function extractEntries(pkg: PackageJsonLike, options: ExtractOptions = {}): ExtractResult {
	const entries: Record<string, string> = {};
	const exportPaths: Record<string, string> = {};
	const exportsAsIndexes = options.exportsAsIndexes ?? false;

	// Source paths excluded from the JS pass (e.g. an exe entry built as a SEA, not JS).
	// Compared with the leading "./" normalized away on both sides.
	const stripDot = (p: string): string => p.replace(/^\.\//, "");
	const excluded = new Set((options.excludeSources ?? []).map(stripDot));
	const isExcluded = (src: string): boolean => excluded.has(stripDot(src));

	// --- exports ---
	const exports = pkg.exports;
	if (typeof exports === "string") {
		if (isTypeScriptFile(exports) && !isExcluded(exports)) {
			entries.index = exports;
			exportPaths.index = ".";
		}
	} else if (exports && typeof exports === "object") {
		for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
			if (key === "./package.json" || key.endsWith(".json")) continue;
			const sourcePath = resolveSourcePath(value);
			if (!sourcePath) continue;
			const resolved = resolveToTypeScript(sourcePath);
			if (!isTypeScriptFile(resolved)) continue;
			if (isExcluded(sourcePath) || isExcluded(resolved)) continue;
			const name = createEntryName(key, exportsAsIndexes);
			// The slash-to-dash flattening is not injective (e.g. "./a-b/c" and "./a/b-c"
			// both flatten to "a-b-c"). A collision would silently overwrite one entry and
			// its manifest target, producing a corrupt artifact, so fail loudly instead.
			if (name in entries) {
				const previousKey = exportPaths[name];
				throw new Error(
					`Export key "${key}" flattens to entry name "${name}", which collides with export key "${previousKey}". ` +
						`Rename one of the conflicting exports so each produces a distinct entry name.`,
				);
			}
			entries[name] = resolved;
			exportPaths[name] = key;
		}
	}

	// --- bin ---
	const bin = pkg.bin;
	if (typeof bin === "string") {
		const resolved = resolveToTypeScript(bin);
		if (isTypeScriptFile(resolved) && !isExcluded(bin) && !isExcluded(resolved)) entries["bin/cli"] = resolved;
	} else if (bin && typeof bin === "object") {
		for (const [command, p] of Object.entries(bin as Record<string, unknown>)) {
			if (typeof p !== "string") continue;
			const resolved = resolveToTypeScript(p);
			if (isExcluded(p) || isExcluded(resolved)) continue;
			if (isTypeScriptFile(resolved)) entries[`bin/${command}`] = resolved;
		}
	}

	return { entries, exportPaths };
}
