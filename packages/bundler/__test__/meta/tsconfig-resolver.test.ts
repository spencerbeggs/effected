// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/tsconfig-resolver.test.ts on 2026-11-06
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { resolvePortableTsconfig } from "../../src/meta/tsconfig-resolver.js";

describe("resolvePortableTsconfig", () => {
	it("resolves this package's effective options (follows extends), portable", () => {
		const cwd = new URL("../../", import.meta.url).pathname;
		const result = resolvePortableTsconfig(cwd);
		assert.strictEqual(result.$schema, "https://json.schemastore.org/tsconfig");
		// Full effective options inherited from @savvy-web/bundler/ecma.json.
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
	});

	it("falls back to the resolved config when the package has no own tsconfig.json", () => {
		const fallback = new URL("../../tsconfig.json", import.meta.url).pathname;
		const result = resolvePortableTsconfig("/no/such/dir/at/all", fallback);
		assert.strictEqual(result.$schema, "https://json.schemastore.org/tsconfig");
		assert.strictEqual(result.compilerOptions.noEmit, true);
		assert.strictEqual(result.compilerOptions.composite, false);
	});

	it("returns a minimal portable config when neither an own nor a fallback tsconfig exists", () => {
		const result = resolvePortableTsconfig("/no/such/dir/at/all");
		assert.deepStrictEqual(result, {
			$schema: "https://json.schemastore.org/tsconfig",
			compilerOptions: { composite: false, noEmit: true },
		});
	});

	it("re-adds `types` from the resolved config into the portable output", async () => {
		const dir = await mkdtemp(join(tmpdir(), "portable-types-"));
		await writeFile(
			join(dir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { target: "es2022", types: ["node", "vitest"] } }),
		);
		const result = resolvePortableTsconfig(dir);
		assert.deepStrictEqual(result.compilerOptions.types, ["node", "vitest"]);
	});

	it("omits `types` from the portable output when the source declares none", async () => {
		const dir = await mkdtemp(join(tmpdir(), "portable-no-types-"));
		await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022" } }));
		const result = resolvePortableTsconfig(dir);
		assert.notProperty(result.compilerOptions, "types");
	});

	it("still drops `typeRoots` from the portable output even when the source declares it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "portable-typeroots-"));
		await writeFile(
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
		const result = resolvePortableTsconfig(dir);
		assert.notProperty(result.compilerOptions, "typeRoots");
	});
});
