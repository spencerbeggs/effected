import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ConfigLoader } from "../../src/ConfigLoader.js";

// The integration boundary: the loader over the real platform and the real
// jiti importer (the only test that does not inject `importModule`).
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const fixture = fileURLToPath(new URL("../fixtures/basic/", import.meta.url));

describe("ConfigLoader through jiti (integration)", () => {
	it.effect("imports a TypeScript config whose .js specifier resolves to a .ts source", () =>
		Effect.gen(function* () {
			const loaded = yield* ConfigLoader.load({ cwd: fixture });
			assert.isTrue(loaded.path.endsWith("/fixtures/basic/schemastore.config.ts"));
			assert.strictEqual(loaded.config.schemas.length, 1);
			assert.strictEqual(loaded.config.schemas[0]?.version, "1.0");
			assert.isTrue(loaded.config.schemas[0]?.path.endsWith("/fixtures/basic/schemas/basic-1.0.json"));
			assert.isTrue(loaded.config.catalog[0]?.config.path.endsWith("/fixtures/basic/schemas/catalog-entry.json"));
			assert.strictEqual(loaded.config.catalog[0]?.entry.url, "https://example.com/schemas/basic-1.0.json");
		}).pipe(Effect.provide(Platform)),
	);
});
