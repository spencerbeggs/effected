// Ported from savvy-web/systems packages/tsdown-plugins/__test__/entry/extract-exclude-sources.test.ts on 2026-11-06
// packages/bundler/__test__/entries/extract-exclude-sources.test.ts
import { assert, describe, it } from "@effect/vitest";
import { extractEntries } from "../../src/entries/extract.js";

describe("extractEntries excludeSources", () => {
	it("omits an exports value listed in excludeSources", () => {
		const { entries } = extractEntries(
			{ exports: { ".": "./src/bin.ts", "./package.json": "./package.json" } },
			{ excludeSources: ["./src/bin.ts"] },
		);
		assert.deepStrictEqual(entries, {}); // bin.ts excluded -> no JS entries
	});

	it("keeps non-excluded exports while excluding the exe source", () => {
		const { entries } = extractEntries(
			{ exports: { ".": "./src/index.ts", "./bin/cli": "./src/bin.ts" } },
			{ excludeSources: ["./src/bin.ts"] },
		);
		assert.deepStrictEqual(entries, { index: "./src/index.ts" });
	});

	it("excludes a matching bin value", () => {
		const { entries } = extractEntries({ bin: { mycli: "./src/bin.ts" } }, { excludeSources: ["./src/bin.ts"] });
		assert.deepStrictEqual(entries, {});
	});

	it("matches regardless of a leading ./ on either side", () => {
		const { entries } = extractEntries({ exports: { ".": "./src/bin.ts" } }, { excludeSources: ["src/bin.ts"] });
		assert.deepStrictEqual(entries, {});
	});
});
