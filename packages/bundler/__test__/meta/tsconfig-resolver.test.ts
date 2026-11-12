// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/tsconfig-resolver.test.ts on 2026-11-06
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { resolvePortableTsconfig } from "../../src/meta/tsconfig-resolver.js";

/** The resolver reads the real package tree (`extends` through `node_modules`), so it runs on the host disk. */
const resolve = (cwd: string, fallback?: string) =>
	resolvePortableTsconfig(cwd, fallback).pipe(Effect.provide(NodeServices.layer));

describe("resolvePortableTsconfig", () => {
	it.effect("resolves this package's effective options (follows extends), portable", () =>
		Effect.gen(function* () {
			const cwd = new URL("../../", import.meta.url).pathname;
			const result = yield* resolve(cwd);
			assert.strictEqual(result.$schema, "https://json.schemastore.org/tsconfig");
			// Full effective options inherited from @effected/plugin/tsconfig/ecma.json.
			assert.strictEqual(result.compilerOptions.target, "es2025");
			assert.strictEqual(result.compilerOptions.module, "nodenext");
			assert.strictEqual(result.compilerOptions.moduleResolution, "nodenext");
			assert.strictEqual(result.compilerOptions.strict, true);
			assert.deepStrictEqual(result.compilerOptions.lib, ["esnext"]);
			// Forced virtual-env settings.
			assert.strictEqual(result.compilerOptions.composite, false);
			assert.strictEqual(result.compilerOptions.noEmit, true);
			// No machine-specific or emit/path keys leak through.
			const json = JSON.stringify(result);
			assert.notInclude(json, "/Users/");
			assert.notProperty(result.compilerOptions, "rootDir");
			assert.notProperty(result.compilerOptions, "outDir");
			assert.notProperty(result.compilerOptions, "declaration");
			assert.notProperty(result, "include");
		}),
	);

	it.effect("falls back to the resolved config when the package has no own tsconfig.json", () =>
		Effect.gen(function* () {
			const fallback = new URL("../../tsconfig.json", import.meta.url).pathname;
			const result = yield* resolve("/no/such/dir/at/all", fallback);
			assert.strictEqual(result.$schema, "https://json.schemastore.org/tsconfig");
			assert.strictEqual(result.compilerOptions.noEmit, true);
			assert.strictEqual(result.compilerOptions.composite, false);
		}),
	);

	it.effect("returns a minimal portable config when neither an own nor a fallback tsconfig exists", () =>
		Effect.gen(function* () {
			const result = yield* resolve("/no/such/dir/at/all");
			assert.deepStrictEqual(result, {
				$schema: "https://json.schemastore.org/tsconfig",
				compilerOptions: { composite: false, noEmit: true },
			});
		}),
	);

	it.effect("re-adds `types` from the resolved config into the portable output", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "portable-types-"));
			writeFileSync(
				join(dir, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { target: "es2022", types: ["node", "vitest"] } }),
			);
			const result = yield* resolve(dir);
			assert.deepStrictEqual(result.compilerOptions.types, ["node", "vitest"]);
		}),
	);

	it.effect("omits `types` from the portable output when the source declares none", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "portable-no-types-"));
			writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022" } }));
			const result = yield* resolve(dir);
			assert.notProperty(result.compilerOptions, "types");
		}),
	);

	it.effect("still drops `typeRoots` from the portable output even when the source declares it", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "portable-typeroots-"));
			writeFileSync(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "es2022",
						types: ["node"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript's own ${configDir} token, not a JS template
						typeRoots: ["${configDir}/node_modules/@types"],
					},
				}),
			);
			const result = yield* resolve(dir);
			assert.notProperty(result.compilerOptions, "typeRoots");
		}),
	);
});
