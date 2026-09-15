import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { defineConfig, isSchemastoreConfig } from "@effected/schemastore";
import { Effect, Layer, Path, Schema } from "effect";
import { ConfigLoadError, ConfigLoader, ConfigNotFoundError } from "../src/ConfigLoader.js";

const platform = (seed: Record<string, string>) => Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const Config = Schema.Struct({ name: Schema.String });
const config = defineConfig({
	outputDir: "schemas",
	baseUrl: "https://x/s",
	schemas: {
		a: { schema: Config, versions: ["1.0", "1.1"], catalog: { description: "a", fileMatch: ["a.json"] } },
	},
});

describe("ConfigLoader.discover", () => {
	it.effect("finds schemastore.config.ts in a parent directory", () =>
		Effect.gen(function* () {
			const found = yield* ConfigLoader.discover("/repo/packages/x/src");
			assert.strictEqual(found, "/repo/schemastore.config.ts");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "", "/repo/packages/x/src/index.ts": "" }))),
	);

	it.effect("prefers the nearest directory and the first name in CONFIG_NAMES", () =>
		Effect.gen(function* () {
			const found = yield* ConfigLoader.discover("/repo/packages/x");
			assert.strictEqual(found, "/repo/packages/x/schemastore.config.mjs");
		}).pipe(
			Effect.provide(platform({ "/repo/schemastore.config.ts": "", "/repo/packages/x/schemastore.config.mjs": "" })),
		),
	);

	it.effect("prefers .ts over .mjs in the same directory", () =>
		Effect.gen(function* () {
			const found = yield* ConfigLoader.discover("/repo");
			assert.strictEqual(found, "/repo/schemastore.config.ts");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.mjs": "", "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails typed with the directories searched", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(ConfigLoader.discover("/repo/a/b"));
			assert.instanceOf(error, ConfigNotFoundError);
			assert.deepStrictEqual(error.searched, ["/repo/a/b", "/repo/a", "/repo", "/"]);
			assert.include(error.message, "schemastore.config.ts");
			assert.include(error.message, "/repo/a/b");
		}).pipe(Effect.provide(platform({ "/repo/a/b/.keep": "" }))),
	);
});

describe("ConfigLoader.load", () => {
	it.effect(
		"uses the explicit path, imports the module, and resolves relative paths against the config directory",
		() =>
			Effect.gen(function* () {
				const loaded = yield* ConfigLoader.load({
					explicit: "lib/scripts/schemastore.config.ts",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: config }),
				});
				assert.strictEqual(loaded.path, "/repo/lib/scripts/schemastore.config.ts");
				assert.strictEqual(loaded.directory, "/repo/lib/scripts");
				assert.strictEqual(loaded.config.outputDir, "/repo/lib/scripts/schemas");
				assert.strictEqual(loaded.config.catalogPath, "/repo/lib/scripts/schemas/catalog.json");
				assert.strictEqual(loaded.config.schemas[0]?.target.path, "/repo/lib/scripts/schemas/1.1/a-1.1.json");
				assert.strictEqual(loaded.config.schemas[0]?.frozen[0]?.path, "/repo/lib/scripts/schemas/1.0/a-1.0.json");
				assert.isTrue(isSchemastoreConfig(loaded.config));
			}).pipe(Effect.provide(platform({ "/repo/lib/scripts/schemastore.config.ts": "" }))),
	);

	it.effect("leaves an absolute outputDir alone", () =>
		Effect.gen(function* () {
			const absoluteConfig = defineConfig({
				outputDir: "/abs/schemas",
				baseUrl: "https://x/s",
				schemas: { a: { schema: Config } },
			});
			const loaded = yield* ConfigLoader.load({
				cwd: "/repo/packages/x",
				importModule: () => Promise.resolve({ default: absoluteConfig }),
			});
			assert.strictEqual(loaded.config.outputDir, "/abs/schemas");
			assert.strictEqual(loaded.config.schemas[0]?.target.path, "/abs/schemas/a.json");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "", "/repo/packages/x/.keep": "" }))),
	);

	it.effect("accepts a module whose namespace is the config itself (interopDefault)", () =>
		Effect.gen(function* () {
			const loaded = yield* ConfigLoader.load({
				explicit: "schemastore.config.ts",
				cwd: "/repo",
				importModule: () => Promise.resolve(config),
			});
			assert.strictEqual(loaded.config.schemas.length, 1);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails typed when the default export is not a defineConfig value", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.ts",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: { schemas: [] } }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.path, "/repo/schemastore.config.ts");
			assert.match(error.reason, /default export is not a defineConfig/);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails typed when outputDir is not a string (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, { outputDir: 123 }) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "outputDir is not a string");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when catalogPath is not a string (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, { catalogPath: 123 }) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "catalogPath is not a string");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when schemas is not an array (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, { schemas: { length: 1 } }) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "schemas is not an array");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when a schemas element is not a resolved schema (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, {
				schemas: [Object.assign({}, config.schemas[0], { name: 123 })],
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "schemas[0] is not a resolved schema (missing name/target/frozen/drift)");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when a schemas element's target is not a SchemaTarget (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, {
				schemas: [{ ...config.schemas[0], target: { $id: "x" } }],
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "schemas[0].target is not a SchemaTarget (missing schema/$id/path/published)");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when a frozen version is not a frozen version (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, {
				schemas: [{ ...config.schemas[0], frozen: [{ version: "1.0" }] }],
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, "schemas[0].frozen[0] is not a frozen version (missing version/path/$id/url)");
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when a schemas element's catalog is not a catalog entry (forged null)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, {
				schemas: [{ ...config.schemas[0], catalog: null }],
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(
				error.reason,
				"schemas[0].catalog is not a catalog entry (missing name/description/fileMatch/url)",
			);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("fails typed when a schemas element's catalog is missing fields (forged brand)", () =>
		Effect.gen(function* () {
			const forged = Object.assign({}, config, {
				schemas: [{ ...config.schemas[0], catalog: { name: "a" } }],
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: forged }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(
				error.reason,
				"schemas[0].catalog is not a catalog entry (missing name/description/fileMatch/url)",
			);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
	);

	it.effect("keeps the defineConfig brand after resolvePaths", () =>
		Effect.gen(function* () {
			const loaded = yield* ConfigLoader.load({
				explicit: "schemastore.config.ts",
				cwd: "/repo",
				importModule: () => Promise.resolve({ default: config }),
			});
			assert.isTrue(isSchemastoreConfig(loaded.config));
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails typed when two outputs resolve to one absolute path", () =>
		Effect.gen(function* () {
			// The forged catalogPath is lexically distinct from the target path but
			// resolves against the same directory to one absolute path.
			const colliding = Object.assign({}, config, {
				catalogPath: config.schemas[0]?.target.path,
			}) as unknown as typeof config;
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.ts",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: colliding }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.strictEqual(error.reason, 'output path "/repo/schemas/1.1/a-1.1.json" is declared twice after resolution');
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails typed when the module throws on import", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.ts",
					cwd: "/repo",
					importModule: () => Promise.reject(new Error("boom")),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.match(error.reason, /boom/);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.ts": "" }))),
	);

	it.effect("fails ConfigNotFoundError when the explicit path does not exist", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				ConfigLoader.load({ explicit: "nope.ts", cwd: "/repo", importModule: () => Promise.resolve({}) }),
			);
			assert.instanceOf(error, ConfigNotFoundError);
			assert.deepStrictEqual(error.searched, ["/repo/nope.ts"]);
		}).pipe(Effect.provide(platform({ "/repo/.keep": "" }))),
	);
});
