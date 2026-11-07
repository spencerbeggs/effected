import { DependencyField, DependencySpecifier } from "@effected/npm";
import { Option, Schema } from "effect";
import type { ImporterDependency } from "./ImporterDependency.js";
import { DEP_TYPES } from "./internal/shared.js";
import type { Lockfile } from "./Lockfile.js";
import type { ResolvedPackage } from "./ResolvedPackage.js";

// ── Field schemas ──────────────────────────────────────────────────────────

const ChangeKind = Schema.Literals(["added", "removed", "changed"]);

/** One side-by-side value: absent on the side that does not have it. */
const StringSides = Schema.Struct({
	before: Schema.optionalKey(Schema.String),
	after: Schema.optionalKey(Schema.String),
});

const SpecifierSides = Schema.Struct({
	before: Schema.optionalKey(DependencySpecifier.FromString),
	after: Schema.optionalKey(DependencySpecifier.FromString),
});

const CatalogConsumer = Schema.Struct({
	importer: Schema.NonEmptyString,
	depType: DependencyField,
});

type Kind = typeof ChangeKind.Type;

/**
 * The cross-field rule both change records hold: `kind` says which sides of
 * `specifier` exist, an added record has no `version.before` and a removed one
 * no `version.after`, and a `changed` record really differs. A record that
 * breaks it cannot be constructed, so `kind` and the sides never disagree.
 */
const kindMatchesSides = (input: {
	readonly kind: Kind;
	readonly specifier: { readonly before?: string | undefined; readonly after?: string | undefined };
	readonly version: { readonly before?: string | undefined; readonly after?: string | undefined };
}): string | undefined => {
	const { kind, specifier, version } = input;
	if (kind === "added") {
		return specifier.before === undefined && specifier.after !== undefined && version.before === undefined
			? undefined
			: "an added change has an after specifier and no before side";
	}
	if (kind === "removed") {
		return specifier.before !== undefined && specifier.after === undefined && version.after === undefined
			? undefined
			: "a removed change has a before specifier and no after side";
	}
	if (specifier.before === undefined || specifier.after === undefined) {
		return "a changed change has a specifier on both sides";
	}
	const versionMoved = version.before !== undefined && version.after !== undefined && version.before !== version.after;
	return specifier.before !== specifier.after || versionMoved
		? undefined
		: "a changed change differs in its specifier or in both resolved versions";
};

// ── Change records ─────────────────────────────────────────────────────────

/**
 * One catalog entry that moved between two lockfiles, as reported by
 * `LockfileDiff.compare`.
 *
 * @remarks
 * - `catalog` — the catalog name. The default catalog is `"default"` in every
 *   format: pnpm keys it that way already, and bun's separate unnamed
 *   `catalog` section is folded in under that name.
 * - `name` — the package the entry pins.
 * - `specifier` — the entry's specifier on each side, absent on the side that
 *   does not have the entry.
 * - `version` — the entry's resolved version on each side, present only where
 *   it could be resolved. pnpm records it on the catalog entry; bun records
 *   it on package entries instead, so it is the version the entry's consumers
 *   resolved to (see `LockfileDiff.compare` for the rule). A side with no
 *   resolvable version is absent rather than guessed.
 * - `kind` — `"added"` (only `after` sides), `"removed"` (only `before`
 *   sides) or `"changed"` (both sides, and the specifier or both resolved
 *   versions differ). Construction rejects a record whose `kind` disagrees
 *   with its sides.
 * - `consumers` — the importers that reference the entry through a `catalog:`
 *   specifier, with the dependency section each one declares it in. Read from
 *   the `after` lockfile, except for a removed entry, whose consumers are read
 *   from `before`: a removed entry is by definition referenced by nobody
 *   afterwards. Empty when no importer references the entry.
 *
 * @public
 */
export class CatalogChange extends Schema.Class<CatalogChange>("CatalogChange")(
	Schema.Struct({
		/** The catalog name; `"default"` for the default catalog. */
		catalog: Schema.NonEmptyString,
		/** The package name the catalog entry pins. */
		name: Schema.NonEmptyString,
		/** The entry's specifier before and after; absent on the side without the entry. */
		specifier: StringSides,
		/** The entry's resolved version before and after; absent where it could not be resolved. */
		version: StringSides,
		/** Whether the entry was added, removed or changed. */
		kind: ChangeKind,
		/** The importers that reference the entry, with the section each declares it in. */
		consumers: Schema.Array(CatalogConsumer),
	}).check(Schema.makeFilter(kindMatchesSides)),
) {}

/**
 * One importer dependency that moved between two lockfiles, as reported by
 * `LockfileDiff.compare`.
 *
 * @remarks
 * A dependency is identified by `importer`, `name` and `depType` together, so
 * a package declared in two sections of one importer is compared section by
 * section.
 *
 * - `importer` — the importer path, `"."` for the workspace root.
 * - `name` — the dependency's package name.
 * - `depType` — the section that declares it, in `@effected/npm`'s
 *   `DependencyField` vocabulary.
 * - `specifier` — the declared specifier on each side, typed as in
 *   `ImporterDependency`: a tag-matchable classified specifier whose `raw` is
 *   the exact recorded string. Absent on the side without the dependency.
 * - `version` — the version the dependency resolved to on each side, present
 *   only where the lockfile lets it be resolved: pnpm records it per importer
 *   dependency (a workspace link reads `link:<path>`); for bun and npm it is
 *   read through the importer's resolved edge to the package entry; yarn
 *   records no importers at all.
 * - `kind` — `"added"`, `"removed"` or `"changed"`, under the same rule as
 *   `CatalogChange`: a `changed` record has a specifier on both sides, and
 *   either the specifier differs or both resolved versions are known and
 *   differ.
 *
 * @public
 */
export class ImporterChange extends Schema.Class<ImporterChange>("ImporterChange")(
	Schema.Struct({
		/** The importer path, `"."` for the workspace root. */
		importer: Schema.NonEmptyString,
		/** The dependency's package name. */
		name: Schema.NonEmptyString,
		/** The dependency section that declares it. */
		depType: DependencyField,
		/** The declared specifier before and after; absent on the side without the dependency. */
		specifier: SpecifierSides,
		/** The resolved version before and after; absent where it could not be resolved. */
		version: StringSides,
		/** Whether the dependency was added, removed or changed. */
		kind: ChangeKind,
	}).check(
		Schema.makeFilter((change) =>
			kindMatchesSides({
				kind: change.kind,
				specifier: {
					...(change.specifier.before !== undefined ? { before: change.specifier.before.raw } : {}),
					...(change.specifier.after !== undefined ? { after: change.specifier.after.raw } : {}),
				},
				version: change.version,
			}),
		),
	),
) {}

// ── Version resolution ─────────────────────────────────────────────────────

/** A lockfile plus the index its version lookups need, built once per compare. */
interface Resolver {
	readonly lockfile: Lockfile;
	/** Workspace package row by importer path, first wins. */
	readonly workspaceRows: ReadonlyMap<string, ResolvedPackage>;
}

const makeResolver = (lockfile: Lockfile): Resolver => {
	const workspaceRows = new Map<string, ResolvedPackage>();
	for (const pkg of lockfile.packages) {
		if (pkg.isWorkspace && pkg.relativePath !== undefined && !workspaceRows.has(pkg.relativePath)) {
			workspaceRows.set(pkg.relativePath, pkg);
		}
	}
	return { lockfile, workspaceRows };
};

/**
 * The version one importer dependency resolved to, or `undefined` when the
 * lockfile does not let it be resolved.
 *
 * pnpm records the version on the importer dependency itself. bun and npm
 * record it on the package entry the importer resolved to, so it is read
 * through the importer's own resolved edge: a workspace importer's row
 * carries those edges in `resolved`, and the root importer, which has no row,
 * resolves at the top of the format's own key scheme (`node_modules/<name>`
 * for npm, `<name>` for bun) — the same first step the parsers' positional
 * walks take from the root. yarn records no importers.
 */
const importerVersion = (resolver: Resolver, importer: string, dep: ImporterDependency): string | undefined => {
	const { lockfile } = resolver;
	if (lockfile.format === "pnpm") return dep.version;
	if (lockfile.format !== "npm" && lockfile.format !== "bun") return undefined;
	let target: string | undefined;
	if (importer === ".") {
		target = lockfile.format === "npm" ? `node_modules/${dep.name}` : dep.name;
	} else {
		const row = resolver.workspaceRows.get(importer);
		target = row !== undefined && Object.hasOwn(row.resolved, dep.name) ? row.resolved[dep.name] : undefined;
	}
	if (target === undefined) return undefined;
	return Option.getOrUndefined(Option.map(lockfile.packageByInstanceId(target), (pkg) => pkg.version));
};

// ── Catalog normalization ──────────────────────────────────────────────────

interface CatalogEntry {
	readonly specifier: string;
	/** The version the lockfile records on the entry itself (pnpm's `{ specifier, version }` form). */
	readonly recordedVersion: string | undefined;
}

interface Consumer {
	readonly importer: string;
	readonly dep: ImporterDependency;
}

/**
 * The raw catalog sections of a lockfile, default catalog under `"default"`.
 * pnpm keys the default catalog `"default"` already; bun splits it into its
 * own unnamed `catalog` section, folded back in here (a named `default` in
 * `catalogs` replaces it). npm and yarn record no catalogs.
 */
const rawCatalogs = (lockfile: Lockfile): ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> => {
	const ext = lockfile.extension;
	if (ext?._tag === "pnpm") return Object.entries(ext.catalogs ?? {});
	if (ext?._tag === "bun") {
		const sections = new Map<string, Readonly<Record<string, unknown>>>();
		if (ext.catalog !== undefined) sections.set("default", ext.catalog);
		for (const [name, entries] of Object.entries(ext.catalogs ?? {})) sections.set(name, entries);
		return [...sections];
	}
	return [];
};

/**
 * Read one raw catalog value: a bare specifier string (bun, and pnpm's
 * version-string form), or a `{ specifier, version? }` object (pnpm). Any
 * other shape is not a catalog entry and is skipped rather than cast.
 */
const readCatalogEntry = (raw: unknown): CatalogEntry | undefined => {
	if (typeof raw === "string") return { specifier: raw, recordedVersion: undefined };
	if (typeof raw !== "object" || raw === null || !Object.hasOwn(raw, "specifier")) return undefined;
	const { specifier, version } = raw as { readonly specifier: unknown; readonly version?: unknown };
	if (typeof specifier !== "string") return undefined;
	return { specifier, recordedVersion: typeof version === "string" ? version : undefined };
};

const normalizeCatalogs = (lockfile: Lockfile): ReadonlyMap<string, ReadonlyMap<string, CatalogEntry>> => {
	const out = new Map<string, Map<string, CatalogEntry>>();
	for (const [catalog, entries] of rawCatalogs(lockfile)) {
		if (catalog === "") continue;
		const normalized = new Map<string, CatalogEntry>();
		for (const [name, raw] of Object.entries(entries)) {
			if (name === "") continue;
			const entry = readCatalogEntry(raw);
			if (entry !== undefined) normalized.set(name, entry);
		}
		out.set(catalog, normalized);
	}
	return out;
};

/** The catalog a specifier references, `"default"` for the bare `catalog:`; `undefined` when it is no catalog reference. */
const catalogOf = (dep: ImporterDependency): string | undefined =>
	dep.specifier._tag === "catalog" ? Option.getOrElse(dep.specifier.name, () => "default") : undefined;

/** Catalog consumers by catalog, then package name. */
const catalogConsumers = (lockfile: Lockfile): ReadonlyMap<string, ReadonlyMap<string, ReadonlyArray<Consumer>>> => {
	const out = new Map<string, Map<string, Array<Consumer>>>();
	for (const importer of lockfile.importers) {
		for (const dep of importer.dependencies) {
			const catalog = catalogOf(dep);
			if (catalog === undefined) continue;
			let byName = out.get(catalog);
			if (byName === undefined) {
				byName = new Map();
				out.set(catalog, byName);
			}
			const bucket = byName.get(dep.name);
			if (bucket === undefined) byName.set(dep.name, [{ importer: importer.path, dep }]);
			else bucket.push({ importer: importer.path, dep });
		}
	}
	return out;
};

/**
 * The version a catalog entry resolved to on one side.
 *
 * In order: the version the entry itself records (pnpm); else the single
 * version every consumer whose version resolves agrees on (bun, where the
 * catalog records only a specifier); else, when no consumer resolves at all,
 * the package's version if the lockfile holds exactly one non-workspace
 * version of it. Consumers that disagree, or a name the lockfile resolves to
 * several versions, give `undefined` — an ambiguous join is not a version.
 */
const catalogVersion = (
	resolver: Resolver,
	name: string,
	entry: CatalogEntry,
	consumers: ReadonlyArray<Consumer>,
): string | undefined => {
	if (entry.recordedVersion !== undefined) return entry.recordedVersion;
	const seen = new Set<string>();
	for (const consumer of consumers) {
		const version = importerVersion(resolver, consumer.importer, consumer.dep);
		if (version !== undefined) seen.add(version);
	}
	if (seen.size === 1) return [...seen][0];
	if (seen.size > 1) return undefined;
	const versions = new Set(
		resolver.lockfile
			.packagesNamed(name)
			.filter((pkg) => !pkg.isWorkspace)
			.map((pkg) => pkg.version),
	);
	return versions.size === 1 ? [...versions][0] : undefined;
};

const sides = (before: string | undefined, after: string | undefined): { before?: string; after?: string } => ({
	...(before !== undefined ? { before } : {}),
	...(after !== undefined ? { after } : {}),
});

/** Code-unit order, so the result does not depend on the host's locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const NO_CONSUMERS: ReadonlyArray<Consumer> = [];

const diffCatalogs = (before: Resolver, after: Resolver): ReadonlyArray<CatalogChange> => {
	const beforeCatalogs = normalizeCatalogs(before.lockfile);
	const afterCatalogs = normalizeCatalogs(after.lockfile);
	const beforeConsumers = catalogConsumers(before.lockfile);
	const afterConsumers = catalogConsumers(after.lockfile);

	const changes: Array<CatalogChange> = [];
	const catalogs = [...new Set([...beforeCatalogs.keys(), ...afterCatalogs.keys()])].sort(byCodeUnit);
	for (const catalog of catalogs) {
		const beforeEntries = beforeCatalogs.get(catalog);
		const afterEntries = afterCatalogs.get(catalog);
		const names = [...new Set([...(beforeEntries?.keys() ?? []), ...(afterEntries?.keys() ?? [])])].sort(byCodeUnit);
		for (const name of names) {
			const beforeEntry = beforeEntries?.get(name);
			const afterEntry = afterEntries?.get(name);
			const beforeUsers = beforeConsumers.get(catalog)?.get(name) ?? NO_CONSUMERS;
			const afterUsers = afterConsumers.get(catalog)?.get(name) ?? NO_CONSUMERS;
			const beforeVersion =
				beforeEntry === undefined ? undefined : catalogVersion(before, name, beforeEntry, beforeUsers);
			const afterVersion = afterEntry === undefined ? undefined : catalogVersion(after, name, afterEntry, afterUsers);

			let kind: Kind;
			if (beforeEntry === undefined) kind = "added";
			else if (afterEntry === undefined) kind = "removed";
			else {
				const versionMoved =
					beforeVersion !== undefined && afterVersion !== undefined && beforeVersion !== afterVersion;
				if (beforeEntry.specifier === afterEntry.specifier && !versionMoved) continue;
				kind = "changed";
			}

			// A removed entry is referenced by nobody afterwards, so its consumers
			// are the ones that referenced it before.
			const users = kind === "removed" ? beforeUsers : afterUsers;
			changes.push(
				CatalogChange.make({
					catalog,
					name,
					specifier: sides(beforeEntry?.specifier, afterEntry?.specifier),
					version: sides(beforeVersion, afterVersion),
					kind,
					consumers: users.map((user) => ({ importer: user.importer, depType: user.dep.depType })),
				}),
			);
		}
	}
	return changes;
};

// ── Importer comparison ────────────────────────────────────────────────────

const depTypeOrder = (field: DependencyField): number => DEP_TYPES.indexOf(field);

/** Dependencies keyed by name, then section, so one name in two sections compares section by section. */
const keyDependencies = (
	lockfile: Lockfile,
): ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<DependencyField, ImporterDependency>>> => {
	const out = new Map<string, Map<string, Map<DependencyField, ImporterDependency>>>();
	for (const importer of lockfile.importers) {
		let byName = out.get(importer.path);
		if (byName === undefined) {
			byName = new Map();
			out.set(importer.path, byName);
		}
		for (const dep of importer.dependencies) {
			let bySection = byName.get(dep.name);
			if (bySection === undefined) {
				bySection = new Map();
				byName.set(dep.name, bySection);
			}
			if (!bySection.has(dep.depType)) bySection.set(dep.depType, dep);
		}
	}
	return out;
};

const diffImporters = (before: Resolver, after: Resolver): ReadonlyArray<ImporterChange> => {
	const beforeDeps = keyDependencies(before.lockfile);
	const afterDeps = keyDependencies(after.lockfile);

	const changes: Array<ImporterChange> = [];
	const importers = [...new Set([...beforeDeps.keys(), ...afterDeps.keys()])].sort(byCodeUnit);
	for (const importer of importers) {
		const beforeNames = beforeDeps.get(importer);
		const afterNames = afterDeps.get(importer);
		const names = [...new Set([...(beforeNames?.keys() ?? []), ...(afterNames?.keys() ?? [])])].sort(byCodeUnit);
		for (const name of names) {
			const beforeSections = beforeNames?.get(name);
			const afterSections = afterNames?.get(name);
			const sections = [...new Set([...(beforeSections?.keys() ?? []), ...(afterSections?.keys() ?? [])])].sort(
				(a, b) => depTypeOrder(a) - depTypeOrder(b),
			);
			for (const depType of sections) {
				const beforeDep = beforeSections?.get(depType);
				const afterDep = afterSections?.get(depType);
				const beforeVersion = beforeDep === undefined ? undefined : importerVersion(before, importer, beforeDep);
				const afterVersion = afterDep === undefined ? undefined : importerVersion(after, importer, afterDep);

				let kind: Kind;
				if (beforeDep === undefined) kind = "added";
				else if (afterDep === undefined) kind = "removed";
				else {
					const versionMoved =
						beforeVersion !== undefined && afterVersion !== undefined && beforeVersion !== afterVersion;
					if (beforeDep.specifier.raw === afterDep.specifier.raw && !versionMoved) continue;
					kind = "changed";
				}

				changes.push(
					ImporterChange.make({
						importer,
						name,
						depType,
						specifier: {
							...(beforeDep !== undefined ? { before: beforeDep.specifier } : {}),
							...(afterDep !== undefined ? { after: afterDep.specifier } : {}),
						},
						version: sides(beforeVersion, afterVersion),
						kind,
					}),
				);
			}
		}
	}
	return changes;
};

// ── The diff ───────────────────────────────────────────────────────────────

/**
 * What moved between two lockfiles: catalog entries and importer
 * dependencies whose specifier or resolved version changed, or that were
 * added or removed.
 *
 * @remarks
 * - `catalogs` — every catalog entry that changed ({@link CatalogChange}),
 *   ordered by catalog name, then package name.
 * - `importers` — every importer dependency that changed
 *   ({@link ImporterChange}), ordered by importer path, then package name,
 *   then dependency section.
 *
 * Both are empty when nothing moved. Produced by {@link LockfileDiff.compare}.
 *
 * @public
 */
export class LockfileDiff extends Schema.Class<LockfileDiff>("LockfileDiff")({
	catalogs: Schema.Array(CatalogChange),
	importers: Schema.Array(ImporterChange),
}) {
	/**
	 * Compare two lockfiles over the normalized model — a total, pure function:
	 * no Effect, no error channel, no IO.
	 *
	 * @remarks
	 * The comparison reads the same model for every format, so one answer
	 * holds for pnpm, bun, npm and yarn. What differs between formats is where
	 * a resolved version is recorded, and that is normalized here:
	 *
	 * - **pnpm** records `{ specifier, version }` on each catalog entry and on
	 *   each importer dependency, so both versions are read directly.
	 * - **bun** and **npm** record resolved versions on package entries, not on
	 *   the catalog or the importer. An importer dependency's version is read
	 *   through the importer's resolved edge to its package entry. A bun
	 *   catalog entry's version is the one version its consumers resolved to;
	 *   with no consumer it is the package's version when the lockfile holds
	 *   exactly one, and absent when consumers disagree or the name resolves
	 *   to several versions. npm has no catalogs.
	 * - **yarn** records no importers and no catalogs, so two yarn lockfiles
	 *   always compare empty.
	 *
	 * An entry or dependency present on one side only is `added` or
	 * `removed`, including every dependency of an importer that appears or
	 * disappears whole. One present on both sides is `changed` when its
	 * specifier differs, or when its version resolves on both sides and
	 * differs. A version that resolves on one side only is reported but is not
	 * by itself a change, because an unresolved side is unknown, not
	 * different.
	 *
	 * A catalog bump therefore shows in `catalogs`, and also in `importers`
	 * for each consumer whose resolved version moved. To keep the two apart,
	 * filter `importers` on `specifier.after?._tag !== "catalog"`.
	 *
	 * Importers are matched by path and are unaffected by
	 * `Lockfile#withImporterNames`, so it does not matter whether either side
	 * was renamed first.
	 *
	 * @example
	 * ```typescript
	 * import { Lockfile, LockfileDiff } from "@effected/lockfiles";
	 * import { Effect } from "effect";
	 *
	 * declare const beforeText: string;
	 * declare const afterText: string;
	 *
	 * const program = Effect.gen(function* () {
	 *   const before = yield* Lockfile.parse(beforeText, { format: "pnpm" });
	 *   const after = yield* Lockfile.parse(afterText, { format: "pnpm" });
	 *   const diff = LockfileDiff.compare(before, after);
	 *   return diff.importers.map((change) => `${change.importer}: ${change.name} ${change.kind}`);
	 * });
	 * ```
	 *
	 * @param before - The lockfile before the change.
	 * @param after - The lockfile after the change.
	 * @returns The changes, empty when nothing moved.
	 */
	static compare(before: Lockfile, after: Lockfile): LockfileDiff {
		const beforeResolver = makeResolver(before);
		const afterResolver = makeResolver(after);
		return LockfileDiff.make({
			catalogs: diffCatalogs(beforeResolver, afterResolver),
			importers: diffImporters(beforeResolver, afterResolver),
		});
	}

	/** Whether anything moved: `false` exactly when both `catalogs` and `importers` are empty. */
	get hasChanges(): boolean {
		return this.catalogs.length > 0 || this.importers.length > 0;
	}
}
