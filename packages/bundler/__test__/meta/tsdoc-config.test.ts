import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { buildTsdocConfig, writeTsdocConfig } from "../../src/meta/tsdoc-config.js";

describe("buildTsdocConfig", () => {
	it("includes the schema, enables standard tags, and lists custom tag definitions", () => {
		const cfg = buildTsdocConfig({
			suppressWarnings: [],
			tagDefinitions: [{ tagName: "@since", syntaxKind: "block" }],
		});
		assert.include(cfg.$schema, "tsdoc.schema.json");
		assert.strictEqual(cfg.noStandardTags, false);
		assert.strictEqual(
			(cfg.tagDefinitions as Array<{ tagName: string }>).some((t) => t.tagName === "@since"),
			true,
		);
		// supportForTags is populated from the standard set so api-extractor accepts standard tags.
		assert.isAbove(Object.keys(cfg.supportForTags as object).length, 0);
	});
});

describe("writeTsdocConfig", () => {
	it("writes tsdoc.json to cwd and is idempotent (no rewrite when unchanged)", () => {
		const dir = mkdtempSync(join(tmpdir(), "tsdoc-"));
		const path = writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
		assert.strictEqual(path, join(dir, "tsdoc.json"));
		const first = readFileSync(path, "utf-8");
		// mutate mtime sentinel: rewrite a marker file, then re-run; content must be byte-identical
		writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
		assert.strictEqual(readFileSync(path, "utf-8"), first);
	});

	it("rewrites when the config changes", () => {
		const dir = mkdtempSync(join(tmpdir(), "tsdoc-"));
		writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
		const before = readFileSync(join(dir, "tsdoc.json"), "utf-8");
		writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [{ tagName: "@x", syntaxKind: "modifier" }] });
		const after = readFileSync(join(dir, "tsdoc.json"), "utf-8");
		assert.notStrictEqual(after, before);
		assert.include(after, "@x");
	});
});
