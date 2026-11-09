// Ported from savvy-web/systems packages/tsdown-plugins/__test__/jsx/config.test.ts on 2026-11-06

import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
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
	const read = (seed: MemoryFileSystemSeed) =>
		readTsconfigJsx("/ws/pkg").pipe(Effect.provide(MemoryFileSystem.makeSync(seed).layer));

	it.effect("returns {} when tsconfig.json is absent", () =>
		Effect.map(read({ "/ws/pkg/package.json": "{}" }), (jsx) => assert.deepStrictEqual(jsx, {})),
	);

	it.effect("returns {} on a JSON parse error", () =>
		Effect.map(read({ "/ws/pkg/tsconfig.json": "{ not json }" }), (jsx) => assert.deepStrictEqual(jsx, {})),
	);

	it.effect("extracts jsx and jsxImportSource from compilerOptions", () =>
		Effect.map(
			read({
				"/ws/pkg/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
			}),
			(jsx) => assert.deepStrictEqual(jsx, { jsx: "react-jsx", jsxImportSource: "preact" }),
		),
	);

	it.effect("follows an extends chain and reads JSONC", () =>
		Effect.map(
			read({
				"/ws/tsconfig.base.json": '{ // a comment\n "compilerOptions": { "jsx": "react", } }',
				"/ws/pkg/tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json" }),
			}),
			(jsx) => assert.deepStrictEqual(jsx, { jsx: "react" }),
		),
	);

	it.effect("omits keys absent from compilerOptions", () =>
		Effect.map(read({ "/ws/pkg/tsconfig.json": JSON.stringify({ compilerOptions: {} }) }), (jsx) =>
			assert.deepStrictEqual(jsx, {}),
		),
	);
});
