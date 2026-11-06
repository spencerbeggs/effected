import { assert, describe, it } from "@effect/vitest";
import { ConfigValidationError } from "../../src/errors.js";
import { normalizeLooseFiles } from "../../src/passes/loose-files.js";

describe("normalizeLooseFiles", () => {
	it("infers esm + fixedExtension:true from a .mjs key (bare string value)", () => {
		const out = normalizeLooseFiles({ "pnpmfile.mjs": "./src/pnpmfile.ts" });
		assert.deepStrictEqual(out, [
			{
				outFile: "pnpmfile.mjs",
				entryName: "pnpmfile",
				source: "./src/pnpmfile.ts",
				format: "esm",
				fixedExtension: true,
			},
		]);
	});

	it("infers cjs + fixedExtension:true from a .cjs key", () => {
		const out = normalizeLooseFiles({ "pnpmfile.cjs": "./src/pnpmfile.ts" });
		assert.strictEqual(out[0]?.format, "cjs");
		assert.strictEqual(out[0]?.fixedExtension, true);
		assert.strictEqual(out[0]?.entryName, "pnpmfile");
	});

	it("accepts the object form with an explicit format that agrees with the extension", () => {
		const out = normalizeLooseFiles({ "pnpmfile.mjs": { source: "./src/pnpmfile.ts", format: "esm" } });
		assert.strictEqual(out[0]?.format, "esm");
		assert.strictEqual(out[0]?.fixedExtension, true);
	});

	it("requires an explicit format for an ambiguous .js key", () => {
		assert.throws(() => normalizeLooseFiles({ "thing.js": "./src/thing.ts" }), ConfigValidationError);
	});

	it("uses fixedExtension:false for a .js + esm output", () => {
		const out = normalizeLooseFiles({ "thing.js": { source: "./src/thing.ts", format: "esm" } });
		assert.strictEqual(out[0]?.outFile, "thing.js");
		assert.strictEqual(out[0]?.entryName, "thing");
		assert.strictEqual(out[0]?.format, "esm");
		assert.strictEqual(out[0]?.fixedExtension, false);
	});

	it("rejects a format that contradicts the extension", () => {
		assert.throws(
			() => normalizeLooseFiles({ "pnpmfile.mjs": { source: "./s.ts", format: "cjs" } }),
			ConfigValidationError,
		);
	});

	it("rejects a .js + cjs combination (deferred — needs a rename)", () => {
		assert.throws(
			() => normalizeLooseFiles({ "thing.js": { source: "./s.ts", format: "cjs" } }),
			ConfigValidationError,
		);
	});

	it("rejects an unsupported extension", () => {
		assert.throws(() => normalizeLooseFiles({ "thing.txt": "./s.ts" }), ConfigValidationError);
	});

	it("rejects a key with a path separator (v1 emits root-level files only)", () => {
		assert.throws(() => normalizeLooseFiles({ "nested/thing.mjs": "./s.ts" }), ConfigValidationError);
	});
});
