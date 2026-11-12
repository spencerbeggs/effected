// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/tsdoc-config.test.ts on 2026-11-06
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { buildTsdocConfig, writeTsdocConfig } from "../../src/meta/tsdoc-config.js";

const dir = "/ws/pkg";

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
	it.effect("writes tsdoc.json to cwd and is idempotent (no rewrite when unchanged)", () => {
		const handle = MemoryFileSystem.makeSync({ [dir]: MemoryFileSystem.directory() });
		return Effect.gen(function* () {
			const path = yield* writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
			assert.strictEqual(path, join(dir, "tsdoc.json"));
			const first = handle.volume.text(path);
			assert.isDefined(first);
			const firstMtime = handle.volume.mtime(path);
			// re-run with the same config; content must be byte-identical and the file never rewritten
			yield* writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
			assert.strictEqual(handle.volume.text(path), first);
			assert.strictEqual(handle.volume.mtime(path), firstMtime);
		}).pipe(Effect.provide(handle.layer));
	});

	it.effect("rewrites when the config changes", () => {
		const handle = MemoryFileSystem.makeSync({ [dir]: MemoryFileSystem.directory() });
		return Effect.gen(function* () {
			yield* writeTsdocConfig(dir, { suppressWarnings: [], tagDefinitions: [] });
			const before = handle.volume.text(join(dir, "tsdoc.json"));
			yield* writeTsdocConfig(dir, {
				suppressWarnings: [],
				tagDefinitions: [{ tagName: "@x", syntaxKind: "modifier" }],
			});
			const after = handle.volume.text(join(dir, "tsdoc.json")) ?? "";
			assert.notStrictEqual(after, before);
			assert.include(after, "@x");
		}).pipe(Effect.provide(handle.layer));
	});
});
