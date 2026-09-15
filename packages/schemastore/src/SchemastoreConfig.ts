import { Predicate, Result, Schema } from "effect";
import { CatalogEntry } from "./CatalogEntry.js";
import type { DriftTolerance, OnDrift } from "./DriftPolicy.js";
import { DriftPolicy } from "./DriftPolicy.js";
import { HostedSchema, SCHEMASTORE_CATALOG_BASE, SCHEMASTORE_ID_BASE } from "./HostedSchema.js";
import { SchemaTarget } from "./SchemaTarget.js";
import type { SchemaLayout, SchemaVersion } from "./SchemaVersioning.js";
import { SchemaVersioning } from "./SchemaVersioning.js";

const ConfigBrand: unique symbol = Symbol.for("@effected/schemastore/SchemastoreConfig");

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
	 * The schema's hosted identity, when the application already holds one
	 * (to derive its `$schema` URL from). Supplies `baseUrl`, `versions`,
	 * `current` and `layout`, which must then not be spelled here, and its
	 * `name` must equal this entry's key.
	 */
	readonly hosted?: HostedSchema;
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

// Exhaustive over the union by construction: a member missing from the record
// is a compile error, so the literal list cannot drift from the exported type.
const members = <K extends string>(record: Record<K, null>): ReadonlyArray<K> => Object.keys(record) as Array<K>;

const DriftToleranceInput = Schema.Literals(members<DriftTolerance>({ strict: null, semantic: null, allow: null }));
const OnDriftInput = Schema.Literals(members<OnDrift>({ error: null, warn: null }));
const LayoutInput = Schema.Literals(members<SchemaLayout>({ flat: null, versioned: null }));

// Passed through by reference (a declaration validates but never rebuilds):
// the schema is a function at runtime, and the two option bags carry keys
// this module has no business enumerating.
const EffectSchemaInput = Schema.declare((u): u is Schema.Constraint => Schema.isSchema(u), {
	expected: "an Effect Schema",
});
const OptionsInput = Schema.declare((u): u is Readonly<Record<string, unknown>> => Predicate.isObject(u), {
	expected: "an object",
});

const CatalogBlockInput = Schema.Struct({
	description: Schema.String,
	fileMatch: Schema.NonEmptyArray(Schema.String),
});

const EntryInput = Schema.Struct({
	schema: EffectSchemaInput,
	hosted: Schema.optionalKey(Schema.instanceOf(HostedSchema, { expected: "a HostedSchema" })),
	versions: Schema.optionalKey(Schema.Array(Schema.String)),
	current: Schema.optionalKey(Schema.String),
	published: Schema.optionalKey(Schema.Boolean),
	baseUrl: Schema.optionalKey(Schema.String),
	layout: Schema.optionalKey(LayoutInput),
	drift: Schema.optionalKey(DriftToleranceInput),
	catalog: Schema.optionalKey(CatalogBlockInput),
	jsonSchema: Schema.optionalKey(OptionsInput),
	rootAnnotations: Schema.optionalKey(OptionsInput),
});

const ConfigInput = Schema.Struct({
	outputDir: Schema.NonEmptyString,
	baseUrl: Schema.optionalKey(Schema.String),
	drift: Schema.optionalKey(DriftToleranceInput),
	onDrift: Schema.optionalKey(OnDriftInput),
	catalogPath: Schema.optionalKey(Schema.NonEmptyString),
	schemas: Schema.Record(Schema.String, Schema.Unknown),
});

// A config is typed by a human, so an unknown key is a typo to report, not
// noise to drop; every issue is reported, on one line, under the caller's
// prefix.
const DECODE_OPTIONS = { onExcessProperty: "error", errors: "all" } as const;

const decodeOrThrow = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, prefix: string) =>
	Result.getOrThrowWith(
		Schema.decodeUnknownResult(schema)(input, DECODE_OPTIONS),
		(error) => new Error(`defineConfig: ${prefix}${error.message.replace(/\n\s*/g, " ")}`),
	);

type Entry = typeof EntryInput.Type;

// The identity an entry resolves to: its `hosted` value, else one built from
// the hand-spelled fields and the config default. Either way HostedSchema
// owns the hosting and version rules, so the two spellings cannot diverge.
const resolveIdentity = (name: string, entry: Entry, defaultBaseUrl: string | undefined): HostedSchema => {
	if (entry.hosted !== undefined) {
		if (entry.hosted.name !== name) {
			return fail(`schema "${name}" is keyed differently from its hosted identity "${entry.hosted.name}"`);
		}
		const spelled = (["baseUrl", "versions", "current", "layout"] as const).filter((key) => entry[key] !== undefined);
		if (spelled.length > 0) {
			return fail(
				`schema "${name}" declares ${spelled.map((key) => `"${key}"`).join(", ")} beside hosted; the hosted identity owns them`,
			);
		}
		return entry.hosted;
	}
	const baseUrl = entry.baseUrl ?? defaultBaseUrl;
	if (baseUrl === undefined) {
		return fail(`schema "${name}" has no baseUrl and the config declares no default`);
	}
	const decoded = Schema.decodeUnknownResult(HostedSchema)({
		name,
		baseUrl,
		...(entry.versions !== undefined ? { versions: entry.versions } : {}),
		...(entry.current !== undefined ? { current: entry.current } : {}),
		...(entry.layout !== undefined ? { layout: entry.layout } : {}),
	});
	return Result.getOrThrowWith(decoded, (error) => new Error(`defineConfig: ${error.message.replace(/\n\s*/g, " ")}`));
};

const resolveEntry = (
	name: string,
	input: unknown,
	defaults: { readonly baseUrl: string | undefined; readonly drift: DriftTolerance },
	outputDir: string,
): ResolvedSchema => {
	if (!SchemaVersioning.isSimpleName(name)) {
		return fail(`schema "${name}" must be keyed by a simple file base name (no separators, no whitespace)`);
	}
	const entry = decodeOrThrow(EntryInput, input, `schema "${name}" `);
	const hosted = resolveIdentity(name, entry, defaults.baseUrl);
	if (hosted.baseUrl === "schemastore" && entry.catalog === undefined) {
		return fail(`schema "${name}" must declare a catalog block under baseUrl "schemastore"`);
	}
	const versions = hosted.resolvedVersions;
	const current = hosted.resolvedCurrent;
	const file = (version?: SchemaVersion) => `${outputDir}/${hosted.fileNameFor(version)}`;
	const generation = {
		...(entry.jsonSchema !== undefined ? { jsonSchema: entry.jsonSchema as Schema.ToJsonSchemaOptions } : {}),
		...(entry.rootAnnotations !== undefined ? { rootAnnotations: entry.rootAnnotations } : {}),
	};
	const target =
		current === undefined
			? SchemaTarget.make({
					schema: entry.schema,
					$id: hosted.idFor(current),
					name,
					path: file(current),
					published: entry.published ?? false,
					...generation,
				})
			: SchemaTarget.make({
					schema: entry.schema,
					$id: hosted.idFor(current),
					name,
					path: file(current),
					version: current,
					published: entry.published ?? false,
					...generation,
				});
	const frozen: ReadonlyArray<FrozenVersion> = versions
		.filter((v) => v !== current)
		.map((version) => ({ version, path: file(version), url: hosted.urlFor(version) }));
	const catalog =
		entry.catalog === undefined
			? undefined
			: CatalogEntry.assemble({
					name,
					description: entry.catalog.description,
					fileMatch: entry.catalog.fileMatch,
					baseUrl: hosted.catalogBase,
					layout: hosted.resolvedLayout,
					...(current !== undefined ? { versions, current } : {}),
				});
	return {
		name,
		target,
		frozen,
		drift: entry.drift ?? defaults.drift,
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
 * Throws a plain `Error` (never a raw `TypeError`) on every malformed
 * input. The shape is decoded once per level with a `Schema.Struct`
 * (`errors: "all"`, so every issue on an entry is reported at once, and
 * `onExcessProperty: "error"`, so a typo'd key is named rather than
 * dropped); the message is `defineConfig: schema "<name>" ` followed by the
 * decode issues (`Expected string at ["baseUrl"]`). After a shape-clean
 * decode the cross-field rules run: the entry's identity — its
 * {@link HostedSchema}, or one built from `baseUrl`/`versions`/`current`/
 * `layout` and the config default — is validated by `HostedSchema` itself
 * (a `hosted` entry must be keyed by `hosted.name` and must not spell those
 * four fields beside it); a schema key must be a simple file base name; a
 * `catalog` is required under `baseUrl: "schemastore"`; an empty `schemas`
 * record is rejected; and an output path (a target, a frozen file, or the
 * catalog path) declared twice is rejected after a lexical normalisation
 * (`./`, `..`, trailing `/`) — the CLI's loader re-checks on the resolved
 * absolute paths. Branding the result lets a loader recognise a config
 * module's default export via {@link isSchemastoreConfig}.
 *
 * @public
 */
export const defineConfig = (input: SchemastoreConfigInput): SchemastoreConfig => {
	if (!Predicate.isObject(input)) {
		return fail("expected a config object");
	}
	const config = decodeOrThrow(ConfigInput, input, "");
	const outputDir = trimSlashes(config.outputDir);
	if (Object.keys(config.schemas).length === 0) {
		return fail("at least one schema is required");
	}
	// Validated once here, even when every entry overrides it.
	const defaults = { baseUrl: config.baseUrl, drift: config.drift ?? DriftPolicy.defaults.policy };
	const schemas = Object.entries(config.schemas).map(([name, entry]) => resolveEntry(name, entry, defaults, outputDir));
	const catalogPath = config.catalogPath ?? `${outputDir}/catalog.json`;
	assertUniquePaths([...schemas.flatMap((s) => [s.target.path, ...s.frozen.map((f) => f.path)]), catalogPath]);
	return {
		[ConfigBrand]: true,
		outputDir,
		onDrift: config.onDrift ?? DriftPolicy.defaults.onDrift,
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
