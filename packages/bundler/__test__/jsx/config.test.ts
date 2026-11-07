// Ported from savvy-web/systems packages/tsdown-plugins/__test__/jsx/config.test.ts on 2026-11-06
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { readTsconfigJsx, resolveJsxConfig } from "../../src/jsx/config.js";

describe("resolveJsxConfig", () => {
	it("maps tsconfig react-jsx to automatic runtime with the import source", () => {
		assert.deepStrictEqual(resolveJsxConfig({ jsx: "react-jsx", jsxImportSource: "react" }, undefined), {
			runtime: "automatic",
			importSource: "react",
		});
	});

	it("defaults importSource to react for automatic runtime when unset", () => {
		assert.deepStrictEqual(resolveJsxConfig({ jsx: "react-jsxdev" }, undefined), {
			runtime: "automatic",
			importSource: "react",
		});
	});

	it("maps tsconfig react to classic runtime", () => {
		assert.deepStrictEqual(resolveJsxConfig({ jsx: "react" }, undefined), { runtime: "classic" });
	});

	it("returns undefined for preserve or no jsx (nothing to configure)", () => {
		assert.isUndefined(resolveJsxConfig({ jsx: "preserve" }, undefined));
		assert.isUndefined(resolveJsxConfig({}, undefined));
	});

	it("an explicit override wins over tsconfig inference", () => {
		assert.deepStrictEqual(resolveJsxConfig({ jsx: "react" }, { runtime: "automatic", importSource: "preact" }), {
			runtime: "automatic",
			importSource: "preact",
		});
	});

	it("an explicit automatic override defaults importSource to react", () => {
		assert.deepStrictEqual(resolveJsxConfig({}, { runtime: "automatic" }), {
			runtime: "automatic",
			importSource: "react",
		});
	});
});

describe("readTsconfigJsx", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "jsx-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns {} when tsconfig.json is absent", () => {
		assert.deepStrictEqual(readTsconfigJsx(dir), {});
	});

	it("returns {} on a JSON parse error", () => {
		writeFileSync(join(dir, "tsconfig.json"), "{ not json }");
		assert.deepStrictEqual(readTsconfigJsx(dir), {});
	});

	it("extracts jsx and jsxImportSource from compilerOptions", () => {
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
		);
		assert.deepStrictEqual(readTsconfigJsx(dir), { jsx: "react-jsx", jsxImportSource: "preact" });
	});

	it("omits keys absent from compilerOptions", () => {
		writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
		assert.deepStrictEqual(readTsconfigJsx(dir), {});
	});
});
