import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { SchemaFile, SchemaPipeline, SchemaValidator, SchemastoreVersion } from "@effected/schemastore";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { ConfigLoadError, ConfigLoader } from "../../src/schema/ConfigLoader.js";

// The bug this file exists for: a long-lived process (the MCP server) keeps
// answering from the config it loaded first. Real filesystem, real jiti and the
// workspace's built @effected/schemastore: an injected importer proves nothing.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const Pipeline = Layer.mergeAll(SchemaFile.layer, SchemaValidator.noop).pipe(Layer.provide(Platform));

const TIMEOUT = 60_000;
const ENGINE_MODULES = fileURLToPath(new URL("../../node_modules", import.meta.url));

// A temp directory outside the repository whose `node_modules` is the engine's,
// so a config resolves @effected/schemastore and effect the way an installed
// project does. `Effect.ignore` on release: a scope close must not die on it.
const project = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const dir = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "engine-reload-" }), (made) =>
		fs.remove(made, { recursive: true }).pipe(Effect.ignore),
	);
	yield* fs.symlink(ENGINE_MODULES, path.join(dir, "node_modules"));
	const write = (name: string, text: string) => fs.writeFileString(path.join(dir, name), text);
	return { dir, write };
});

const config = (name: string, header = "", description = '"d"') => `
import { defineConfig } from "@effected/schemastore";
import { Schema } from "effect";
${header}
export default defineConfig({
	name: "${name}",
	outputDir: "schemas",
	baseUrl: "https://example.com/s",
	schemas: {
		a: { schema: Schema.Struct({ n: Schema.String }), catalog: { description: ${description}, fileMatch: ["a.json"] } },
	},
});
`;

describe("ConfigLoader.load reloads", () => {
	it.effect(
		"a second load sees an edit to the config",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("first"));
				const first = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(first.config.name, "first");
				yield* write("schemastore.config.ts", config("second"));
				const second = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(second.config.name, "second");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"a second load sees an edit to a file the config imports",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("c", 'import { description } from "./shape.js";', "description"));
				yield* write("shape.ts", 'export const description = "before";\n');
				const first = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(first.config.schemas[0]?.catalog?.description, "before");
				yield* write("shape.ts", 'export const description = "after";\n');
				const second = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(second.config.schemas[0]?.catalog?.description, "after");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"a syntax error fails that load, and the next load after a fix succeeds",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("good"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "good");
				yield* write("schemastore.config.ts", "export default defineConfig({ ;\n");
				const error = yield* Effect.flip(ConfigLoader.load({ cwd: dir }));
				assert.instanceOf(error, ConfigLoadError);
				yield* write("schemastore.config.ts", config("fixed"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "fixed");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"reloading keeps one @effected/schemastore",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				const key = Symbol.for("@effected/engine/test/reload-probe");
				const seen: Array<{ readonly HostedSchema: unknown; readonly Schema: unknown }> = [];
				Object.defineProperty(globalThis, key, { value: seen, configurable: true });
				yield* write(
					"schemastore.config.ts",
					config(
						"c",
						`import { HostedSchema } from "@effected/schemastore";
						(globalThis as any)[Symbol.for("@effected/engine/test/reload-probe")].push({ HostedSchema, Schema });`,
					),
				);
				for (let reload = 0; reload < 3; reload++) {
					const loaded = yield* ConfigLoader.load({ cwd: dir });
					assert.deepStrictEqual(SchemastoreVersion.of(loaded.config), Option.some(SchemastoreVersion.current));
					const results = yield* SchemaPipeline.check(loaded.config.schemas.map((schema) => schema.target));
					assert.include(results[0]?.generated ?? "", '"$id": "https://example.com/s/a.json"');
				}
				// Evaluated three times, so the config did reload, and every
				// evaluation got the same module instances: a package re-evaluated
				// per load would mint a new class each time.
				assert.lengthOf(seen, 3);
				for (const probe of seen) {
					assert.strictEqual(probe.HostedSchema, seen[0]?.HostedSchema);
					assert.strictEqual(probe.Schema, seen[0]?.Schema);
				}
			}).pipe(Effect.provide(Layer.merge(Platform, Pipeline))),
		TIMEOUT,
	);

	it.effect(
		"a second load sees an edit to a .mjs config",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.mjs", config("first"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "first");
				yield* write("schemastore.config.mjs", config("second"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "second");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"a second load sees an edit to a .js config in a type:module project",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("package.json", '{ "type": "module" }\n');
				yield* write("schemastore.config.js", config("first"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "first");
				yield* write("schemastore.config.js", config("second"));
				assert.strictEqual((yield* ConfigLoader.load({ cwd: dir })).config.name, "second");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	// A limit, pinned so its documentation stays true. jiti hands an imported
	// `.mjs` to the native loader under an async evaluation, and no option clears
	// that cache. Consumers' sources are TypeScript, which does reload.
	it.effect(
		"an imported .mjs is not reloaded: the native loader caches it",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("c", 'import { description } from "./shape.mjs";', "description"));
				yield* write("shape.mjs", 'export const description = "before";\n');
				const first = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(first.config.schemas[0]?.catalog?.description, "before");
				yield* write("shape.mjs", 'export const description = "after";\n');
				const second = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(second.config.schemas[0]?.catalog?.description, "before");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"a config that cannot resolve @effected/plugin fails with the install line",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write(
					"schemastore.config.ts",
					`import { defineSchemastore } from "@effected/plugin";\nexport default defineSchemastore({});\n`,
				);
				const error = yield* Effect.flip(ConfigLoader.load({ cwd: dir }));
				assert.instanceOf(error, ConfigLoadError);
				const [first] = error.reason.split("\n");
				assert.include(first ?? "", "@effected/plugin");
				assert.include(first ?? "", "pnpm add -D @effected/plugin");
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);
});
