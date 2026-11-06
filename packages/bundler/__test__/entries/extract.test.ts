// packages/bundler/__test__/entries/extract.test.ts
import { assert, describe, it } from "@effect/vitest";
import { extractEntries } from "../../src/entries/extract.js";

describe("extractEntries", () => {
	it("string exports -> index", () => {
		assert.deepStrictEqual(extractEntries({ exports: "./src/index.ts" }), {
			entries: { index: "./src/index.ts" },
			exportPaths: { index: "." },
		});
	});

	it("'.' subpath maps to index; nested subpath flattens / -> -", () => {
		const r = extractEntries({ exports: { ".": "./src/index.ts", "./foo/bar": "./src/foo/bar.ts" } });
		assert.deepStrictEqual(r.entries, { index: "./src/index.ts", "foo-bar": "./src/foo/bar.ts" });
		assert.deepStrictEqual(r.exportPaths, { index: ".", "foo-bar": "./foo/bar" });
	});

	it("resolves import || default || types in that order, ignoring require", () => {
		const r = extractEntries({
			exports: { ".": { types: "./src/index.ts", require: "./src/index.cts", import: "./src/index.ts" } },
		});
		assert.deepStrictEqual(r.entries, { index: "./src/index.ts" });
	});

	it("falls back to default then types when import is absent", () => {
		assert.deepStrictEqual(extractEntries({ exports: { ".": { default: "./src/d.ts" } } }).entries, {
			index: "./src/d.ts",
		});
		assert.deepStrictEqual(extractEntries({ exports: { ".": { types: "./src/t.ts" } } }).entries, {
			index: "./src/t.ts",
		});
	});

	it("remaps /dist/*.js back to /src/*.ts", () => {
		assert.deepStrictEqual(extractEntries({ exports: { ".": "./dist/index.js" } }).entries, {
			index: "./src/index.ts",
		});
	});

	it("skips ./package.json and any *.json export and non-TS entries", () => {
		const r = extractEntries({
			exports: { ".": "./src/index.ts", "./package.json": "./package.json", "./data": "./src/data.json" },
		});
		assert.deepStrictEqual(r.entries, { index: "./src/index.ts" });
	});

	it("does not treat a .d.ts asset export as a buildable entry", () => {
		const r = extractEntries({
			exports: { ".": "./src/index.ts", "./rspress-env.d.ts": "./public/rspress-env.d.ts" },
		});
		assert.deepStrictEqual(r.entries, { index: "./src/index.ts" });
		assert.deepStrictEqual(r.exportPaths, { index: "." });
	});

	it("exportsAsIndexes nests under <name>/index instead of flattening", () => {
		const r = extractEntries({ exports: { "./foo/bar": "./src/foo/bar.ts" } }, { exportsAsIndexes: true });
		assert.deepStrictEqual(r.entries, { "foo/bar/index": "./src/foo/bar.ts" });
	});

	it("throws when two distinct export keys flatten to the same entry name", () => {
		assert.throws(
			() => extractEntries({ exports: { "./a-b/c": "./src/a-b/c.ts", "./a/b-c": "./src/a/b-c.ts" } }),
			/collides/,
		);
	});

	it("does not throw for distinct export keys that flatten to distinct names", () => {
		const r = extractEntries({ exports: { "./a/b": "./src/a/b.ts", "./a/c": "./src/a/c.ts" } });
		assert.deepStrictEqual(r.entries, { "a-b": "./src/a/b.ts", "a-c": "./src/a/c.ts" });
	});

	it("string bin -> bin/cli", () => {
		assert.deepStrictEqual(extractEntries({ bin: "./src/bin/cli.ts" }).entries, { "bin/cli": "./src/bin/cli.ts" });
	});

	it("object bin -> bin/<command>, remapping dist->src", () => {
		const r = extractEntries({ bin: { savvy: "./dist/bin/cli.js", other: "./src/bin/other.ts" } });
		assert.deepStrictEqual(r.entries, { "bin/savvy": "./src/bin/cli.ts", "bin/other": "./src/bin/other.ts" });
	});

	it("merges exports + bin entries", () => {
		const r = extractEntries({ exports: { ".": "./src/index.ts" }, bin: { savvy: "./src/bin/cli.ts" } });
		assert.deepStrictEqual(r.entries, { index: "./src/index.ts", "bin/savvy": "./src/bin/cli.ts" });
	});
});
