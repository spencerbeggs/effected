// packages/bundler/__test__/entries/package-json-entries.test.ts
import { assert, describe, it } from "@effect/vitest";
import { packageJsonEntries } from "../../src/entries/package-json-entries.js";

describe("packageJsonEntries", () => {
	it("returns a tsdown entry record from an in-memory package.json", () => {
		const entry = packageJsonEntries({
			pkg: { exports: { ".": "./src/index.ts" }, bin: { savvy: "./src/bin/cli.ts" } },
		});
		assert.deepStrictEqual(entry, { index: "./src/index.ts", "bin/savvy": "./src/bin/cli.ts" });
	});

	it("honors exportsAsIndexes", () => {
		const entry = packageJsonEntries({
			pkg: { exports: { "./a/b": "./src/a/b.ts" } },
			exportsAsIndexes: true,
		});
		assert.deepStrictEqual(entry, { "a/b/index": "./src/a/b.ts" });
	});
});
