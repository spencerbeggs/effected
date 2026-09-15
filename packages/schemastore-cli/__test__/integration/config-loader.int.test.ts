import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { SchemaFile } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { AjvValidator } from "../../src/AjvValidator.js";
import { ConfigLoader } from "../../src/ConfigLoader.js";
import { Runner } from "../../src/Runner.js";

// The integration boundary: the loader over the real platform and the real
// jiti importer (the only test that does not inject `importModule`).
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const fixture = fileURLToPath(new URL("../fixtures/basic/", import.meta.url));
const releaseAction = fileURLToPath(new URL("../fixtures/release-action/", import.meta.url));

describe("ConfigLoader through jiti (integration)", () => {
	it.effect("imports a TypeScript config whose .js specifier resolves to a .ts source", () =>
		Effect.gen(function* () {
			const loaded = yield* ConfigLoader.load({ cwd: fixture });
			assert.isTrue(loaded.path.endsWith("/fixtures/basic/schemastore.config.ts"));
			assert.strictEqual(loaded.config.schemas.length, 1);
			assert.strictEqual(loaded.config.schemas[0]?.target.version, "1.0");
			assert.isTrue(loaded.config.schemas[0]?.target.path.endsWith("/fixtures/basic/schemas/basic-1.0.json"));
			assert.isTrue(loaded.config.catalogPath.endsWith("/fixtures/basic/schemas/catalog.json"));
			assert.strictEqual(loaded.config.schemas[0]?.catalog?.url, "https://example.com/schemas/basic-1.0.json");
		}).pipe(Effect.provide(Platform)),
	);

	it.effect("loads the versioned-directory layout a self-hosted action uses, with a frozen label", () =>
		Effect.gen(function* () {
			const loaded = yield* ConfigLoader.load({ cwd: releaseAction });
			const [schema] = loaded.config.schemas;
			assert.isDefined(schema);
			assert.isTrue(schema.target.path.endsWith("/fixtures/release-action/schemas/5.0.0/release-action-5.0.0.json"));
			assert.strictEqual(
				schema.target.$id,
				"https://raw.githubusercontent.com/o/release-action/main/schemas/5.0.0/release-action-5.0.0.json",
			);
			assert.strictEqual(schema.frozen[0]?.version, "4.0.0");
			assert.strictEqual(
				schema.catalog?.versions?.["4.0.0"],
				"https://raw.githubusercontent.com/o/release-action/main/schemas/4.0.0/release-action-4.0.0.json",
			);
			const report = yield* Runner.run(loaded.config, {
				mode: "check",
				configPath: loaded.path,
				onDrift: "error",
			}).pipe(Effect.provide(SchemaFile.layer), Effect.provide(AjvValidator.layer));
			assert.strictEqual(report.schemas[0]?.outcome, "would-write");
			assert.strictEqual(report.catalog?.outcome, "would-write");
		}).pipe(Effect.provide(Platform)),
	);
});
