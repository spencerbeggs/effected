// Ported from savvy-web/systems packages/tsdown-plugins/__test__/manifest/emit-manifest-resolve-guard.test.ts on 2026-11-06
// packages/bundler/__test__/manifest/emit-manifest-resolve-guard.test.ts
//
// Spies on resolveManifest so we can assert whether buildEmittedManifest actually
// invokes the CatalogResolver, distinct from asserting on its (structurally
// pass-through) return value.
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { vi } from "vitest";

// Must be called before importing the module under test. vi.mock is hoisted to the top.
// resolveManifest is an Effect, so the spy returns one; `Effect` is imported inside the factory because
// vi.mock is hoisted above the file's own imports.
vi.mock("../../src/catalog/resolve-catalogs.js", async () => {
	const effect = await import("effect");
	return { resolveManifest: vi.fn((pkg: unknown) => effect.Effect.succeed(pkg)) };
});

import { resolveManifest } from "../../src/catalog/resolve-catalogs.js";
// Import AFTER the mock is set up.
import type { BuildEmittedManifestOptions } from "../../src/manifest/emit-manifest.js";
import { buildEmittedManifest } from "../../src/manifest/emit-manifest.js";

/** resolveManifest is mocked, so the emit touches no disk: an empty volume stands in for it. */
const runEmit = (options: BuildEmittedManifestOptions) =>
	Effect.runPromise(buildEmittedManifest(options).pipe(Effect.provide(MemoryFileSystem.makeSync({}).layer)));

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
		const out = await runEmit({
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
		await runEmit({
			cwd: "/abs/pkg",
			pkg,
			targetGroup: { id: "npm", name: "@x/p", isProd: true },
			devManifest: "preserve",
		});
		assert.strictEqual(mockResolveManifest.mock.calls.length, 1);
		assert.deepStrictEqual(mockResolveManifest.mock.calls[0], [pkg, "/abs/pkg"]);
	});
});
