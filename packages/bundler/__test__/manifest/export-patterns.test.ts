import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { unmatchedExportPatterns } from "../../src/manifest/export-patterns.js";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const pkgWith = (exportsMap: unknown, files: ReadonlyArray<string> = []): string => {
	const pkg = mkdtempSync(join(tmpdir(), "export-patterns-"));
	roots.push(pkg);
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ exports: exportsMap }));
	for (const file of files) {
		mkdirSync(dirname(join(pkg, file)), { recursive: true });
		writeFileSync(join(pkg, file), "{}");
	}
	return pkg;
};

const PATTERN = { "./schemas/*.json": "./schemas/*.json" };

describe("unmatchedExportPatterns", () => {
	it("names a pattern with nothing behind it, and passes one with a nested match", () => {
		assert.deepStrictEqual(unmatchedExportPatterns(pkgWith(PATTERN)), [
			{ key: "./schemas/*.json", target: "./schemas/*.json" },
		]);
		assert.deepStrictEqual(unmatchedExportPatterns(pkgWith(PATTERN, ["schemas/5.0/run.json"])), []);
	});

	it("reads a target under conditions, and ignores a null exclusion and a literal target", () => {
		const pkg = pkgWith({
			"./a/*": { types: "./a/*.d.ts", default: "./a/*.js" },
			"./internal/*": null,
			".": "./missing.js",
		});
		assert.deepStrictEqual(unmatchedExportPatterns(pkg), [
			{ key: "./a/*", target: "./a/*.d.ts" },
			{ key: "./a/*", target: "./a/*.js" },
		]);
	});

	it("counts a symlinked file as a match, and a dangling link or a directory as none", () => {
		const outside = pkgWith({}, ["run.json"]);
		const linked = pkgWith(PATTERN);
		mkdirSync(join(linked, "schemas"));
		symlinkSync(join(outside, "run.json"), join(linked, "schemas", "run.json"));
		assert.deepStrictEqual(unmatchedExportPatterns(linked), []);

		const dangling = pkgWith(PATTERN);
		mkdirSync(join(dangling, "schemas"));
		symlinkSync(join(dangling, "gone.json"), join(dangling, "schemas", "run.json"));
		mkdirSync(join(dangling, "schemas", "dir.json"));
		assert.lengthOf(unmatchedExportPatterns(dangling), 1);
	});

	it("has nothing to say about a package with no readable manifest", () => {
		assert.deepStrictEqual(unmatchedExportPatterns(join(tmpdir(), "no-such-package-dir")), []);
	});
});
