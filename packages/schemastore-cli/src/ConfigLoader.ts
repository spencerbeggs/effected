import type { SchemastoreConfig } from "@effected/schemastore";
import { isSchemastoreConfig } from "@effected/schemastore";
import { Effect, FileSystem, Path, Schema } from "effect";
import { createJiti } from "jiti";

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
 * value, `outputDir`/`catalogPath` is not a string, a `schemas` element is
 * not resolved-schema-shaped (or its `target`/a `frozen` entry is not
 * shaped), or two outputs resolve to one absolute path.
 *
 * @public
 */
export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("ConfigLoadError", {
	path: Schema.String,
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to load schemastore config ${this.path}: ${this.reason}`;
	}
}

/**
 * A loaded config: where it came from and its contents with every relative
 * `path` (`outputDir`, `catalogPath`, each schema's current target, and every
 * frozen predecessor) resolved against `directory`.
 *
 * @public
 */
export interface LoadedConfig {
	readonly path: string;
	readonly directory: string;
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

// `defineConfig` validates the catalog block with a schema but takes `schemas`
// on trust (they carry live Schema values), and a hand-rolled module can
// forge the brand directly, skipping `defineConfig` entirely. The loader
// checks the fields the pipeline and the drift policy dereference. (A v4
// Schema value is callable — `typeof` says "function" — hence `isSchema`.)
const isTargetShaped = (target: unknown): boolean => {
	const record = typeof target === "object" && target !== null ? (target as Record<string, unknown>) : undefined;
	return (
		record !== undefined &&
		Schema.isSchema(record.schema) &&
		typeof record.$id === "string" &&
		typeof record.path === "string" &&
		typeof record.published === "boolean"
	);
};

const describeMalformed = (config: SchemastoreConfig): string | undefined => {
	if (typeof config.outputDir !== "string") {
		return "outputDir is not a string";
	}
	if (typeof config.catalogPath !== "string") {
		return "catalogPath is not a string";
	}
	if (!Array.isArray(config.schemas)) {
		return "schemas is not an array";
	}
	for (const [index, schema] of (config.schemas as ReadonlyArray<unknown>).entries()) {
		const record = typeof schema === "object" && schema !== null ? (schema as Record<string, unknown>) : undefined;
		if (
			record === undefined ||
			typeof record.name !== "string" ||
			!Array.isArray(record.frozen) ||
			typeof record.drift !== "string"
		) {
			return `schemas[${index}] is not a resolved schema (missing name/target/frozen/drift)`;
		}
		if (!isTargetShaped(record.target)) {
			return `schemas[${index}].target is not a SchemaTarget (missing schema/$id/path/published)`;
		}
		for (const [j, frozen] of (record.frozen as ReadonlyArray<unknown>).entries()) {
			const f = typeof frozen === "object" && frozen !== null ? (frozen as Record<string, unknown>) : undefined;
			if (f === undefined || typeof f.version !== "string" || typeof f.path !== "string" || typeof f.url !== "string") {
				return `schemas[${index}].frozen[${j}] is not a frozen version (missing version/path/url)`;
			}
		}
	}
	return undefined;
};

// `defineConfig` already rejects duplicate output paths lexically; two
// spellings it could not unify (`../x/a.json` from one directory, `a.json`
// after resolution) can still collide once absolute, so the check re-runs
// here on the resolved paths, across every declared output: each schema's
// current target, every frozen predecessor, and the catalog file.
const describeDuplicatePath = (config: SchemastoreConfig): string | undefined => {
	const seen = new Set<string>();
	const paths = [
		...config.schemas.flatMap((schema) => [schema.target.path, ...schema.frozen.map((f) => f.path)]),
		config.catalogPath,
	];
	for (const p of paths) {
		if (seen.has(p)) {
			return `output path "${p}" is declared twice after resolution`;
		}
		seen.add(p);
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

	/**
	 * Resolve every relative `path` in the config (`outputDir`, `catalogPath`,
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
			catalogPath: absolute(config.catalogPath),
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
		const duplicate = describeDuplicatePath(config);
		if (duplicate !== undefined) {
			return yield* Effect.fail(new ConfigLoadError({ path: configPath, reason: duplicate }));
		}
		const loaded: LoadedConfig = { path: configPath, directory, config };
		return loaded;
	});
}
