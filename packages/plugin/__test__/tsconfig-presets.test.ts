// The presets a consumer's tsconfig extends. What matters is what a consumer resolves, so these read the built package
// and let the compiler follow `@effected/plugin/tsconfig/ecma.json` through its exports map. The root `globalSetup`
// rebuilds `dist/prod` before every run.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";

const PLUGIN = resolve(import.meta.dirname, "..");
const BUILT = join(PLUGIN, "dist/prod/npm/pkg");
const TSC = join(PLUGIN, "node_modules/.bin/tsc");

const scratch = mkdtempSync(join(tmpdir(), "effected-plugin-presets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Preset {
	readonly "//"?: string;
	readonly compilerOptions: Record<string, unknown>;
}

const preset = (file: string) => JSON.parse(readFileSync(join(PLUGIN, "public/tsconfig", file), "utf8")) as Preset;

describe("the tsconfig presets", () => {
	it("ecma.json holds the kit's settings and no custom condition", () => {
		const { compilerOptions } = preset("ecma.json");
		assert.strictEqual(compilerOptions.isolatedDeclarations, false);
		assert.strictEqual(compilerOptions.module, "nodenext");
		assert.isFalse("customConditions" in compilerOptions);
	});

	it("each names where it was copied from", () => {
		assert.include(preset("ecma.json")["//"] ?? "", "@savvy-web/bundler");
		assert.include(preset("root.json")["//"] ?? "", "@savvy-web/silk");
	});

	it("root.json is the composite preset", () => {
		assert.strictEqual(preset("root.json").compilerOptions.composite, true);
	});

	it("the built manifest keeps the export, and the files are where it points", () => {
		const manifest = JSON.parse(readFileSync(join(BUILT, "package.json"), "utf8")) as {
			readonly exports: Record<string, unknown>;
		};
		assert.strictEqual(manifest.exports["./tsconfig/*"], "./tsconfig/*");
		assert.isTrue(existsSync(join(BUILT, "tsconfig/ecma.json")), "ecma.json");
		assert.isTrue(existsSync(join(BUILT, "tsconfig/root.json")), "root.json");
	});

	it("the manifest surfaces the bundler's peers to a consumer's install", () => {
		const manifest = JSON.parse(readFileSync(join(BUILT, "package.json"), "utf8")) as {
			readonly peerDependencies: Record<string, string>;
		};
		assert.isString(manifest.peerDependencies.typescript);
		assert.isString(manifest.peerDependencies["@types/node"]);
	});

	it("the compiler follows a consumer's extends through the exports map", () => {
		const consumer = join(scratch, "consumer");
		mkdirSync(join(consumer, "node_modules/@effected"), { recursive: true });
		symlinkSync(BUILT, join(consumer, "node_modules/@effected/plugin"));
		writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ extends: "@effected/plugin/tsconfig/ecma.json" }));
		writeFileSync(join(consumer, "a.ts"), "export const a = 1;\n");
		const { status, stdout, stderr } = spawnSync(TSC, ["--showConfig", "-p", consumer], { encoding: "utf8" });
		assert.strictEqual(status, 0, stdout + stderr);
		assert.include(stdout.toLowerCase(), '"verbatimmodulesyntax": true');
	});
});
