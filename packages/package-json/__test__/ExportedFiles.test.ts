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
		"/outside/lib/x.js": "",
		"/pkg/link.js": MemoryFileSystem.symlink("/outside/escape.js"),
		"/pkg/vendor": MemoryFileSystem.symlink("/outside"),
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

		it.effect("a concrete entry is never reached through a symlink, at the file or any parent directory", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({
					exports: {
						"./link": "./link.js",
						"./vendored": "./vendor/escape.js",
						"./index": "./index.js",
					},
				});
				assert.deepStrictEqual(found, [["./index", "./index.js"]]);
			}),
		);

		it.effect("a pattern whose base directory sits under a symlinked parent contributes nothing", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* subpaths({ exports: { "./v/*": "./vendor/lib/*.js" } }), []);
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

// File names that only round-trip if the reported subpath is re-encoded:
// every path is decoded, every subpath is a request that resolves back to it.
const e = String.fromCodePoint(0xe9);
const Encoded = Layer.merge(
	Path.layer,
	MemoryFileSystem.layerWith({
		"/pkg/dist/a b.js": "",
		"/pkg/dist/100%.js": "",
		"/pkg/dist/a#b.js": "",
		"/pkg/dist/a%20b.js": "",
		[`/pkg/dist/${e}.js`]: "",
		"/pkg/dist/a+b.js": "",
	}),
);

describe("PackageJsonFile.exportedFiles: decoded paths", () => {
	layer(Encoded)((it) => {
		it.effect("expands a pattern to decoded files, each under a subpath that resolves back to it", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({ exports: { "./*": "./dist/*.js" } });
				assert.deepStrictEqual(found, [
					["./100%25", "./dist/100%.js"],
					["./a b", "./dist/a b.js"],
					["./a%23b", "./dist/a#b.js"],
					["./a%2520b", "./dist/a%20b.js"],
					["./a+b", "./dist/a+b.js"],
					[`./${e}`, `./dist/${e}.js`],
				]);
			}),
		);

		it.effect("a concrete entry is reached by its decoded path", () =>
			Effect.gen(function* () {
				const found = yield* subpaths({
					exports: { "./sp": "./dist/a%20b.js", "./pct": "./dist/a%2520b.js", "./plus": "./dist/a%2Bb.js" },
				});
				assert.deepStrictEqual(found, [
					["./sp", "./dist/a b.js"],
					["./pct", "./dist/a%20b.js"],
					["./plus", "./dist/a+b.js"],
				]);
			}),
		);
	});
});
