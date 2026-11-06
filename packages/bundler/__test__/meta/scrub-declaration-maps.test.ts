import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import { scrubDeclarationMapsUnder, scrubSourcelessMappings } from "../../src/meta/scrub-declaration-maps.js";

/** A map whose first line carries a generated-only segment (the rolldown 1.2.15 shape behind #817). */
function writeMap(path: string, withSourceless: boolean): void {
	const lines = [
		withSourceless
			? [[0] as [number], [8, 0, 0, 0] as [number, number, number, number]]
			: [[8, 0, 0, 0] as [number, number, number, number]],
		[[0, 0, 1, 0] as [number, number, number, number]],
	];
	writeFileSync(
		path,
		JSON.stringify({
			version: 3,
			file: "index.d.ts",
			names: [],
			sources: ["../src/index.ts"],
			mappings: encode(lines),
		}),
	);
}

describe("scrubSourcelessMappings", () => {
	it("removes generated-only segments and keeps every sourced one", () => {
		const dir = mkdtempSync(join(tmpdir(), "scrub-"));
		const map = join(dir, "index.d.ts.map");
		writeMap(map, true);
		assert.strictEqual(scrubSourcelessMappings(map), 1);
		const after = JSON.parse(readFileSync(map, "utf8")) as { mappings: string; sources: string[] };
		assert.deepStrictEqual(decode(after.mappings), [[[8, 0, 0, 0]], [[0, 0, 1, 0]]]);
		assert.deepStrictEqual(after.sources, ["../src/index.ts"]);
	});

	it("leaves a clean map untouched (no rewrite, zero removed)", () => {
		const dir = mkdtempSync(join(tmpdir(), "scrub-"));
		const map = join(dir, "index.d.ts.map");
		writeMap(map, false);
		const before = readFileSync(map, "utf8");
		assert.strictEqual(scrubSourcelessMappings(map), 0);
		assert.strictEqual(readFileSync(map, "utf8"), before);
	});

	it("walks a declarations tree and totals the removals; a missing dir is 0", () => {
		const dir = mkdtempSync(join(tmpdir(), "scrub-tree-"));
		writeMap(join(dir, "a.d.ts.map"), true);
		writeFileSync(join(dir, "a.d.ts"), "export {};\n");
		const nested = join(dir, "lib");
		mkdirSync(nested);
		writeMap(join(nested, "b.d.cts.map"), true);
		writeMap(join(nested, "c.d.ts.map"), false);
		assert.strictEqual(scrubDeclarationMapsUnder(dir), 2);
		assert.strictEqual(scrubDeclarationMapsUnder(join(dir, "does-not-exist")), 0);
	});

	it("reaches .d.mts maps, dot-directories and symlinked directories", () => {
		const dir = mkdtempSync(join(tmpdir(), "scrub-reach-"));
		mkdirSync(join(dir, ".hidden"));
		writeMap(join(dir, ".hidden", "a.d.mts.map"), true);
		const outside = mkdtempSync(join(tmpdir(), "scrub-link-target-"));
		writeMap(join(outside, "b.d.ts.map"), true);
		symlinkSync(outside, join(dir, "linked"));
		assert.strictEqual(scrubDeclarationMapsUnder(dir), 2);
	});

	it("accepts a directory relative to the process cwd", () => {
		const dir = mkdtempSync(join(tmpdir(), "scrub-rel-"));
		mkdirSync(join(dir, "dts"));
		writeMap(join(dir, "dts", "a.d.ts.map"), true);
		const prevCwd = process.cwd();
		process.chdir(dir);
		try {
			assert.strictEqual(scrubDeclarationMapsUnder("dts"), 1);
		} finally {
			process.chdir(prevCwd);
		}
	});
});
