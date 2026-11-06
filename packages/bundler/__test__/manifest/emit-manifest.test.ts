// packages/bundler/__test__/manifest/emit-manifest.test.ts
import { assert, describe, it } from "@effect/vitest";
import { buildEmittedManifest, manifestNeedsCatalogResolution } from "../../src/manifest/emit-manifest.js";

describe("manifestNeedsCatalogResolution", () => {
	// Behavior 2: pure helper detects catalog:/workspace: specifiers across all four dependency fields.
	it("should detect catalog: and workspace: specifiers across all four dependency fields, and return false when none are present", () => {
		assert.strictEqual(manifestNeedsCatalogResolution({ dependencies: { effect: "catalog:silk" } }), true);
		assert.strictEqual(manifestNeedsCatalogResolution({ devDependencies: { "@x/p": "workspace:*" } }), true);
		assert.strictEqual(manifestNeedsCatalogResolution({ peerDependencies: { react: "catalog:silkPeers" } }), true);
		assert.strictEqual(manifestNeedsCatalogResolution({ optionalDependencies: { fsevents: "workspace:*" } }), true);
		assert.strictEqual(
			manifestNeedsCatalogResolution({
				name: "@x/p",
				version: "1.0.0",
				dependencies: { effect: "^3.0.0" },
				devDependencies: { vitest: "^2.0.0" },
			}),
			false,
		);
		assert.strictEqual(manifestNeedsCatalogResolution({ name: "@x/p", version: "1.0.0" }), false);
	});

	it('should not throw on a null or non-object dependency field (valid JSON like "dependencies": null)', () => {
		assert.doesNotThrow(() => manifestNeedsCatalogResolution({ dependencies: null }));
		assert.strictEqual(manifestNeedsCatalogResolution({ dependencies: null }), false);
		assert.strictEqual(manifestNeedsCatalogResolution({ devDependencies: "not-an-object" }), false);
	});
});

describe("buildEmittedManifest", () => {
	it("dev group with devManifest=preserve keeps catalog: specifiers and stays private", async () => {
		const out = await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg: {
				name: "@x/p",
				version: "1.0.0",
				exports: { ".": "./src/index.ts" },
				dependencies: { effect: "catalog:silk" },
			},
			targetGroup: { id: "dev", name: "@x/p", isProd: false },
			devManifest: "preserve",
		});
		assert.deepStrictEqual(out.dependencies, { effect: "catalog:silk" });
		assert.deepStrictEqual(out.exports, {
			".": { types: "./index.d.ts", import: "./index.js", default: "./index.js" },
			"./package.json": "./package.json",
		});
	});

	it("applies the targetGroup name to package.json.name", async () => {
		const out = await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg: { name: "base", version: "1.0.0" } as never,
			targetGroup: { id: "github", name: "@scope/base", isProd: false },
			devManifest: "preserve",
		});
		assert.strictEqual((out as { name?: string }).name, "@scope/base");
	});

	it("drops the named top-level keys from the emitted manifest", async () => {
		const out = await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg: { name: "base", version: "1.0.0", dependencies: { effect: "^3" }, keywords: ["a"] } as never,
			targetGroup: { id: "npm", name: "base", isProd: true },
			devManifest: "preserve",
			drop: ["dependencies"],
		});
		assert.isUndefined(out.dependencies);
		assert.deepStrictEqual(out.keywords, ["a"]);
	});
});
