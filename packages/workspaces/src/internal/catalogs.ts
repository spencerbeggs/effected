// The catalog engine: pnpm 12's catalog semantics, restated.
//
// Each function below re-implements one pnpm 12.20.0 crate, read rather than
// recalled (okf/decisions/catalog-and-workspace-protocol-owner.md):
//
// - `inlineCatalogs` is `pnpm_catalogs_config::get_catalogs_from_workspace_manifest`
//   (vendored at `.repos/pnpm/pnpm/crates/catalogs-config`);
// - `catalogNameOf` is `pnpm_catalogs_protocol_parser::parse_catalog_protocol`;
// - `rangeOf` is `pnpm_catalogs_resolver::resolve_from_catalog` with the
//   `AsWritten` anchor: an entry resolves to its specifier exactly as written,
//   a `link:` or `file:` entry included, because the kit compares and reports
//   ranges and never installs from them.
//
// The pnpm 11 JavaScript packages (`@pnpm/catalogs.*`) this replaced reject a
// `link:` / `file:` entry, which pnpm 12 resolves.

/** A catalog map: catalog name → dependency → specifier. */
export type Catalogs = Record<string, Record<string, string>>;

/** The name pnpm gives the unnamed top-level catalog. */
const DEFAULT_CATALOG_NAME = "default";

const CATALOG_PROTOCOL = "catalog:";

/** The normalized entries shape: catalog name → dependency → range. */
export type CatalogEntries = Record<string, Record<string, string>>;

/** Why a catalog specifier could not be resolved. Raw record; the facade types it. */
export interface CatalogMisconfiguration {
	readonly catalogName: string;
	readonly detail: string;
}

/**
 * Project a pnpm-workspace manifest's `catalog` / `catalogs` fields into one
 * `Catalogs` map, the top-level `catalog` under `"default"`.
 *
 * pnpm refuses a manifest that defines the default catalog twice (a top-level
 * `catalog` and a `catalogs.default`). That is a malformed workspace file, a
 * data condition, so it yields the empty map rather than a defect.
 */
export const inlineCatalogs = (manifest: {
	readonly catalog?: Record<string, string> | undefined;
	readonly catalogs?: Record<string, Record<string, string>> | undefined;
}): Catalogs => {
	const { catalog, catalogs: named } = manifest;
	// pnpm 12 tests the key (`contains_key`), not its value, so a
	// `catalogs: { default: ~ }` beside a top-level `catalog` is refused too.
	if (catalog != null && named != null && Object.hasOwn(named, DEFAULT_CATALOG_NAME)) return {};
	const catalogs: Catalogs = {};
	if (catalog != null) define(catalogs, DEFAULT_CATALOG_NAME, catalog);
	if (named != null) {
		for (const [name, entries] of Object.entries(named)) define(catalogs, name, entries);
	}
	return catalogs;
};

/**
 * Merge catalog sources; later sources win per dependency within a catalog.
 * Keys are copied as own data properties, so a `__proto__` name is inert.
 */
export const merge = (...sources: ReadonlyArray<Catalogs | undefined>): Catalogs => {
	const result: Catalogs = {};
	for (const source of sources) {
		if (source == null) continue;
		for (const [name, catalog] of Object.entries(source)) {
			if (catalog == null) continue;
			const target: Record<string, string> = Object.hasOwn(result, name) ? (result[name] ?? {}) : {};
			for (const [dependency, specifier] of Object.entries(catalog)) define(target, dependency, specifier);
			define(result, name, target);
		}
	}
	return result;
};

/** Whether `specifier` is a `catalog:` protocol reference, and which catalog it names. */
export const catalogNameOf = (specifier: string): string | null => {
	if (!specifier.startsWith(CATALOG_PROTOCOL)) return null;
	const name = specifier.slice(CATALOG_PROTOCOL.length).trim();
	return name === "" ? DEFAULT_CATALOG_NAME : name;
};

/** Normalize the arbitrary shape of a catalog map into `CatalogEntries`, dropping anything unusable. */
export const normalize = (raw: unknown): CatalogEntries => {
	if (raw === null || typeof raw !== "object") return {};
	const entries: CatalogEntries = {};
	for (const [catalogName, catalog] of Object.entries(raw as Record<string, unknown>)) {
		if (catalog === null || typeof catalog !== "object") continue;
		const clean: Record<string, string> = {};
		for (const [dependency, value] of Object.entries(catalog as Record<string, unknown>)) {
			if (typeof value === "string") {
				// `__proto__` as a plain assignment would mutate the prototype; route
				// every key through defineProperty, matching JSON.parse semantics.
				define(clean, dependency, value);
			} else if (value !== null && typeof value === "object" && "specifier" in value) {
				// A pnpm LOCKFILE catalog entry is `{ specifier, version }`; the
				// specifier is the declared range, which is what a catalog resolves to.
				const specifier = (value as { readonly specifier: unknown }).specifier;
				if (typeof specifier === "string") define(clean, dependency, specifier);
			}
		}
		define(entries as Record<string, unknown>, catalogName, clean);
	}
	return entries;
};

const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
	if (key === "__proto__") {
		Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
	} else {
		target[key] = value;
	}
};

/**
 * Resolve one `catalog:` specifier against an assembled catalog set.
 *
 * Returns the entry as written on a hit, `undefined` for a specifier that is
 * not a `catalog:` reference, and a `CatalogMisconfiguration` when pnpm would
 * report the reference misconfigured: no entry for the dependency in the named
 * catalog, or an entry that is itself a `catalog:` reference.
 */
export const rangeOf = (
	catalogs: Catalogs,
	dependency: string,
	specifier: string,
): string | undefined | CatalogMisconfiguration => {
	const catalogName = catalogNameOf(specifier);
	if (catalogName === null) return undefined;
	const catalog = Object.hasOwn(catalogs, catalogName) ? catalogs[catalogName] : undefined;
	const entry = catalog !== undefined && Object.hasOwn(catalog, dependency) ? catalog[dependency] : undefined;
	if (entry === undefined) {
		return { catalogName, detail: `No catalog entry '${dependency}' was found for catalog '${catalogName}'.` };
	}
	if (catalogNameOf(entry) !== null) {
		return {
			catalogName,
			detail: `Found invalid catalog entry using the catalog protocol recursively. The entry for '${dependency}' in catalog '${catalogName}' is invalid.`,
		};
	}
	return entry;
};
