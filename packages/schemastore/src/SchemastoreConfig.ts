import { Option, Predicate, Result, Schema } from "effect";
import { CatalogEntry } from "./CatalogEntry.js";
import type { DriftTolerance, OnDrift } from "./DriftPolicy.js";
import { DriftPolicy } from "./DriftPolicy.js";
import { SchemaTarget } from "./SchemaTarget.js";
import type { SchemaLayout, SchemaVersion } from "./SchemaVersioning.js";
import { SchemaVersioning } from "./SchemaVersioning.js";

const ConfigBrand: unique symbol = Symbol.for("@effected/schemastore/SchemastoreConfig");

/** The host SchemaStore-hosted documents declare in `$id`. @public */
export const SCHEMASTORE_ID_BASE = "https://json.schemastore.org";
/** The host SchemaStore's `catalog.json` points `url` at. @public */
export const SCHEMASTORE_CATALOG_BASE = "https://www.schemastore.org";

/**
 * The SchemaStore `catalog.json` fields a schema entry declares, minus
 * `url`/`versions` — those are derived from the entry's `baseUrl`, `layout`
 * and `versions`/`current` by {@link defineConfig}, so they cannot disagree
 * with the schema's own identity.
 *
 * @public
 */
export interface CatalogInput {
	/** The catalog description. */
	readonly description: string;
	/** Glob patterns editors match files against; must be non-empty. */
	readonly fileMatch: ReadonlyArray<string>;
}

/**
 * One schema a `schemastore.config.ts` declares, keyed by its own file base
 * name in {@link SchemastoreConfigInput.schemas}. `$id`, the write `path` and
 * every catalog URL are derived from `outputDir`, `baseUrl` (this entry's, or
 * the config's default) and `layout` — never spelled out by hand.
 *
 * @public
 */
export interface SchemaEntryInput {
	/** The Effect Schema source the document is generated from. */
	readonly schema: Schema.Constraint;
	/**
	 * Every version label this schema advertises. Omit for an unversioned
	 * schema (`<name>.json`). An empty array is rejected — omit the field
	 * instead. Two labels that compare equal under
	 * {@link SchemaVersioning.Order} (`"1.2"` and `"1.2.0"`) are rejected as
	 * one version spelled twice.
	 */
	readonly versions?: ReadonlyArray<string>;
	/**
	 * Which of `versions` is the one generated at this entry's `path`/`$id`;
	 * the rest become {@link ResolvedSchema.frozen} files the CLI verifies
	 * but does not regenerate. Defaults to the newest label under
	 * {@link SchemaVersioning.Order}. Requires `versions`, and must name one
	 * of them.
	 */
	readonly current?: string;
	/**
	 * Whether a consumer already depends on this document at this label —
	 * forwarded to {@link (SchemaTarget:class).(make:1)}. Defaults to `false`.
	 */
	readonly published?: boolean;
	/**
	 * Where this schema is hosted: the literal `"schemastore"` (the only
	 * value that expands `$id` to {@link SCHEMASTORE_ID_BASE} and the catalog
	 * URL to {@link SCHEMASTORE_CATALOG_BASE}, and forces the `"flat"`
	 * layout) or an `https://` URL used as ONE base for both `$id` and the
	 * catalog URL. Falls back to {@link SchemastoreConfigInput.baseUrl} when
	 * omitted; an entry with neither is rejected.
	 */
	readonly baseUrl?: string;
	/**
	 * How a versioned document's path/URL nests relative to its base — see
	 * {@link SchemaLayout}. Defaults to `"versioned"` for a custom `baseUrl`,
	 * and is rejected outright under `baseUrl: "schemastore"`, which serves
	 * only the flat layout.
	 */
	readonly layout?: SchemaLayout;
	/** Overrides {@link SchemastoreConfigInput.drift} for this schema. */
	readonly drift?: DriftTolerance;
	/**
	 * The catalog entry to assemble for this schema. Required under
	 * `baseUrl: "schemastore"` (every SchemaStore-hosted document is
	 * cataloged); optional under a custom host.
	 */
	readonly catalog?: CatalogInput;
	/** Forwarded to {@link (SchemaTarget:class).(make:1)}'s `jsonSchema`. */
	readonly jsonSchema?: Schema.ToJsonSchemaOptions;
	/** Forwarded to {@link (SchemaTarget:class).(make:1)}'s `rootAnnotations`. */
	readonly rootAnnotations?: Readonly<Record<string, unknown>>;
}

/**
 * What a `schemastore.config.ts` hands to {@link defineConfig}: a directory
 * every derived path is written under, top-level defaults for `baseUrl` and
 * `drift`, and the keyed set of schemas to derive.
 *
 * @public
 */
export interface SchemastoreConfigInput {
	/** The directory every derived `path` is written under; a trailing slash is trimmed. */
	readonly outputDir: string;
	/** The default {@link SchemaEntryInput.baseUrl} for an entry that declares none. */
	readonly baseUrl?: string;
	/** The default {@link SchemaEntryInput.drift} for an entry that declares none. Defaults to `"semantic"`. */
	readonly drift?: DriftTolerance;
	/** What a build does when it finds drift. Defaults to `"error"`. */
	readonly onDrift?: OnDrift;
	/** Where the assembled catalog is written. Defaults to `<outputDir>/catalog.json`. */
	readonly catalogPath?: string;
	/**
	 * The schemas to derive, keyed by file base name — the key IS the
	 * `name` every derived path and URL is built from, so it must be a
	 * simple file base name (no separators, no whitespace).
	 */
	readonly schemas: Readonly<Record<string, SchemaEntryInput>>;
}

/**
 * One version of a schema that is advertised (via `versions`) but not the
 * one currently generated — a file the CLI verifies exists on disk before
 * any write (existence only — content is never compared), never
 * regenerates.
 *
 * @public
 */
export interface FrozenVersion {
	/** The frozen version label. */
	readonly version: SchemaVersion;
	/** The path the frozen file lives at. */
	readonly path: string;
	/** The catalog URL the frozen file is hosted at. */
	readonly url: string;
}

/**
 * One `defineConfig` schema entry, resolved: the {@link (SchemaTarget:interface)} to
 * generate, its frozen predecessor versions, its effective drift tolerance,
 * and its assembled catalog entry, if any.
 *
 * @public
 */
export interface ResolvedSchema {
	/** The schema's key in {@link SchemastoreConfigInput.schemas}. */
	readonly name: string;
	/** The target to generate at the current version (or the sole, unversioned target). */
	readonly target: SchemaTarget;
	/** Every OTHER advertised version, as a frozen file to verify. */
	readonly frozen: ReadonlyArray<FrozenVersion>;
	/** This entry's effective drift tolerance, after falling back to the config default. */
	readonly drift: DriftTolerance;
	/** The assembled catalog entry, when {@link SchemaEntryInput.catalog} was given. */
	readonly catalog?: CatalogEntry;
}

/**
 * The validated, defaults-filled config {@link defineConfig} answers and the
 * CLI consumes. Recognisable via {@link isSchemastoreConfig}.
 *
 * @public
 */
export interface SchemastoreConfig {
	readonly [ConfigBrand]: true;
	/** The directory every derived `path` is written under, trailing slash trimmed. */
	readonly outputDir: string;
	/** What a build does when it finds drift. */
	readonly onDrift: OnDrift;
	/** Where the assembled catalog is written. */
	readonly catalogPath: string;
	/** Every schema, resolved. */
	readonly schemas: ReadonlyArray<ResolvedSchema>;
}

const DRIFT_TOLERANCES: ReadonlyArray<DriftTolerance> = ["strict", "semantic", "allow"];
const ON_DRIFT: ReadonlyArray<OnDrift> = ["error", "warn"];
const LAYOUTS: ReadonlyArray<SchemaLayout> = ["flat", "versioned"];

const fail = (message: string): never => {
	throw new Error(`defineConfig: ${message}`);
};

const trimSlashes = (dir: string): string => {
	let end = dir.length;
	while (end > 1 && dir.charCodeAt(end - 1) === 47) {
		end -= 1;
	}
	return dir.slice(0, end);
};

// Where a document is hosted decides both of its bases and its layout.
interface Hosting {
	readonly idBase: string;
	readonly catalogBase: string;
	readonly layout: SchemaLayout;
}

const resolveHosting = (name: string, baseUrl: string | undefined, layout: SchemaLayout | undefined): Hosting => {
	if (baseUrl === undefined) {
		return fail(`schema "${name}" has no baseUrl and the config declares no default`);
	}
	if (typeof baseUrl !== "string") {
		return fail(`schema "${name}" has a baseUrl that is not a string`);
	}
	if (baseUrl.length === 0) {
		return fail(`schema "${name}" has no baseUrl and the config declares no default`);
	}
	if (layout !== undefined && !LAYOUTS.includes(layout)) {
		return fail(`schema "${name}" has an invalid layout "${String(layout)}"; expected "flat" or "versioned"`);
	}
	if (baseUrl === "schemastore") {
		if (layout !== undefined) {
			return fail(
				`schema "${name}" declares layout "${layout}" under baseUrl "schemastore", which serves only the flat layout`,
			);
		}
		return { idBase: SCHEMASTORE_ID_BASE, catalogBase: SCHEMASTORE_CATALOG_BASE, layout: "flat" };
	}
	if (!baseUrl.startsWith("https://") || baseUrl.length === "https://".length) {
		return fail(`schema "${name}" has baseUrl "${baseUrl}"; expected "schemastore" or an https:// URL`);
	}
	return { idBase: baseUrl, catalogBase: baseUrl, layout: layout ?? "versioned" };
};

const parseLabel = (name: string, label: unknown): SchemaVersion => {
	if (typeof label !== "string") {
		return fail(`schema "${name}" has a version label that is not a string: ${String(label)}`);
	}
	return Result.getOrThrowWith(
		SchemaVersioning.parseResult(label),
		(error) => new Error(`defineConfig: schema "${name}" has an invalid version label "${label}": ${error.message}`),
	);
};

// Every label, deduplicated under Order (`1.2` / `1.2.0` are one label), plus
// which one is current: the explicit label, else the newest.
const resolveVersions = (
	name: string,
	entry: SchemaEntryInput,
): { readonly versions: ReadonlyArray<SchemaVersion>; readonly current: SchemaVersion } | undefined => {
	if (entry.versions === undefined) {
		if (entry.current !== undefined) {
			return fail(`schema "${name}" declares current "${entry.current}" without versions`);
		}
		return undefined;
	}
	if (!Array.isArray(entry.versions)) {
		return fail(`schema "${name}" declares versions that is not an array`);
	}
	if (entry.versions.length === 0) {
		return fail(`schema "${name}" declares versions as an empty array; omit versions for an unversioned schema`);
	}
	const versions: Array<SchemaVersion> = [];
	for (const label of entry.versions) {
		const version = parseLabel(name, label);
		const duplicate = versions.find((v) => SchemaVersioning.Order(v, version) === 0);
		if (duplicate !== undefined) {
			return fail(`schema "${name}" declares the same version twice, as "${duplicate}" and "${version}"`);
		}
		versions.push(version);
	}
	// Non-empty by the guard above, so `latest` is always `some`.
	const newest = Option.getOrThrow(SchemaVersioning.latest(versions));
	if (entry.current === undefined) {
		return { versions, current: newest };
	}
	const current = parseLabel(name, entry.current);
	const match = versions.find((v) => SchemaVersioning.Order(v, current) === 0);
	if (match === undefined) {
		return fail(`schema "${name}" declares current "${entry.current}" which is not one of its versions`);
	}
	return { versions, current: match };
};

const isDriftTolerance = (value: unknown): value is DriftTolerance =>
	DRIFT_TOLERANCES.includes(value as DriftTolerance);

// The top-level default every schema inherits.
const resolveConfigDrift = (value: unknown): DriftTolerance => {
	if (value === undefined) {
		return DriftPolicy.defaults.policy;
	}
	return isDriftTolerance(value) ? value : fail(`config has an invalid drift tolerance "${String(value)}"`);
};

// One schema's tolerance: its own override, else the config default.
const resolveSchemaDrift = (name: string, value: unknown, fallback: DriftTolerance): DriftTolerance => {
	if (value === undefined) {
		return fallback;
	}
	return isDriftTolerance(value) ? value : fail(`schema "${name}" has an invalid drift tolerance "${String(value)}"`);
};

const resolveEntry = (
	name: string,
	entry: SchemaEntryInput,
	defaults: { readonly baseUrl: string | undefined; readonly drift: DriftTolerance },
	outputDir: string,
): ResolvedSchema => {
	if (!SchemaVersioning.isSimpleName(name)) {
		return fail(`schema "${name}" must be keyed by a simple file base name (no separators, no whitespace)`);
	}
	if (!Predicate.isObject(entry)) {
		return fail(`schema "${name}" must be an object`);
	}
	if (!Schema.isSchema(entry.schema)) {
		return fail(`schema "${name}" has a schema that is not an Effect Schema`);
	}
	if (entry.published !== undefined && typeof entry.published !== "boolean") {
		return fail(`schema "${name}" has a published that is not a boolean`);
	}
	const baseUrl = entry.baseUrl ?? defaults.baseUrl;
	const hosting = resolveHosting(name, baseUrl, entry.layout);
	const versioned = resolveVersions(name, entry);
	if (baseUrl === "schemastore" && entry.catalog === undefined) {
		return fail(`schema "${name}" must declare a catalog block under baseUrl "schemastore"`);
	}
	if (
		entry.catalog !== undefined &&
		(!Predicate.isObject(entry.catalog) ||
			!Array.isArray(entry.catalog.fileMatch) ||
			typeof entry.catalog.description !== "string")
	) {
		return fail(`schema "${name}" declares an invalid catalog block (expected { description, fileMatch[] })`);
	}
	if (entry.catalog !== undefined && entry.catalog.fileMatch.length === 0) {
		return fail(`schema "${name}" declares a catalog with an empty fileMatch`);
	}
	const file = (version?: SchemaVersion) => `${outputDir}/${SchemaVersioning.fileName(name, version, hosting.layout)}`;
	const urlOf = (base: string) => (version?: SchemaVersion) =>
		SchemaVersioning.schemaUrl(base, name, version, hosting.layout);
	const idOf = urlOf(hosting.idBase);
	const catalogUrlOf = urlOf(hosting.catalogBase);
	const current = versioned?.current;
	const target =
		current === undefined
			? SchemaTarget.make({
					schema: entry.schema,
					$id: idOf(current),
					name,
					path: file(current),
					published: entry.published ?? false,
					...(entry.jsonSchema !== undefined ? { jsonSchema: entry.jsonSchema } : {}),
					...(entry.rootAnnotations !== undefined ? { rootAnnotations: entry.rootAnnotations } : {}),
				})
			: SchemaTarget.make({
					schema: entry.schema,
					$id: idOf(current),
					name,
					path: file(current),
					version: current,
					published: entry.published ?? false,
					...(entry.jsonSchema !== undefined ? { jsonSchema: entry.jsonSchema } : {}),
					...(entry.rootAnnotations !== undefined ? { rootAnnotations: entry.rootAnnotations } : {}),
				});
	const frozen: ReadonlyArray<FrozenVersion> =
		versioned === undefined
			? []
			: versioned.versions
					.filter((v) => v !== versioned.current)
					.map((version) => ({ version, path: file(version), url: catalogUrlOf(version) }));
	const catalog =
		entry.catalog === undefined
			? undefined
			: CatalogEntry.assemble({
					name,
					description: entry.catalog.description,
					fileMatch: entry.catalog.fileMatch,
					baseUrl: hosting.catalogBase,
					layout: hosting.layout,
					...(versioned !== undefined ? { versions: versioned.versions, current: versioned.current } : {}),
				});
	return {
		name,
		target,
		frozen,
		drift: resolveSchemaDrift(name, entry.drift, defaults.drift),
		...(catalog !== undefined ? { catalog } : {}),
	};
};

// Lexical path normalisation, so two spellings of one output (`./a.json`,
// `x/../a.json`, `a.json/`) collide here rather than at write time. This is
// a pure module with no `Path` service, so it is a string walk, not
// `posix.normalize`: collapse `.` and empty segments, resolve `..` against
// a preceding segment, keep a leading `..` (or `/`) as-is. The loader
// re-checks on the absolute paths it resolves, which catches what a
// lexical pass cannot (`../x/a.json` versus `a.json` from another root).
const normalizePath = (raw: string): string => {
	const absolute = raw.startsWith("/");
	const out: Array<string> = [];
	for (const segment of raw.split("/")) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			if (out.length > 0 && out[out.length - 1] !== "..") {
				out.pop();
			} else if (!absolute) {
				out.push(segment);
			}
			continue;
		}
		out.push(segment);
	}
	return `${absolute ? "/" : ""}${out.join("/")}`;
};

const assertUniquePaths = (paths: ReadonlyArray<string>): void => {
	const seen = new Set<string>();
	for (const p of paths) {
		const normalized = normalizePath(p);
		if (seen.has(normalized)) {
			fail(`output path "${p}" is declared twice`);
		}
		seen.add(normalized);
	}
};

/**
 * Validate and assemble a `schemastore.config.ts` value.
 *
 * @remarks
 * Pure: no IO, no Effect. `$id`, the write `path` and every catalog URL are
 * derived from ONE layout (`outputDir`, `baseUrl` and `layout`) so they
 * cannot disagree with each other. `versions` names every label a schema
 * advertises; `current` (default: the newest under
 * {@link SchemaVersioning.Order}) is the one generated at `target`, and every
 * other label becomes a {@link FrozenVersion} the CLI verifies but does not
 * regenerate. `baseUrl: "schemastore"` expands to
 * {@link SCHEMASTORE_ID_BASE} for `$id` and {@link SCHEMASTORE_CATALOG_BASE}
 * for the catalog URL, forcing the `"flat"` layout; any other `baseUrl` is
 * used as one base for both, defaulting to the `"versioned"` layout.
 *
 * Throws a plain `Error` (never a raw `TypeError`) naming the offending
 * schema on: a non-object `input`; an empty `schemas` record; a
 * missing/empty `outputDir`; a schema key that is not a simple file base
 * name; a schema whose `schema` is not an Effect Schema; a schema with no
 * `baseUrl` anywhere, or a `baseUrl` that is not a string; a `baseUrl` that
 * is neither `"schemastore"` nor an `https://` URL; a `versions` that is not
 * an array, or an empty `versions` array; a version label (or `current`)
 * that is not a string, or an otherwise invalid version label; two labels
 * spelling the same version; `current` given without `versions`, or naming
 * one not among them; a non-boolean `published`; `layout` declared under
 * `baseUrl: "schemastore"`; a missing `catalog` under
 * `baseUrl: "schemastore"`, or one with an empty `fileMatch`; an invalid
 * `drift` or top-level `onDrift`; and an output path (a target, a frozen
 * file, or the catalog path) declared twice, compared after a lexical
 * normalisation (`./`, `..`, trailing `/`) — the CLI's loader re-checks on
 * the resolved absolute paths. Branding the result lets a loader recognise a
 * config module's default export via {@link isSchemastoreConfig}.
 *
 * @public
 */
export const defineConfig = (input: SchemastoreConfigInput): SchemastoreConfig => {
	if (!Predicate.isObject(input)) {
		return fail("expected a config object");
	}
	if (typeof input.outputDir !== "string" || input.outputDir.length === 0) {
		return fail("outputDir is required");
	}
	const outputDir = trimSlashes(input.outputDir);
	if (!Predicate.isObject(input.schemas) || Object.keys(input.schemas).length === 0) {
		return fail("at least one schema is required");
	}
	if (input.onDrift !== undefined && !ON_DRIFT.includes(input.onDrift)) {
		return fail(`invalid onDrift "${String(input.onDrift)}"`);
	}
	if (input.catalogPath !== undefined && (typeof input.catalogPath !== "string" || input.catalogPath.length === 0)) {
		return fail("catalogPath must be a non-empty string when given");
	}
	// Validated once here, even when every entry overrides it.
	const defaults = { baseUrl: input.baseUrl, drift: resolveConfigDrift(input.drift) };
	const schemas = Object.entries(input.schemas).map(([name, entry]) => resolveEntry(name, entry, defaults, outputDir));
	const catalogPath = input.catalogPath ?? `${outputDir}/catalog.json`;
	assertUniquePaths([...schemas.flatMap((s) => [s.target.path, ...s.frozen.map((f) => f.path)]), catalogPath]);
	return {
		[ConfigBrand]: true,
		outputDir,
		onDrift: input.onDrift ?? DriftPolicy.defaults.onDrift,
		catalogPath,
		schemas,
	};
};

/**
 * Whether a value is a config produced by {@link defineConfig} — the check a
 * loader runs on a config module's default export.
 *
 * @public
 */
export const isSchemastoreConfig = (value: unknown): value is SchemastoreConfig =>
	typeof value === "object" && value !== null && (value as Record<PropertyKey, unknown>)[ConfigBrand] === true;
