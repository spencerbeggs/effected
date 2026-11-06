// Ported from savvy-web/systems packages/tsdown-plugins/__test__/manifest/transform-exe.test.ts on 2026-11-06
// packages/bundler/__test__/manifest/transform-exe.test.ts
import { assert, describe, it } from "@effect/vitest";
import { transformManifest } from "../../src/manifest/transform.js";

describe("transformManifest exeRewrite", () => {
	const rewrite = { source: "./src/bin.ts", fileName: "vitest-agent-sidecar-darwin-arm64", dir: "bin" };

	it("rewrites the matching '.' export to the SEA path and adds it to files", () => {
		const out = transformManifest(
			{ exports: { ".": "./src/bin.ts", "./package.json": "./package.json" }, version: "1.0.0" },
			{ exeRewrite: rewrite },
		);
		assert.deepStrictEqual(out.exports, {
			".": "./bin/vitest-agent-sidecar-darwin-arm64",
			"./package.json": "./package.json",
		});
		assert.deepStrictEqual(out.files, ["bin/vitest-agent-sidecar-darwin-arm64"]);
	});

	it("rewrites a matching bin command value to the SEA path", () => {
		const out = transformManifest(
			{ exports: { ".": "./src/index.ts" }, bin: { mycli: "./src/bin.ts" }, version: "1.0.0" },
			{ exeRewrite: rewrite },
		);
		assert.strictEqual((out.bin as Record<string, string>).mycli, "bin/vitest-agent-sidecar-darwin-arm64");
	});

	it("leaves a non-matching export as the normal TS-conditions rewrite", () => {
		const out = transformManifest(
			{ exports: { ".": "./src/index.ts", "./bin/cli": "./src/bin.ts" }, version: "1.0.0" },
			{ exeRewrite: rewrite },
		);
		const exports = out.exports as Record<string, unknown>;
		assert.strictEqual(exports["./bin/cli"], "./bin/vitest-agent-sidecar-darwin-arm64");
		assert.deepStrictEqual(exports["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
	});

	it("does not duplicate an already-present files entry", () => {
		const out = transformManifest(
			{ exports: { ".": "./src/bin.ts" }, files: ["bin/vitest-agent-sidecar-darwin-arm64"], version: "1.0.0" },
			{ exeRewrite: rewrite },
		);
		assert.deepStrictEqual(out.files, ["bin/vitest-agent-sidecar-darwin-arm64"]);
	});
});
