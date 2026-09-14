import { Schema } from "effect";
import { CatalogEntry } from "./CatalogEntry.js";
import type { DriftOptions } from "./DriftPolicy.js";
import { DriftPolicy } from "./DriftPolicy.js";
import type { SchemaTarget } from "./SchemaTarget.js";
import type { SchemaVersion } from "./SchemaVersioning.js";
import { SchemaVersioning } from "./SchemaVersioning.js";

const ConfigBrand: unique symbol = Symbol.for("@effected/schemastore/SchemastoreConfig");

/**
 * One catalog entry a `schemastore.config.ts` declares: the SchemaStore
 * `catalog.json` fields plus where to write the assembled entry. The entry's
 * `versions` and `url` are derived by {@link defineConfig} from every
 * versioned schema of the same `name`.
 *
 * @public
 */
export interface CatalogConfig {
	readonly name: string;
	readonly description: string;
	readonly fileMatch: ReadonlyArray<string>;
	readonly baseUrl: string;
	/** Where to write the assembled entry; relative paths are resolved by the loader against the config file's directory. */
	readonly path: string;
}

/**
 * What a `schemastore.config.ts` hands to {@link defineConfig}: the schema
 * targets, an optional catalog block and an optional partial drift block.
 *
 * @public
 */
export interface SchemastoreConfigInput {
	readonly schemas: ReadonlyArray<SchemaTarget>;
	readonly catalog?: ReadonlyArray<CatalogConfig>;
	readonly drift?: Partial<DriftOptions>;
}

/**
 * A validated catalog declaration paired with the `CatalogEntry` assembled
 * from it.
 *
 * @public
 */
export interface CatalogTarget {
	readonly config: CatalogConfig;
	readonly entry: CatalogEntry;
}

/**
 * The validated, defaults-filled config {@link defineConfig} answers and the
 * CLI consumes. Recognisable via {@link isSchemastoreConfig}.
 *
 * @public
 */
export interface SchemastoreConfig {
	readonly [ConfigBrand]: true;
	readonly schemas: ReadonlyArray<SchemaTarget>;
	readonly catalog: ReadonlyArray<CatalogTarget>;
	readonly drift: DriftOptions;
}

const DriftSchema = Schema.Struct({
	policy: Schema.optionalKey(Schema.Literals(["strict", "semantic", "allow"])),
	onDrift: Schema.optionalKey(Schema.Literals(["error", "warn"])),
});

const CatalogConfigSchema = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1)),
	description: Schema.String,
	fileMatch: Schema.Array(Schema.String),
	baseUrl: Schema.String.check(Schema.isMinLength(1)),
	path: Schema.String.check(Schema.isMinLength(1)),
});

const decodeOrThrow = <S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	value: unknown,
	what: string,
): S["Type"] => {
	const result = Schema.decodeUnknownResult(schema)(value);
	if (result._tag === "Failure") {
		throw new Error(`defineConfig: invalid ${what}: ${String(result.failure)}`);
	}
	return result.success;
};

const versionsByName = (schemas: ReadonlyArray<SchemaTarget>): ReadonlyMap<string, ReadonlyArray<SchemaVersion>> => {
	const map = new Map<string, Array<SchemaVersion>>();
	for (const target of schemas) {
		if (target.name === undefined || target.version === undefined) {
			continue;
		}
		const version = target.version;
		const versions = map.get(target.name) ?? [];
		const duplicate = versions.find((v) => SchemaVersioning.Order(v, version) === 0);
		if (duplicate !== undefined) {
			throw new Error(
				`defineConfig: schema "${target.name}" declares the same version twice, as "${duplicate}" and "${version}"`,
			);
		}
		versions.push(version);
		map.set(target.name, versions);
	}
	return map;
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

const assertUniquePaths = (schemas: ReadonlyArray<SchemaTarget>, catalog: ReadonlyArray<CatalogConfig>): void => {
	const seen = new Set<string>();
	for (const p of [...schemas.map((target) => target.path), ...catalog.map((entry) => entry.path)]) {
		const normalized = normalizePath(p);
		if (seen.has(normalized)) {
			throw new Error(`defineConfig: output path "${p}" is declared twice`);
		}
		seen.add(normalized);
	}
};

/**
 * Validate and assemble a `schemastore.config.ts` value.
 *
 * @remarks
 * Pure: no IO, no Effect. Identity-with-validation over the input, filling
 * drift defaults, deriving each catalog entry's `versions` from EVERY
 * versioned schema of that name (published or not — the entry is what gets
 * submitted to become published), and branding the result so a loader can
 * recognise a config module's default export. Throws a plain `Error` on a
 * bad input; the CLI wraps it into its typed config-load error. Rejects an
 * output `path` declared twice across schemas and catalog entries, compared
 * after a lexical normalisation (`./`, `..`, trailing `/`); the CLI's loader
 * re-checks on the resolved absolute paths.
 *
 * @public
 */
export const defineConfig = (input: SchemastoreConfigInput): SchemastoreConfig => {
	if (!Array.isArray(input.schemas) || input.schemas.length === 0) {
		throw new Error("defineConfig: at least one schema is required");
	}
	const drift = decodeOrThrow(DriftSchema, input.drift ?? {}, "drift block");
	const versions = versionsByName(input.schemas);
	const catalog = (input.catalog ?? []).map((raw) => {
		const config = decodeOrThrow(
			CatalogConfigSchema,
			raw,
			`catalog entry "${String((raw as { name?: unknown }).name)}"`,
		);
		const found = versions.get(config.name);
		if (found === undefined) {
			throw new Error(`defineConfig: catalog entry "${config.name}" matches no versioned schema`);
		}
		const entry = CatalogEntry.assemble({
			name: config.name,
			description: config.description,
			fileMatch: config.fileMatch,
			baseUrl: config.baseUrl,
			versions: found,
		});
		return { config, entry };
	});
	assertUniquePaths(
		input.schemas,
		catalog.map((c) => c.config),
	);
	return {
		[ConfigBrand]: true,
		schemas: input.schemas,
		catalog,
		drift: {
			policy: drift.policy ?? DriftPolicy.defaults.policy,
			onDrift: drift.onDrift ?? DriftPolicy.defaults.onDrift,
		},
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
