// Ported from savvy-web/systems packages/tsdown-plugins/__test__/entry/ambient-dts.test.ts on 2026-11-06
// packages/bundler/__test__/entries/ambient-dts.test.ts
import { assert, describe, it } from "@effect/vitest";
import {
	ambientOutName,
	assertNoEntryCollisions,
	classifyDtsExport,
	declarationExt,
	extractAmbientDts,
} from "../../src/entries/ambient-dts.js";

describe("classifyDtsExport", () => {
	it("classifies a bare .d.ts string as ambient", () => {
		assert.deepStrictEqual(classifyDtsExport("./src/virtual.d.ts"), { kind: "ambient", source: "./src/virtual.d.ts" });
	});
	it("classifies a { types: '*.d.ts' } object as ambient", () => {
		assert.deepStrictEqual(classifyDtsExport({ types: "./src/a/b.d.cts" }), {
			kind: "ambient",
			source: "./src/a/b.d.cts",
		});
	});
	it("classifies types-.d.ts + runtime .ts as mixed", () => {
		assert.deepStrictEqual(classifyDtsExport({ types: "./src/x.d.ts", import: "./src/x.ts" }), { kind: "mixed" });
	});
	it("classifies a normal runtime export as none", () => {
		assert.strictEqual(classifyDtsExport("./src/index.ts").kind, "none");
		assert.strictEqual(classifyDtsExport({ types: "./src/index.ts", import: "./src/index.ts" }).kind, "none");
	});
	it("classifies a node runtime condition alongside types-.d.ts as mixed", () => {
		assert.deepStrictEqual(classifyDtsExport({ types: "./src/x.d.ts", node: "./src/x.ts" }), { kind: "mixed" });
	});
	it("classifies a .mts runtime branch alongside types-.d.ts as mixed", () => {
		assert.deepStrictEqual(classifyDtsExport({ types: "./src/x.d.ts", import: "./src/x.mts" }), { kind: "mixed" });
	});
});

describe("ambientOutName / declarationExt", () => {
	it("derives the name from the export key and preserves the declaration extension", () => {
		assert.strictEqual(ambientOutName("./virtual", "./src/long/path/input-file.d.ts"), "virtual.d.ts");
		assert.strictEqual(ambientOutName("./foo", "./src/foo.d.cts"), "foo.d.cts");
		assert.strictEqual(ambientOutName("./css", "./src/css.d.ts", true), "css/index.d.ts");
	});
	it("declarationExt only matches declaration files", () => {
		assert.strictEqual(declarationExt("./a.d.ts"), ".d.ts");
		assert.isUndefined(declarationExt("./a.ts"));
	});
});

describe("extractAmbientDts", () => {
	it("returns [] for a bare-string root export (root ambient is unsupported)", () => {
		assert.deepStrictEqual(extractAmbientDts({ exports: "./src/globals.d.ts" }), []);
	});
	it("extracts string and { types } forms, ignoring runtime and json exports", () => {
		const r = extractAmbientDts({
			exports: {
				".": "./src/index.ts",
				"./virtual": { types: "./src/long/path/input-file.d.ts" },
				"./globals": "./src/globals.d.ts",
				"./package.json": "./package.json",
			},
		});
		assert.deepStrictEqual(r, [
			{ exportKey: "./virtual", source: "./src/long/path/input-file.d.ts", outName: "virtual.d.ts" },
			{ exportKey: "./globals", source: "./src/globals.d.ts", outName: "globals.d.ts" },
		]);
	});
	it("throws ConfigValidationError on a mixed export", () => {
		assert.throws(
			() => extractAmbientDts({ exports: { "./x": { types: "./src/x.d.ts", import: "./src/x.ts" } } }),
			/cannot also hand-author its `types`/,
		);
	});
	it("throws when two ambient exports flatten to the same output name", () => {
		assert.throws(
			() => extractAmbientDts({ exports: { "./a-b": "./src/a-b.d.ts", "./a/b": "./src/a/b.d.ts" } }),
			/colliding with export key/,
		);
	});
	it("does not treat a .d.ts-keyed asset re-export as ambient", () => {
		const r = extractAmbientDts({
			exports: {
				".": "./src/index.ts",
				"./rspress-env.d.ts": "./public/rspress-env.d.ts",
				"./virtual": { types: "./src/virtual.d.ts" },
			},
		});
		assert.deepStrictEqual(r, [{ exportKey: "./virtual", source: "./src/virtual.d.ts", outName: "virtual.d.ts" }]);
	});
});

describe("assertNoEntryCollisions", () => {
	it("throws when an ambient output collides with a JS entry name", () => {
		assert.throws(
			() =>
				assertNoEntryCollisions(
					["index", "a-b"],
					[{ exportKey: "./a/b", source: "./src/a/b.d.ts", outName: "a-b.d.ts" }],
				),
			/collides with the JS build entry/,
		);
	});
	it("is a no-op when there is no overlap", () => {
		assert.doesNotThrow(() =>
			assertNoEntryCollisions(["index"], [{ exportKey: "./virtual", source: "./src/v.d.ts", outName: "virtual.d.ts" }]),
		);
	});
});
