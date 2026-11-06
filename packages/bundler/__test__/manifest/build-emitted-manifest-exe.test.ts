// packages/bundler/__test__/manifest/build-emitted-manifest-exe.test.ts
import { assert, describe, it } from "@effect/vitest";
import { buildEmittedManifest } from "../../src/manifest/emit-manifest.js";

describe("buildEmittedManifest exeRewrite", () => {
	it("forwards exeRewrite into transformManifest", async () => {
		const out = await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg: { name: "p", version: "1.0.0", exports: { ".": "./src/bin.ts", "./package.json": "./package.json" } },
			targetGroup: { id: "dev", name: "p", isProd: false },
			devManifest: "preserve",
			exeRewrite: { source: "./src/bin.ts", fileName: "p-darwin-arm64", dir: "bin" },
		});
		assert.strictEqual((out.exports as Record<string, unknown>)["."], "./bin/p-darwin-arm64");
		assert.deepStrictEqual(out.files, ["bin/p-darwin-arm64"]);
	});
});
