// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/strip-maps.test.ts on 2026-11-06
// packages/bundler/__test__/build/strip-maps.test.ts
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { removeDeclarationMaps } from "../../src/passes/strip-maps.js";

describe("removeDeclarationMaps", () => {
	it("removes .d.ts.map and .d.cts.map (recursively) but keeps .d.ts/.d.cts/.js", async () => {
		const dir = await mkdtemp(join(tmpdir(), "strip-"));
		writeFileSync(join(dir, "index.d.ts"), "export {};");
		writeFileSync(join(dir, "index.d.ts.map"), "{}");
		writeFileSync(join(dir, "index.d.cts"), "export {};");
		writeFileSync(join(dir, "index.d.cts.map"), "{}");
		writeFileSync(join(dir, "index.js"), "");
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub", "a.d.ts.map"), "{}");

		const removed = removeDeclarationMaps(dir);

		assert.deepStrictEqual(
			removed.sort(),
			[join(dir, "index.d.cts.map"), join(dir, "index.d.ts.map"), join(dir, "sub", "a.d.ts.map")].sort(),
		);
		// maps gone
		assert.strictEqual(existsSync(join(dir, "index.d.ts.map")), false);
		assert.strictEqual(existsSync(join(dir, "index.d.cts.map")), false);
		assert.strictEqual(existsSync(join(dir, "sub", "a.d.ts.map")), false);
		// declarations + js preserved
		assert.strictEqual(existsSync(join(dir, "index.d.ts")), true);
		assert.strictEqual(existsSync(join(dir, "index.d.cts")), true);
		assert.strictEqual(existsSync(join(dir, "index.js")), true);
	});

	it("skips node_modules and returns [] for a missing directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "strip-"));
		mkdirSync(join(dir, "node_modules"));
		writeFileSync(join(dir, "node_modules", "dep.d.ts.map"), "{}");

		assert.deepStrictEqual(removeDeclarationMaps(dir), []);
		assert.strictEqual(existsSync(join(dir, "node_modules", "dep.d.ts.map")), true); // untouched
		assert.deepStrictEqual(removeDeclarationMaps(join(dir, "does-not-exist")), []);
	});

	it("accepts a directory relative to the process cwd", async () => {
		const dir = await mkdtemp(join(tmpdir(), "strip-"));
		mkdirSync(join(dir, "pkg"));
		writeFileSync(join(dir, "pkg", "index.d.ts.map"), "{}");
		const prevCwd = process.cwd();
		process.chdir(dir);
		try {
			assert.deepStrictEqual(removeDeclarationMaps("pkg"), [join("pkg", "index.d.ts.map")]);
		} finally {
			process.chdir(prevCwd);
		}
		assert.strictEqual(existsSync(join(dir, "pkg", "index.d.ts.map")), false);
	});

	it("strips under dot-directories but never enters a symlinked directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "strip-"));
		mkdirSync(join(dir, ".hidden"));
		writeFileSync(join(dir, ".hidden", "a.d.ts.map"), "{}");
		const outside = await mkdtemp(join(tmpdir(), "strip-link-target-"));
		writeFileSync(join(outside, "b.d.ts.map"), "{}");
		symlinkSync(outside, join(dir, "linked"));

		assert.deepStrictEqual(removeDeclarationMaps(dir), [join(dir, ".hidden", "a.d.ts.map")]);
		assert.strictEqual(existsSync(join(outside, "b.d.ts.map")), true);
	});
});
