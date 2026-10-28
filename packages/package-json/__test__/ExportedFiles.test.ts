// `PackageJsonFile.exportedFiles` — pattern exports expanded against the files
// a package ships, over an in-memory volume.

import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import type { PackageExportsManifest } from "../src/index.js";
import { PackageJsonFile } from "../src/index.js";

const PKG = "/pkg";

const Volume = Layer.merge(
	Path.layer,
	MemoryFileSystem.layerWith({
		"/pkg/index.js": "",
		"/pkg/dist/Http.js": "",
		"/pkg/dist/Http.d.ts": "",
		"/pkg/dist/nested/deep.js": "",
		"/pkg/dist/internal/secret.js": "",
		"/pkg/dist/readme.md": "",
		"/pkg/dist/node_modules/dep/x.js": "",
		"/pkg/dist/linked": MemoryFileSystem.symlink("/outside"),
		"/outside/escape.js": "",
		"/pkg/features/a.js": "",
		"/pkg/features/b.js": "",
	}),
);

const subpaths = (manifest: PackageExportsManifest) =>
	Effect.map(PackageJsonFile.exportedFiles(PKG, manifest), (entries) =>
		entries.map((entry) => [entry.subpath, entry.path] as const),
	);

describe("PackageJsonFile.exportedFiles", () => {
	layer(Volume)((it) => {
		it.effect("expands a pattern into the files it reaches, honouring a null exclusion", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({
					exports: { ".": "./index.js", "./*": "./dist/*.js", "./internal/*": null },
				});
				assert.deepStrictEqual(found, [
					[".", "./index.js"],
					["./Http", "./dist/Http.js"],
					["./nested/deep", "./dist/nested/deep.js"],
				]);
			}),
		);

		it.effect("never walks into node_modules or through a symlink", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({ exports: { "./*": "./dist/*" } });
				const files = found.map(([, file]) => file);
				assert.include(files, "./dist/readme.md");
				assert.isFalse(files.some((file) => file.includes("node_modules")));
				assert.isFalse(files.some((file) => file.includes("linked")));
			}),
		);

		it.effect("a more specific key decides which file a subpath reaches", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({
					exports: { "./*": "./dist/*.js", "./Http": "./features/a.js" },
				});
				// "./Http" resolves to the exact key's file, so the pattern's
				// ./dist/Http.js is not reported under it.
				assert.deepStrictEqual(found, [
					["./internal/secret", "./dist/internal/secret.js"],
					["./nested/deep", "./dist/nested/deep.js"],
					["./Http", "./features/a.js"],
				]);
			}),
		);

		it.effect("a concrete entry whose file is missing is left out, and a missing directory contributes nothing", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({
					exports: { "./a": "./features/a.js", "./gone": "./gone.js", "./lib/*": "./lib/*.js" },
				});
				assert.deepStrictEqual(found, [["./a", "./features/a.js"]]);
			}),
		);

		it.effect("a pattern with a trailer reaches only the files it matches", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({ exports: { "./features/*.js": "./features/*.js" } });
				assert.deepStrictEqual(found, [
					["./features/a.js", "./features/a.js"],
					["./features/b.js", "./features/b.js"],
				]);
			}),
		);

		it.effect("an invalid manifest fails typed before any IO", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(PackageJsonFile.exportedFiles(PKG, { exports: { "./x": "../x.js" } }));
				assert.strictEqual(error._tag, "PackageExportsError");
			}),
		);

		it.effect("without exports, the legacy main", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* subpaths({ main: "index.js" }), [[".", "./index.js"]]);
			}),
		);
	});
});
