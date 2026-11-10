import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "vitest";

/**
 * `@effect/platform-node` declares `redis` as a required peer and its root entry re-exports `NodeRedis`, so a
 * root import fails with ERR_MODULE_NOT_FOUND wherever `redis` is not installed. A subpath import loads only its
 * own module. The kit, and everything it teaches, imports platform packages by subpath only
 * (okf/limitations/platform-node-requires-redis-peer.md).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A platform package named as a bare module specifier (no subpath), after `from`, `import(` or `require(`. */
const ROOT_IMPORT = /(?:from|import\(|require\()\s*["']@effect\/platform-(?:node|bun)["']/;

/** A fixture string of source text for a scanner test: `'import …'` or `source: '…'`, not an import itself. */
const FIXTURE_LINE = /^\s*(?:source:\s*)?["'`]/;

/** The lines of `text` that import a platform package root. */
function rootImportLines(text: string): readonly number[] {
	const hits: number[] = [];
	text.split("\n").forEach((line, index) => {
		if (ROOT_IMPORT.test(line) && !FIXTURE_LINE.test(line)) {
			hits.push(index + 1);
		}
	});
	return hits;
}

/** Tracked files the rule governs: package code and tests, repo scripts, and the plugin's teaching text. */
function governedFiles(): readonly string[] {
	const out = execFileSync(
		"git",
		["ls-files", "-z", "--", "packages", "lib", "plugin/skills", "plugin/agents", "__test__"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	return out
		.split("\0")
		.filter(Boolean)
		.filter((file) => /\.(?:[cm]?[jt]sx?|md)$/.test(file))
		.filter((file) => !file.endsWith("CHANGELOG.md"))
		.filter((file) => !file.endsWith("platform-subpath-imports.test.ts"));
}

describe("platform packages are imported by subpath", () => {
	it("flags a root import in every spelling (positive control)", () => {
		assert.deepEqual(rootImportLines('import { NodeServices } from "@effect/platform-node";'), [1]);
		assert.deepEqual(rootImportLines(" * import { NodeRuntime } from '@effect/platform-node'"), [1]);
		assert.deepEqual(rootImportLines('const m = await import("@effect/platform-node");'), [1]);
		assert.deepEqual(rootImportLines('const m = require("@effect/platform-bun");'), [1]);
	});

	it("accepts a subpath import and a fixture string", () => {
		assert.deepEqual(rootImportLines('import * as NodeServices from "@effect/platform-node/NodeServices";'), []);
		assert.deepEqual(rootImportLines("\t\tsource: 'import { A } from \"@effect/platform-node\";',"), []);
		assert.deepEqual(rootImportLines("'import { A } from \"@effect/platform-node\";',"), []);
	});

	it("finds no root import in the kit's code, tests, scripts or teaching text", () => {
		const files = governedFiles();
		assert.isAbove(files.length, 500, "the scan must reach the tree it guards");
		const offences = files.flatMap((file) =>
			rootImportLines(readFileSync(join(ROOT, file), "utf8")).map((line) => `${file}:${line}`),
		);
		assert.deepEqual(offences, []);
	});
});
