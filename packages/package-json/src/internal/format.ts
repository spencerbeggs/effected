// Pure package.json serialization helpers: canonical top-level key ordering
// (the `sort-package-json` order), dependency-map alphabetization and
// empty-dependency-map stripping. These replace the v3 `PackageJsonFormatter`
// and `PackageJsonTransformer` services — both were pure `Record → Record`
// steps, so they collapse to functions surfaced through `Package.toJsonString`
// and `PackageJsonFile.write` options.
//
// Private implementation module — never re-exported from `index.ts`.

/**
 * Canonical top-level key order, matching `sort-package-json`. Keys not listed
 * sort alphabetically after the known keys.
 */
const KEY_ORDER: ReadonlyArray<string> = [
	"$schema",
	"name",
	"version",
	"private",
	"description",
	"keywords",
	"homepage",
	"bugs",
	"repository",
	"funding",
	"license",
	"author",
	"contributors",
	"type",
	"imports",
	"exports",
	"main",
	"module",
	"browser",
	"bin",
	"man",
	"files",
	"directories",
	"workspaces",
	"scripts",
	"config",
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"optionalDependencies",
	"bundleDependencies",
	"overrides",
	"engines",
	"devEngines",
	"os",
	"cpu",
	"publishConfig",
	"packageManager",
];

const KEY_INDEX = new Map(KEY_ORDER.map((k, i) => [k, i] as const));

/**
 * Deterministic, locale-independent string comparison by code point. A bare
 * `localeCompare` sorts differently across ICU builds/locales; package.json key
 * order must be stable everywhere.
 */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const DEPENDENCY_KEYS: ReadonlySet<string> = new Set([
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
	"bundleDependencies",
]);

/** Alphabetize the entries of a plain-object dependency map. */
const sortDependencyMap = (value: Record<string, unknown>): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort(byCodePoint)) {
		result[key] = value[key];
	}
	return result;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Order top-level keys canonically (known keys by {@link KEY_ORDER}, the rest
 * alphabetically) and alphabetize dependency-map entries.
 */
export const sortKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
	const known: Array<[string, unknown]> = [];
	const rest: Array<[string, unknown]> = [];

	for (const key of Object.keys(obj)) {
		if (KEY_INDEX.has(key)) known.push([key, obj[key]]);
		else rest.push([key, obj[key]]);
	}

	// biome-ignore lint/style/noNonNullAssertion: keys in `known` are all present in KEY_INDEX
	known.sort((a, b) => KEY_INDEX.get(a[0])! - KEY_INDEX.get(b[0])!);
	rest.sort((a, b) => byCodePoint(a[0], b[0]));

	const result: Record<string, unknown> = {};
	for (const [key, value] of [...known, ...rest]) {
		result[key] = DEPENDENCY_KEYS.has(key) && isPlainObject(value) ? sortDependencyMap(value) : value;
	}
	return result;
};

const DEPENDENCY_MAP_KEYS: ReadonlyArray<string> = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

/** Remove dependency-map keys whose value is an empty object. */
export const stripEmptyDependencyMaps = (raw: Record<string, unknown>): Record<string, unknown> => {
	const result = { ...raw };
	for (const key of DEPENDENCY_MAP_KEYS) {
		const value = result[key];
		if (isPlainObject(value) && Object.keys(value).length === 0) {
			delete result[key];
		}
	}
	return result;
};

/**
 * Render an already-encoded package.json record to a JSON string, applying the
 * empty-map strip, canonical key ordering and a trailing newline unless the
 * corresponding options opt out.
 */
export const renderJson = (
	raw: Record<string, unknown>,
	options: { readonly indent: number; readonly sort: boolean; readonly stripEmpty: boolean; readonly newline: boolean },
): string => {
	let record = options.stripEmpty ? stripEmptyDependencyMaps(raw) : raw;
	if (options.sort) record = sortKeys(record);
	const json = JSON.stringify(record, null, options.indent);
	return options.newline ? `${json}\n` : json;
};
