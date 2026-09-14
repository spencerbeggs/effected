import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { SchemaTarget, defineConfig } from "@effected/schemastore";
import { Effect, Layer, Path, Schema } from "effect";
import { ConfigLoadError, ConfigLoader, ConfigNotFoundError } from "../src/ConfigLoader.js";

const platform = (seed: Record<string, string>) => Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const Config = Schema.Struct({ name: Schema.String });
const config = defineConfig({
	schemas: [SchemaTarget.make({ schema: Config, $id: "https://x/a.json", path: "schemas/a.json" })],
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
				assert.strictEqual(loaded.config.schemas[0]?.path, "/repo/lib/scripts/schemas/a.json");
				// Resolution keeps the config recognisable and the target's other fields intact.
				assert.strictEqual(loaded.config.schemas[0]?.$id, "https://x/a.json");
				assert.strictEqual(loaded.config.schemas[0]?.published, false);
				assert.deepStrictEqual(loaded.config.drift, config.drift);
			}).pipe(Effect.provide(platform({ "/repo/lib/scripts/schemastore.config.ts": "" }))),
	);

	it.effect("resolves catalog paths too and leaves absolute paths alone", () =>
		Effect.gen(function* () {
			const withCatalog = defineConfig({
				schemas: [
					SchemaTarget.make({
						schema: Config,
						$id: "https://x/a-1.0.json",
						name: "a",
						version: "1.0",
						path: "/abs/schemas/a-1.0.json",
					}),
				],
				catalog: [
					{ name: "a", description: "a", fileMatch: ["a.json"], baseUrl: "https://x", path: "schemas/catalog.json" },
				],
			});
			const loaded = yield* ConfigLoader.load({
				cwd: "/repo/packages/x",
				importModule: () => Promise.resolve({ default: withCatalog }),
			});
			assert.strictEqual(loaded.path, "/repo/schemastore.config.ts");
			assert.strictEqual(loaded.config.schemas[0]?.path, "/abs/schemas/a-1.0.json");
			assert.strictEqual(loaded.config.catalog[0]?.config.path, "/repo/schemas/catalog.json");
			assert.strictEqual(loaded.config.catalog[0]?.entry.url, "https://x/a-1.0.json");
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

	it.effect("fails typed when a schemas element is not a SchemaTarget (JS config)", () =>
		Effect.gen(function* () {
			const malformed = defineConfig({
				schemas: [
					SchemaTarget.make({ schema: Config, $id: "https://x/a.json", path: "schemas/a.json" }),
					// A plain-JS config can hand defineConfig anything; the loader is the gate.
					{ $id: "https://x/b.json", path: "schemas/b.json" } as unknown as SchemaTarget,
				],
			});
			const error = yield* Effect.flip(
				ConfigLoader.load({
					explicit: "schemastore.config.js",
					cwd: "/repo",
					importModule: () => Promise.resolve({ default: malformed }),
				}),
			);
			assert.instanceOf(error, ConfigLoadError);
			assert.match(error.reason, /schemas\[1\] is not a SchemaTarget/);
		}).pipe(Effect.provide(platform({ "/repo/schemastore.config.js": "" }))),
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
