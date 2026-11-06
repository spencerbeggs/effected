import { assert, describe, it } from "@effect/vitest";
import { deriveExportPaths } from "../../src/entries/export-paths.js";

describe("deriveExportPaths", () => {
	it("maps index to '.' and matches exports keys by source path", () => {
		const entries = { index: "./src/index.ts", sub: "./src/sub.ts" };
		const exportsMap = { ".": "./src/index.ts", "./sub": "./src/sub.ts" };
		assert.deepStrictEqual(deriveExportPaths(entries, exportsMap), { index: ".", sub: "./sub" });
	});
	it("falls back to ./<name> when no exports map", () => {
		assert.deepStrictEqual(deriveExportPaths({ index: "./src/index.ts", foo: "./src/foo.ts" }, undefined), {
			index: ".",
			foo: "./foo",
		});
	});
	it("prefers the declared key over the flattened name", () => {
		assert.deepStrictEqual(deriveExportPaths({ "a-b": "./src/a/b.ts" }, { "./a/b": "./src/a/b.ts" }), {
			"a-b": "./a/b",
		});
	});
});
