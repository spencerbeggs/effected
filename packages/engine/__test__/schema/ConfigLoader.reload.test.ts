import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { SchemaFile, SchemaPipeline, SchemaValidator, SchemastoreVersion } from "@effected/schemastore";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
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

// The same, with a real `node_modules` a test can add packages to. A package
// linked from a directory outside it stands for a sibling workspace package,
// whose real path is not under `node_modules`.
const projectWithPackages = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const dir = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "engine-reload-" }), (made) =>
		fs.remove(made, { recursive: true }).pipe(Effect.ignore),
	);
	const modules = path.join(dir, "node_modules");
	yield* fs.makeDirectory(modules);
	for (const linked of ["@effected", "effect"]) {
		yield* fs.symlink(path.join(ENGINE_MODULES, linked), path.join(modules, linked));
	}
	const write = (name: string, text: string) =>
		fs
			.makeDirectory(path.dirname(path.join(dir, name)), { recursive: true })
			.pipe(Effect.andThen(fs.writeFileString(path.join(dir, name), text)));
	const link = (target: string, name: string) => fs.symlink(path.join(dir, target), path.join(modules, name));
	return { dir, write, link };
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
		"reloading keeps one effect, and a re-evaluated @effected/schemastore still reads its stamp",
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
				// Evaluated three times, so the config did reload, and every evaluation got the same effect. @effected/schemastore
				// resolves to its source here, and jiti re-evaluates what it transpiles, so its classes are new per load where an
				// installed copy's are not: the test below pins that route for a `type: module` package.
				assert.lengthOf(seen, 3);
				for (const probe of seen) {
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

	const descriptionOf = (dir: string) =>
		ConfigLoader.load({ cwd: dir }).pipe(Effect.map((loaded) => loaded.config.schemas[0]?.catalog?.description));

	for (const [title, header] of [
		["a .json the config imports", 'import data from "./shape.json";\nconst { description } = data;'],
		[
			'a .json the config imports with { type: "json" }',
			'import data from "./shape.json" with { type: "json" };\nconst { description } = data;',
		],
	] as const) {
		it.effect(
			`a second load sees an edit to ${title}`,
			() =>
				Effect.gen(function* () {
					const { dir, write } = yield* project;
					yield* write("schemastore.config.ts", config("c", header, "description"));
					yield* write("shape.json", '{ "description": "before" }\n');
					assert.strictEqual(yield* descriptionOf(dir), "before");
					yield* write("shape.json", '{ "description": "after" }\n');
					assert.strictEqual(yield* descriptionOf(dir), "after");
				}).pipe(Effect.provide(Platform)),
			TIMEOUT,
		);
	}

	it.effect(
		"a reload leaves the process's own CommonJS modules cached, outside node_modules too",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("c"));
				yield* write("host.cjs", "exports.Mark = class Mark {};\n");
				const host = `${dir}/host.cjs`;
				const require = createRequire(host);
				const first = require(host);
				yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(require(host), first);
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	// Limits, pinned so their documentation stays true. jiti hands each of these
	// to Node's ESM loader under an async evaluation, and nothing clears that
	// cache. The remedy is restarting the server.
	describe("what stays cached until the process restarts", () => {
		const before = 'export const description = "before";\n';
		const after = 'export const description = "after";\n';
		for (const [title, file, specifier, packageJson, first, second] of [
			["an imported .mjs", "shape.mjs", "./shape.mjs", undefined, before, after],
			[
				"an imported .cjs",
				"shape.cjs",
				"./shape.cjs",
				undefined,
				'module.exports = { description: "before" };\n',
				'module.exports = { description: "after" };\n',
			],
			["an imported .js under type: module", "shape.js", "./shape.js", '{ "type": "module" }\n', before, after],
		] as const) {
			it.effect(
				`${title} is not reloaded`,
				() =>
					Effect.gen(function* () {
						const { dir, write } = yield* project;
						if (packageJson !== undefined) {
							yield* write("package.json", packageJson);
						}
						yield* write(
							"schemastore.config.ts",
							config("c", `import { description } from "${specifier}";`, "description"),
						);
						yield* write(file, first);
						assert.strictEqual(yield* descriptionOf(dir), "before");
						yield* write(file, second);
						assert.strictEqual(yield* descriptionOf(dir), "before");
					}).pipe(Effect.provide(Platform)),
				TIMEOUT,
			);
		}

		it.effect(
			"a sibling workspace package's built .js under type: module is not reloaded",
			() =>
				Effect.gen(function* () {
					const { dir, write, link } = yield* projectWithPackages;
					yield* write(
						"packages/sibling/dist/package.json",
						'{ "name": "sibling", "type": "module", "exports": "./index.js" }\n',
					);
					yield* write("packages/sibling/dist/index.js", before);
					yield* link("packages/sibling/dist", "sibling");
					yield* write("schemastore.config.ts", config("c", 'import { description } from "sibling";', "description"));
					assert.strictEqual(yield* descriptionOf(dir), "before");
					yield* write("packages/sibling/dist/index.js", after);
					assert.strictEqual(yield* descriptionOf(dir), "before");
				}).pipe(Effect.provide(Platform)),
			TIMEOUT,
		);
	});

	it.effect(
		"type: module and CommonJS packages keep one instance across reloads, and an untyped ESM package does not",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* projectWithPackages;
				const key = Symbol.for("@effected/engine/test/package-kinds-probe");
				const seen: Array<{ readonly typed: unknown; readonly commonjs: unknown; readonly untyped: unknown }> = [];
				Object.defineProperty(globalThis, key, { value: seen, configurable: true });
				const esm = "export class Mark {}\n";
				yield* write(
					"node_modules/typed/package.json",
					'{ "name": "typed", "type": "module", "exports": "./index.js" }\n',
				);
				yield* write("node_modules/typed/index.js", esm);
				yield* write("node_modules/commonjs/package.json", '{ "name": "commonjs", "main": "./index.js" }\n');
				yield* write("node_modules/commonjs/index.js", "exports.Mark = class Mark {};\n");
				yield* write("node_modules/untyped/package.json", '{ "name": "untyped", "main": "./index.js" }\n');
				yield* write("node_modules/untyped/index.js", esm);
				yield* write(
					"schemastore.config.ts",
					config(
						"c",
						`import { Mark as typed } from "typed";
						import { Mark as commonjs } from "commonjs";
						import { Mark as untyped } from "untyped";
						(globalThis as any)[Symbol.for("@effected/engine/test/package-kinds-probe")].push({ typed, commonjs, untyped });`,
					),
				);
				yield* ConfigLoader.load({ cwd: dir });
				yield* ConfigLoader.load({ cwd: dir });
				assert.lengthOf(seen, 2);
				assert.strictEqual(seen[0]?.typed, seen[1]?.typed);
				assert.strictEqual(seen[0]?.commonjs, seen[1]?.commonjs);
				assert.notStrictEqual(seen[0]?.untyped, seen[1]?.untyped);
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"a hosted value defineConfig refuses fails with the version hint",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write(
					"schemastore.config.ts",
					`import { defineConfig } from "@effected/schemastore";
					import { Schema } from "effect";
					export default defineConfig({
						name: "c",
						outputDir: "schemas",
						schemas: { a: { schema: Schema.Struct({ n: Schema.String }), hosted: { name: "a", baseUrl: "https://x/s" } as never } },
					});`,
				);
				const error = yield* Effect.flip(ConfigLoader.load({ cwd: dir }));
				assert.instanceOf(error, ConfigLoadError);
				const [first] = error.reason.split("\n");
				assert.include(first ?? "", "Expected a HostedSchema");
				assert.include(first ?? "", "may be older");
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

// effected#1348: a carrier that inlines its own effect must lower a config's
// schemas with the copy that built them. The loader resolves that copy beside
// the config; the carrier e2e's schema-consumer fixture proves the output.
describe("ConfigLoader.load resolves the config's own generator", () => {
	it.effect(
		"answers toJsonSchemaDocument from the effect beside the config, the instance its imports reached",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", config("c"));
				const loaded = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(loaded.toJsonSchemaDocument, Schema.toJsonSchemaDocument);
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"leaves it absent when no effect resolves from the config's directory",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const dir = yield* Effect.acquireRelease(fs.makeTempDirectory({ prefix: "engine-no-effect-" }), (made) =>
					fs.remove(made, { recursive: true }).pipe(Effect.ignore),
				);
				// The config's directory resolves only @effected; the schema module
				// below it resolves effect from its own node_modules.
				yield* fs.makeDirectory(path.join(dir, "node_modules"));
				yield* fs.symlink(path.join(ENGINE_MODULES, "@effected"), path.join(dir, "node_modules", "@effected"));
				yield* fs.makeDirectory(path.join(dir, "lib", "node_modules"), { recursive: true });
				yield* fs.symlink(path.join(ENGINE_MODULES, "effect"), path.join(dir, "lib", "node_modules", "effect"));
				yield* fs.writeFileString(
					path.join(dir, "lib", "shape.ts"),
					'import { Schema } from "effect";\nexport const Shape = Schema.Struct({ n: Schema.String });\n',
				);
				yield* fs.writeFileString(
					path.join(dir, "schemastore.config.ts"),
					`import { defineConfig } from "@effected/schemastore";
import { Shape } from "./lib/shape.ts";
export default defineConfig({
	name: "c",
	outputDir: "schemas",
	baseUrl: "https://example.com/s",
	schemas: { a: { schema: Shape } },
});
`,
				);
				const loaded = yield* ConfigLoader.load({ cwd: dir });
				assert.strictEqual(loaded.config.name, "c");
				assert.isUndefined(loaded.toJsonSchemaDocument);
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);

	it.effect(
		"leaves it absent when an injected importer loaded the config",
		() =>
			Effect.gen(function* () {
				const { dir, write } = yield* project;
				yield* write("schemastore.config.ts", "");
				const { defineConfig } = yield* Effect.promise(() => import("@effected/schemastore"));
				const module = {
					default: defineConfig({
						name: "c",
						outputDir: "schemas",
						baseUrl: "https://example.com/s",
						schemas: { a: { schema: Schema.Struct({ n: Schema.String }) } },
					}),
				};
				const loaded = yield* ConfigLoader.load({ cwd: dir, importModule: () => Promise.resolve(module) });
				assert.isUndefined(loaded.toJsonSchemaDocument);
			}).pipe(Effect.provide(Platform)),
		TIMEOUT,
	);
});
