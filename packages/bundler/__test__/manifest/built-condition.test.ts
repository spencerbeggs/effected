import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { ConfigValidationError } from "../../src/errors.js";
import {
	BUILT_CONDITION,
	builtConditionTargets,
	mismatchedBuiltTargets,
	stripBuiltCondition,
} from "../../src/manifest/built-condition.js";
import type { BuildEmittedManifestOptions } from "../../src/manifest/emit-manifest.js";
import { buildEmittedManifest } from "../../src/manifest/emit-manifest.js";

/** No group here resolves a catalog, so the emit touches no disk: an empty volume stands in for it. */
const runEmit = (options: BuildEmittedManifestOptions) =>
	Effect.runPromise(buildEmittedManifest(options).pipe(Effect.provide(MemoryFileSystem.makeSync({}).layer)));

const refusal = (exports: unknown): ConfigValidationError => {
	try {
		builtConditionTargets(exports);
	} catch (error) {
		if (error instanceof ConfigValidationError) return error;
		throw error;
	}
	return assert.fail("expected a ConfigValidationError");
};

const linked = {
	".": { [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js", default: "./src/index.ts" },
	"./runtime": { [BUILT_CONDITION]: "./dist/prod/npm/pkg/runtime/index.js", import: "./src/runtime/index.tsx" },
	"./plain": "./src/plain.ts",
};

describe("the effected-built export condition", () => {
	it("answers each target as authored", () => {
		assert.deepStrictEqual(builtConditionTargets(linked), [
			{ exportKey: ".", target: "./dist/prod/npm/pkg/index.js" },
			{ exportKey: "./runtime", target: "./dist/prod/npm/pkg/runtime/index.js" },
		]);
		assert.deepStrictEqual(builtConditionTargets({ ".": "./src/index.ts" }), []);
		assert.deepStrictEqual(builtConditionTargets("./src/index.ts"), []);
	});

	it("refuses a condition Node would never select, because an earlier one matches first", () => {
		const error = refusal({ ".": { default: "./src/index.ts", [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js" } });
		assert.strictEqual(error.path, `exports.".".${BUILT_CONDITION}`);
		assert.include(error.reason, "first condition");
	});

	it("refuses a target outside the build's output, a pattern, a lone condition, nesting and a root condition object", () => {
		assert.include(
			refusal({ ".": { [BUILT_CONDITION]: "./src/index.ts", default: "./src/index.ts" } }).reason,
			"./dist/prod/",
		);
		assert.include(
			refusal({ "./*": { [BUILT_CONDITION]: "./dist/prod/npm/pkg/*.js", default: "./src/*.ts" } }).reason,
			"literal path",
		);
		assert.include(
			refusal({ ".": { [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js" } }).reason,
			'"import" or "default"',
		);
		// A types-only follower leaves tsx and vitest nothing to match.
		assert.include(
			refusal({ ".": { [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js", types: "./src/index.ts" } }).reason,
			'"import" or "default"',
		);
		assert.include(
			refusal({ ".": { node: { [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js" }, default: "./src/index.ts" } })
				.reason,
			"cannot nest",
		);
		assert.include(
			refusal({ [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js", default: "./src/index.ts" }).reason,
			"root-level",
		);
	});

	it("strips the condition and leaves everything else as authored", () => {
		const pkg = { name: "@x/p", exports: linked };
		assert.deepStrictEqual(stripBuiltCondition(pkg).exports as unknown, {
			".": { default: "./src/index.ts" },
			"./runtime": { import: "./src/runtime/index.tsx" },
			"./plain": "./src/plain.ts",
		});
		assert.strictEqual(pkg.exports["."][BUILT_CONDITION], "./dist/prod/npm/pkg/index.js");
		// A root-level condition object, refused by the build, is still stripped for a direct caller.
		assert.deepStrictEqual(
			stripBuiltCondition({ exports: { [BUILT_CONDITION]: "./dist/prod/npm/pkg/index.js", default: "./src/index.ts" } })
				.exports as unknown,
			{ default: "./src/index.ts" },
		);
		const untouched = { exports: { ".": "./src/index.ts" } };
		assert.strictEqual(stripBuiltCondition(untouched), untouched);
	});

	it("never publishes: the emitted manifest carries no trace of it", async () => {
		const out = await runEmit({
			cwd: "/abs/pkg",
			pkg: { name: "@x/p", version: "1.0.0", exports: linked },
			targetGroup: { id: "npm", name: "@x/p", isProd: true },
			devManifest: "preserve",
			drop: [],
		});
		assert.notInclude(JSON.stringify(out), BUILT_CONDITION);
		assert.notInclude(JSON.stringify(out), "dist/prod");
		assert.deepStrictEqual((out.exports as Record<string, unknown>)["."], {
			types: "./index.d.ts",
			import: "./index.js",
			default: "./index.js",
		});
	});

	it("matches a target against any group's emitted file, and names the expected path when none matches", () => {
		const targets = builtConditionTargets(linked);
		const emitted = [
			{ groupId: "npm", exports: { ".": { import: "./index.js" }, "./runtime": { import: "./runtime/index.js" } } },
		];
		assert.deepStrictEqual(mismatchedBuiltTargets(targets, emitted), []);
		const stale = [{ groupId: "npm", exports: { ".": { import: "./index.js" }, "./runtime": "./runtime.js" } }];
		assert.deepStrictEqual(mismatchedBuiltTargets(targets, stale), [
			{
				exportKey: "./runtime",
				target: "./dist/prod/npm/pkg/runtime/index.js",
				expected: "./dist/prod/npm/pkg/runtime.js",
			},
		]);
		assert.strictEqual(
			mismatchedBuiltTargets(targets, [{ groupId: "npm", exports: undefined }])[0]?.expected,
			undefined,
		);
	});
});
