import { createRequire } from "node:module";
import { PathContainment } from "@effected/kit";
import type { SchemastoreConfig } from "@effected/schemastore";
import { CatalogEntry, SchemaVersioning, isSchemastoreConfig } from "@effected/schemastore";
import { Effect, FileSystem, Path, Predicate, Result, Schema } from "effect";
import { createJiti } from "jiti";
import { causeMessage } from "./internal/causeMessage.js";
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
	/** The last directory discovery checks; see {@link ConfigLoader.discover}. Does not bound `explicit`. */
	readonly ceiling?: string;
	/**
	 * The module importer. Defaults to a `jiti` importer that transpiles the
	 * consumer's TypeScript in place and evaluates it afresh on every call;
	 * injectable so tests can hand in a module value without touching disk.
	 */
	readonly importModule?: (path: string) => Promise<unknown>;
}

// The config file is the resolution base, not this module: the consumer's
// `@effected/schemastore` (and its own relative sources) live next to the
// config, and the tool's bundled location has no bearing on where they are.
//
// Every call evaluates afresh, because a long-lived server would otherwise keep
// answering from the config it loaded first. `moduleCache: false` and
// `fsCache: false` re-evaluate what jiti transpiles: TypeScript, and a `.js` with
// no `type: module` above it. `evalModule` rather than `import` because `import`
// hands a root `.mjs`, or a `.js` under `type: module`, to Node's ESM loader.
//
// jiti reads an imported `.json` through `require`, and `moduleCache: false` does
// not touch that cache, so those entries are evicted here. Only `.json`, and
// never under `node_modules`: evicting every other entry made no imported file
// any fresher, and gave the host process a second instance of its own CommonJS
// modules.
//
// What jiti imports natively stays cached by Node's ESM loader, and nothing
// clears that: an imported `.mjs`, `.cjs` or `.js` under `type: module`, a sibling
// workspace package's built `.js` included. That same route is what keeps one
// instance of a `type: module` or CommonJS package, `@effected/schemastore` and
// `effect` among them. An untyped package of ESM `.js` is transpiled instead and
// gets a new instance on each reload. This rests on jiti's routing, which is why
// its range is a tilde.
const IN_NODE_MODULES = /[\\/]node_modules[\\/]/;

const jitiImport = async (path: string, source: string): Promise<unknown> => {
	const { cache } = createRequire(path);
	for (const key of Object.keys(cache)) {
		if (key.endsWith(".json") && !IN_NODE_MODULES.test(key)) {
			Reflect.deleteProperty(cache, key);
		}
	}
	return createJiti(path, { interopDefault: true, moduleCache: false, fsCache: false }).evalModule(source, {
		filename: path,
		async: true,
		forceTranspile: true,
	});
};

// An import failure's stack names the module and the line that threw, which
// the message alone does not, so a non-empty `stack` is preferred; otherwise
// the kit's guarded cause-message read, then the value's string form.
const describeCause = (cause: unknown): string => {
	const stack =
		Predicate.hasProperty(cause, "stack") && Predicate.isString(cause.stack) && cause.stack.trim() !== ""
			? cause.stack
			: undefined;
	return stack ?? causeMessage(cause) ?? String(cause);
};

// What to add to an import failure, by its text. The second is the first partial
// bump a user can hit: a copy of `@effected/schemastore` from before the brand
// checks `hosted` with `instanceof`, throwing inside the config's own evaluation
// with no versions named, so the version check never gets to run.
const IMPORT_HINTS: ReadonlyArray<readonly [pattern: RegExp, hint: string]> = [
	[
		/Cannot find (?:module|package) '@effected\/plugin['/]/,
		"Install it as a devDependency: pnpm add -D @effected/plugin",
	],
	[
		/Expected a HostedSchema/,
		"The config's @effected/schemastore may be older than the tool's. Import defineSchemastore and HostedSchema from @effected/plugin, which is the tool's own copy, or align @effected/schemastore with the version @effected/plugin carries, as catalog:effected does",
	],
];

// A hint joins the first line, because a front end shows only that line and
// keeps the rest of `reason` (the stack) for debug output.
const describeImportFailure = (cause: unknown): string => {
	const text = describeCause(cause);
	const hint = IMPORT_HINTS.find(([pattern]) => pattern.test(text))?.[1];
	if (hint === undefined) {
		return text;
	}
	const [first, ...rest] = text.split("\n");
	return [`${first}. ${hint}`, ...rest].join("\n");
};

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

const VERSION_STAMP = Symbol.for("@effected/schemastore/version");

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
 * Each `load` evaluates the config, and the TypeScript and `.json` it imports,
 * afresh. A `type: module` or CommonJS package keeps one instance across reloads.
 * An imported `.mjs`, `.cjs` or `.js` under `type: module` stays cached by Node's
 * ESM loader, and a sibling workspace package resolved to built `.js` under
 * `type: module` is the same case: an edit to any of these is not seen until the
 * process restarts, so restart a long-lived server to pick one up. An untyped
 * package of ESM `.js` gets a new instance on each reload.
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
	 *
	 * @remarks
	 * With a `ceiling`, the walk checks that directory and stops, comparing real
	 * paths so a link cannot walk past it. A server answering an agent passes one:
	 * a config is code, and on a checkout under a shared directory such as `/tmp`
	 * the one found above it is someone else's. A `start` outside the ceiling
	 * searches nothing rather than walking unbounded. Omitted, the walk runs to the
	 * filesystem root, which is right when a person ran the command.
	 */
	static readonly discover = Effect.fn("ConfigLoader.discover")(function* (start: string, ceiling?: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const real = (p: string) => fs.realPath(p).pipe(Effect.orElseSucceed(() => p));
		const searched: Array<string> = [];
		let dir = path.resolve(start);
		if (ceiling !== undefined && !(yield* PathContainment.isWithin(ceiling, dir))) {
			return yield* Effect.fail(new ConfigNotFoundError({ searched }));
		}
		const stop = ceiling === undefined ? undefined : yield* real(path.resolve(ceiling));
		for (;;) {
			searched.push(dir);
			for (const name of ConfigLoader.CONFIG_NAMES) {
				const candidate = path.join(dir, name);
				if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
					return candidate;
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir || (stop !== undefined && (yield* real(dir)) === stop)) {
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
	 * `outputDir`. The result keeps the `defineConfig` brand and the version
	 * stamp of the copy that produced it.
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
		// Spread drops the stamp, which is non-enumerable by design. Copy it, not
		// a fresh one: the value says which copy of the package made this config.
		const stamp = Object.getOwnPropertyDescriptor(config, VERSION_STAMP);
		return stamp === undefined ? resolved : Object.defineProperty(resolved, VERSION_STAMP, stamp);
	});

	/** Locate, import and validate the config; see {@link ConfigLoadOptions}. */
	static readonly load = Effect.fn("ConfigLoader.load")(function* (options: ConfigLoadOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const { importModule } = options;
		let configPath: string;
		if (options.explicit !== undefined) {
			configPath = path.resolve(options.cwd, options.explicit);
			if (!(yield* fs.exists(configPath).pipe(Effect.orElseSucceed(() => false)))) {
				return yield* Effect.fail(new ConfigNotFoundError({ searched: [configPath] }));
			}
		} else {
			configPath = yield* ConfigLoader.discover(options.cwd, options.ceiling);
		}
		const failed = (cause: unknown) => new ConfigLoadError({ path: configPath, reason: describeImportFailure(cause) });
		const module =
			importModule !== undefined
				? yield* Effect.tryPromise({ try: () => importModule(configPath), catch: failed })
				: yield* fs.readFileString(configPath).pipe(
						Effect.mapError(failed),
						Effect.flatMap((source) => Effect.tryPromise({ try: () => jitiImport(configPath, source), catch: failed })),
					);
		const exported = (module as { default?: unknown } | undefined)?.default ?? module;
		if (!isSchemastoreConfig(exported)) {
			return yield* Effect.fail(
				new ConfigLoadError({
					path: configPath,
					reason:
						"default export is not a defineSchemastore(...) value from @effected/plugin or a defineConfig(...) value from @effected/schemastore",
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
