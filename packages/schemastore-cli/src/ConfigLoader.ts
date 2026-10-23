import type { SchemastoreConfig } from "@effected/schemastore";
import { CatalogEntry, SchemaVersioning, isSchemastoreConfig } from "@effected/schemastore";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { createJiti } from "jiti";
import { flattenSchemaError } from "./internal/decode.js";

/**
 * No `schemastore.config.*` was found — by upward discovery from the working
 * directory, or at the explicit path handed to `--config`.
 *
 * @public
 */
export class ConfigNotFoundError extends Schema.TaggedError<ConfigNotFoundError>()("ConfigNotFoundError", {
	/** The directories walked (discovery) or the one explicit path checked. */
	searched: Schema.Array(Schema.String),
}) {
	override get message(): string {
		return `No schemastore config found. Searched for ${ConfigLoader.CONFIG_NAMES.join(", ")} in: ${this.searched.join(", ")}`;
	}
}

/**
 * The config file exists but could not be turned into a `SchemastoreConfig`:
 * the module threw on import, its default export is not a `defineConfig(...)`
 * value, a field the pipeline reads is malformed (`name` not a simple file
 * base name, `outputDir`/`catalogDir` not a string, `onDrift` or a schema's
 * `drift` outside its literal set, a `schemas` element, its `target`,
 * `catalog` or a `frozen` entry not shaped — the catalog decoded as a whole
 * `CatalogEntry`, so a non-string `fileMatch` element or `versions` value
 * fails too — every such issue reported at once, each as
 * `<message> at <path>`), two outputs
 * resolve to one absolute path, a document resolves into `catalogDir`, or
 * `catalogDir` resolves to `outputDir` or to the merged catalog's path.
 *
 * @public
 */
export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("ConfigLoadError", {
	/** The config file that failed to load. */
	path: Schema.String,
	/** Why it failed; the first line is the message, any remainder is detail such as a stack. */
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to load schemastore config ${this.path}: ${this.reason}`;
	}
}

/**
 * A loaded config: where it came from and its contents with every relative
 * `path` (`outputDir`, `catalogDir`, each schema's current target, and every
 * frozen predecessor) resolved against `directory`.
 *
 * @public
 */
export interface LoadedConfig {
	/** The absolute path of the config file. */
	readonly path: string;
	/** The directory containing the config file; every relative path in `config` is resolved against it. */
	readonly directory: string;
	/** The config, with its paths resolved. */
	readonly config: SchemastoreConfig;
}

/**
 * Options for {@link ConfigLoader.load}.
 *
 * @public
 */
export interface ConfigLoadOptions {
	/** An explicit config path (`--config`), resolved against `cwd`. Skips discovery. */
	readonly explicit?: string;
	/** Where discovery starts and what `explicit` is resolved against. */
	readonly cwd: string;
	/**
	 * The module importer. Defaults to a `jiti` importer that transpiles the
	 * consumer's TypeScript in place; injectable so tests can hand in a module
	 * value without touching disk.
	 */
	readonly importModule?: (path: string) => Promise<unknown>;
}

// The config file is the resolution base, not this module: the consumer's
// `@effected/schemastore` (and its own relative sources) live next to the
// config, and the CLI's bundled location has no bearing on where they are.
const jitiImport = (path: string): Promise<unknown> => createJiti(path, { interopDefault: true }).import(path);

const describeCause = (cause: unknown): string =>
	cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

// `defineConfig` validates every field it can check by shape, but a
// hand-rolled module can forge the brand directly, skipping `defineConfig`
// entirely. The loader re-checks every field the pipeline and the drift
// policy dereference — `onDrift` and each schema's `drift` included, since a
// missing or bogus value there would quietly switch the drift gate off. A v4
// Schema value is callable (`typeof` says "function"), hence the
// `Schema.isSchema` declaration rather than an object check.
//
// The decode only VALIDATES: its output is discarded and the loaded config is
// the module's own export, because decoding would strip the symbol brand
// `isSchemastoreConfig` reads. Unknown keys are ignored (the default), so a
// live Schema value and the brand pass through untouched.
const ForgedConfigShape = Schema.Struct({
	name: Schema.String.check(
		Schema.makeFilter((name) => SchemaVersioning.isSimpleName(name) || "not a simple file base name"),
	),
	outputDir: Schema.String,
	onDrift: Schema.Literals(["error", "warn"]),
	catalogDir: Schema.String,
	schemas: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			target: Schema.Struct({
				schema: Schema.declare(Schema.isSchema, { expected: "an Effect Schema" }),
				$id: Schema.String,
				path: Schema.String,
				published: Schema.Boolean,
			}),
			frozen: Schema.Array(
				Schema.Struct({ version: Schema.String, path: Schema.String, $id: Schema.String, url: Schema.String }),
			),
			drift: Schema.Literals(["strict", "semantic", "allow"]),
			// `optionalKey`, deliberately: a PRESENT `catalog: undefined` is
			// rejected along with every other non-entry value. `defineConfig`
			// never produces one, so only a forged config can.
			catalog: Schema.optionalKey(Schema.Struct(CatalogEntry.fields)),
		}),
	),
});

const validateForgedShape = Schema.decodeUnknownResult(ForgedConfigShape);

// Every issue at once, each as `<message> at <path>`, so a forged config is
// repaired in one pass rather than one field per run.
const describeMalformed = (config: SchemastoreConfig): string | undefined => {
	const checked = validateForgedShape(config, { errors: "all" });
	return Result.isFailure(checked) ? flattenSchemaError(checked.failure) : undefined;
};

// `defineConfig` already rejects duplicate output paths lexically; two
// spellings it could not unify (`../x/a.json` from one directory, `a.json`
// after resolution) can still collide once absolute, so the check re-runs
// here on the resolved paths, across every declared output: each schema's
// current target, every frozen predecessor, this config's catalog slice and
// the merged catalog. The same resolved paths re-run the catalogDir rule a
// lexical pass cannot settle: every `*.json` file in `catalogDir` is read as
// a slice, so neither `outputDir` nor any document may live there, and
// `catalogDir` may not be the merged catalog's own path (a directory there
// would make writing the merged file fail EISDIR).
const describeClashingPath = (config: SchemastoreConfig, path: Path.Path): string | undefined => {
	const documents = config.schemas.flatMap((schema) => [schema.target.path, ...schema.frozen.map((f) => f.path)]);
	const catalogDir = path.normalize(config.catalogDir);
	if (catalogDir === path.normalize(ConfigLoader.mergedCatalogPath(config, path))) {
		return `catalogDir "${config.catalogDir}" must not be the merged catalog's path (catalog.json in its parent)`;
	}
	if (catalogDir === path.normalize(config.outputDir)) {
		return `catalogDir "${config.catalogDir}" must not be outputDir: every *.json file in it is read as a catalog slice`;
	}
	for (const document of documents) {
		if (path.normalize(path.dirname(document)) === catalogDir) {
			return `output path "${document}" sits in catalogDir "${config.catalogDir}", which holds only catalog slices`;
		}
	}
	const seen = new Set<string>();
	for (const p of [...documents, ConfigLoader.slicePath(config, path), ConfigLoader.mergedCatalogPath(config, path)]) {
		const normalized = path.normalize(p);
		if (seen.has(normalized)) {
			return `output path "${p}" is declared twice after resolution`;
		}
		seen.add(normalized);
	}
	return undefined;
};

/**
 * Finds and loads a `schemastore.config.*` file.
 *
 * @remarks
 * `discover` walks upward from a start directory checking
 * {@link ConfigLoader.CONFIG_NAMES} in order at each level, so the nearest
 * directory wins and, within one directory, `.ts` beats `.mjs`. `load` either
 * takes the explicit path or discovers one, imports it, checks the default
 * export is a `defineConfig(...)` value, and resolves relative paths against
 * the config's directory.
 *
 * @public
 */
export class ConfigLoader {
	private constructor() {}

	/** The file names discovery looks for, in preference order. */
	static readonly CONFIG_NAMES: ReadonlyArray<string> = [
		"schemastore.config.ts",
		"schemastore.config.mts",
		"schemastore.config.js",
		"schemastore.config.mjs",
	];

	/**
	 * Walk upward from `start` until a config file is found; fails with the
	 * list of directories searched when none is.
	 */
	static readonly discover = Effect.fn("ConfigLoader.discover")(function* (start: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const searched: Array<string> = [];
		let dir = path.resolve(start);
		for (;;) {
			searched.push(dir);
			for (const name of ConfigLoader.CONFIG_NAMES) {
				const candidate = path.join(dir, name);
				if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
					return candidate;
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir) {
				return yield* Effect.fail(new ConfigNotFoundError({ searched }));
			}
			dir = parent;
		}
	});

	/** This config's own catalog slice: `<catalogDir>/<name>.json`. */
	static slicePath(config: SchemastoreConfig, path: Path.Path): string {
		return path.join(config.catalogDir, `${config.name}.json`);
	}

	/**
	 * The merged catalog every config sharing `catalogDir` maintains:
	 * `catalog.json` in `catalogDir`'s parent (`<outputDir>/catalog.json` under
	 * the default `catalogDir`).
	 */
	static mergedCatalogPath(config: SchemastoreConfig, path: Path.Path): string {
		return path.join(path.dirname(config.catalogDir), "catalog.json");
	}

	/**
	 * Resolve every relative `path` in the config (`outputDir`, `catalogDir`,
	 * each schema's current target, and every frozen predecessor) against
	 * `directory`; absolute paths are left alone. `defineConfig` already
	 * prefixes `outputDir` onto every target/frozen `path`, so resolving them
	 * against the config directory equals resolving against the resolved
	 * `outputDir`. The result keeps the `defineConfig` brand.
	 */
	static readonly resolvePaths = Effect.fn("ConfigLoader.resolvePaths")(function* (
		config: SchemastoreConfig,
		directory: string,
	) {
		const path = yield* Path.Path;
		const absolute = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(directory, p));
		// Object spread copies own enumerable symbol keys, so the brand survives.
		// The explicit annotation (rather than `satisfies`) keeps the inferred
		// type nameable: the brand is a non-exported unique symbol, and a spread
		// literal's type would carry it into declaration emit (TS4026).
		const resolved: SchemastoreConfig = {
			...config,
			outputDir: absolute(config.outputDir),
			catalogDir: absolute(config.catalogDir),
			schemas: config.schemas.map((schema) => ({
				...schema,
				target: { ...schema.target, path: absolute(schema.target.path) },
				frozen: schema.frozen.map((f) => ({ ...f, path: absolute(f.path) })),
			})),
		};
		return resolved;
	});

	/** Locate, import and validate the config; see {@link ConfigLoadOptions}. */
	static readonly load = Effect.fn("ConfigLoader.load")(function* (options: ConfigLoadOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const importModule = options.importModule ?? jitiImport;
		let configPath: string;
		if (options.explicit !== undefined) {
			configPath = path.resolve(options.cwd, options.explicit);
			if (!(yield* fs.exists(configPath).pipe(Effect.orElseSucceed(() => false)))) {
				return yield* Effect.fail(new ConfigNotFoundError({ searched: [configPath] }));
			}
		} else {
			configPath = yield* ConfigLoader.discover(options.cwd);
		}
		const module = yield* Effect.tryPromise({
			try: () => importModule(configPath),
			catch: (cause) => new ConfigLoadError({ path: configPath, reason: describeCause(cause) }),
		});
		const exported = (module as { default?: unknown } | undefined)?.default ?? module;
		if (!isSchemastoreConfig(exported)) {
			return yield* Effect.fail(
				new ConfigLoadError({
					path: configPath,
					reason: "default export is not a defineConfig(...) value from @effected/schemastore",
				}),
			);
		}
		const malformed = describeMalformed(exported);
		if (malformed !== undefined) {
			return yield* Effect.fail(new ConfigLoadError({ path: configPath, reason: malformed }));
		}
		const directory = path.dirname(configPath);
		const config = yield* ConfigLoader.resolvePaths(exported, directory);
		const duplicate = describeClashingPath(config, path);
		if (duplicate !== undefined) {
			return yield* Effect.fail(new ConfigLoadError({ path: configPath, reason: duplicate }));
		}
		const loaded: LoadedConfig = { path: configPath, directory, config };
		return loaded;
	});
}
