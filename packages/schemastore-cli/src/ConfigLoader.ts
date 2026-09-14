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
 * value, or a `schemas` element is not `SchemaTarget`-shaped.
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
 * `path` (schema targets and catalog entries) resolved against `directory`.
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
// on trust (they carry live Schema values). A plain-JS config can hand it
// anything, so the loader checks the three fields the pipeline dereferences.
// (A v4 Schema value is callable — `typeof` says "function" — hence `isSchema`.)
const describeMalformedTarget = (schemas: ReadonlyArray<unknown>): string | undefined => {
	for (const [index, target] of schemas.entries()) {
		const record = typeof target === "object" && target !== null ? (target as Record<string, unknown>) : undefined;
		const shaped =
			record !== undefined &&
			Schema.isSchema(record.schema) &&
			typeof record.$id === "string" &&
			typeof record.path === "string";
		if (!shaped) {
			return `schemas[${index}] is not a SchemaTarget (missing schema/$id/path)`;
		}
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
	 * Resolve every relative `path` in the config (schema targets and catalog
	 * entries) against `directory`; absolute paths are left alone. The result
	 * keeps the `defineConfig` brand.
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
			schemas: config.schemas.map((target) => ({ ...target, path: absolute(target.path) })),
			catalog: config.catalog.map((c) => ({ ...c, config: { ...c.config, path: absolute(c.config.path) } })),
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
		const malformed = describeMalformedTarget(exported.schemas);
		if (malformed !== undefined) {
			return yield* Effect.fail(new ConfigLoadError({ path: configPath, reason: malformed }));
		}
		const directory = path.dirname(configPath);
		const config = yield* ConfigLoader.resolvePaths(exported, directory);
		const loaded: LoadedConfig = { path: configPath, directory, config };
		return loaded;
	});
}
