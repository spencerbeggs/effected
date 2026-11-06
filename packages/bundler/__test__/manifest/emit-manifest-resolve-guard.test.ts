// Ported from savvy-web/systems packages/tsdown-plugins/__test__/manifest/emit-manifest-resolve-guard.test.ts on 2026-11-06
// packages/bundler/__test__/manifest/emit-manifest-resolve-guard.test.ts
//
// Spies on resolveManifest so we can assert whether buildEmittedManifest actually
// invokes the CatalogResolver, distinct from asserting on its (structurally
// pass-through) return value.
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";

// Must be called before importing the module under test. vi.mock is hoisted to the top.
vi.mock("../../src/catalog/resolve-catalogs.js", () => ({
	resolveManifest: vi.fn(async (pkg: unknown) => pkg),
}));

import { resolveManifest } from "../../src/catalog/resolve-catalogs.js";
// Import AFTER the mock is set up.
import { buildEmittedManifest } from "../../src/manifest/emit-manifest.js";

const mockResolveManifest = resolveManifest as ReturnType<typeof vi.fn>;

describe("buildEmittedManifest resolveManifest guard", () => {
	it("should not call resolveManifest for a prod target group when the manifest has no catalog:/workspace: specifiers", async () => {
		mockResolveManifest.mockClear();
		const pkg = {
			name: "@x/p",
			version: "1.0.0",
			exports: { ".": "./src/index.ts" },
			dependencies: { effect: "^3.0.0" },
		};
		const out = await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg,
			targetGroup: { id: "npm", name: "@x/p", isProd: true },
			devManifest: "preserve",
		});
		assert.strictEqual(mockResolveManifest.mock.calls.length, 0);
		assert.deepStrictEqual(out.dependencies, { effect: "^3.0.0" });
	});

	it("should still call resolveManifest for a prod target group when the manifest has a catalog: specifier", async () => {
		mockResolveManifest.mockClear();
		const pkg = {
			name: "@x/p",
			version: "1.0.0",
			exports: { ".": "./src/index.ts" },
			dependencies: { effect: "catalog:silk" },
		};
		await buildEmittedManifest({
			cwd: "/abs/pkg",
			pkg,
			targetGroup: { id: "npm", name: "@x/p", isProd: true },
			devManifest: "preserve",
		});
		assert.strictEqual(mockResolveManifest.mock.calls.length, 1);
		assert.deepStrictEqual(mockResolveManifest.mock.calls[0], [pkg, "/abs/pkg"]);
	});
});
