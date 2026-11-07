// Ported from savvy-web/systems packages/tsdown-plugins/__test__/manifest/transform.test.ts on 2026-11-06
// packages/bundler/__test__/manifest/transform.test.ts
import { assert, describe, it } from "@effect/vitest";
import {
	defaultManifestTransform,
	normalizeBinPaths,
	transformBin,
	transformExports,
	transformManifest,
} from "../../src/manifest/transform.js";

describe("defaultManifestTransform", () => {
	it("strips every build/dev-only field from the manifest", () => {
		const out = defaultManifestTransform({
			pkg: {
				name: "@x/p",
				version: "1.0.0",
				dependencies: { effect: "^3" },
				devDependencies: { vitest: "^4" },
				bundleDependencies: ["a"],
				scripts: { build: "x" },
				publishConfig: { access: "public" },
				packageManager: "pnpm@11",
				devEngines: { runtime: { name: "node" } },
			},
		});
		assert.isUndefined(out.devDependencies);
		assert.isUndefined(out.bundleDependencies);
		assert.isUndefined(out.scripts);
		assert.isUndefined(out.publishConfig);
		assert.isUndefined(out.packageManager);
		assert.isUndefined(out.devEngines);
		// Consumer-facing fields are preserved.
		assert.strictEqual(out.name, "@x/p");
		assert.deepStrictEqual(out.dependencies, { effect: "^3" });
	});

	it("is a no-op when none of the stripped fields are present", () => {
		const out = defaultManifestTransform({ pkg: { name: "@x/p", version: "1.0.0" } });
		assert.deepStrictEqual(out, { name: "@x/p", version: "1.0.0" });
	});

	it("does NOT mutate the supplied pkg (returns a stripped copy)", () => {
		const pkg = { name: "@x/p", version: "1.0.0", scripts: { build: "x" }, devDependencies: { vitest: "^4" } };
		const out = defaultManifestTransform({ pkg });
		// input is untouched
		assert.deepStrictEqual(pkg.scripts, { build: "x" });
		assert.deepStrictEqual(pkg.devDependencies, { vitest: "^4" });
		// output is the stripped copy
		assert.notStrictEqual(out, pkg);
		assert.isUndefined(out.scripts);
		assert.isUndefined(out.devDependencies);
	});
});

describe("defaultManifestTransform drop option", () => {
	it("removes each dropped key and still strips devDependencies", () => {
		const out = defaultManifestTransform(
			{
				pkg: {
					name: "@x/p",
					version: "1.0.0",
					dependencies: { effect: "^3" },
					devDependencies: { vitest: "^4" },
				},
			},
			{ drop: ["dependencies"] },
		);
		assert.isUndefined(out.dependencies);
		assert.isUndefined(out.devDependencies);
		assert.strictEqual(out.name, "@x/p");
	});
});

describe("manifest transform", () => {
	it("strips publishConfig + scripts and sets private from publishConfig.access", () => {
		const out = transformManifest({
			name: "@x/p",
			version: "1.0.0",
			scripts: { build: "x" },
			publishConfig: { access: "public", directory: "dist/dev" },
		});
		assert.isUndefined(out.scripts);
		assert.isUndefined(out.publishConfig);
		assert.strictEqual(out.private, false);
	});

	it("keeps private=true when access is not public", () => {
		assert.strictEqual(transformManifest({ name: "@x/p", version: "1.0.0" }).private, true);
		assert.strictEqual(
			transformManifest({ name: "@x/p", version: "1.0.0", publishConfig: { access: "restricted" } }).private,
			true,
		);
	});

	it("rewrites a TS string export to a types+import conditions object", () => {
		assert.deepStrictEqual(transformExports({ ".": "./src/index.ts" }, false), {
			".": { types: "./index.d.ts", import: "./index.js", default: "./index.js" },
		});
	});

	it("derives a nested subpath export's output from the flat entry name (not the source path)", () => {
		assert.deepStrictEqual(transformExports({ "./commitlint": "./src/commitlint/index.ts" }, false), {
			"./commitlint": { types: "./commitlint.d.ts", import: "./commitlint.js", default: "./commitlint.js" },
		});
	});

	it("derives a deeper nested subpath export's output as a dash-joined flat basename", () => {
		assert.deepStrictEqual(
			transformExports({ "./changesets/markdownlint": "./src/changesets/markdownlint/index.ts" }, false),
			{
				"./changesets/markdownlint": {
					types: "./changesets-markdownlint.d.ts",
					import: "./changesets-markdownlint.js",
					default: "./changesets-markdownlint.js",
				},
			},
		);
	});

	it("emits import-only conditions for a TS export when not dual-format", () => {
		assert.deepStrictEqual(transformExports({ "./changesets": "./src/changesets/index.ts" }, false), {
			"./changesets": { types: "./changesets.d.ts", import: "./changesets.js", default: "./changesets.js" },
		});
	});

	it("emits both import and require conditions for a nested TS export when dual-format", () => {
		assert.deepStrictEqual(transformExports({ "./commitlint": "./src/commitlint/index.ts" }, true), {
			"./commitlint": {
				types: "./commitlint.d.ts",
				import: "./commitlint.js",
				require: "./commitlint.cjs",
				default: "./commitlint.js",
			},
		});
	});

	it("keeps a flat/root export byte-identical to the emitted index file in dual-format", () => {
		assert.deepStrictEqual(transformExports({ ".": "./src/index.ts" }, true), {
			".": { types: "./index.d.ts", import: "./index.js", require: "./index.cjs", default: "./index.js" },
		});
	});

	it("leaves a non-TS, non-public export untouched but strips the public/ segment from a public asset", () => {
		// A non-public path is passed through verbatim.
		assert.deepStrictEqual(transformExports({ "./asset": "./src/asset.jsonc" }, true), {
			"./asset": "./src/asset.jsonc",
		});
		// A `./public/...` value points into the staged public dir, whose CONTENTS copyPublicDir copies
		// into the package root — so the published value drops the public/ segment (substructure kept).
		assert.deepStrictEqual(transformExports({ "./biome": "./public/biome/silk.jsonc" }, true), {
			"./biome": "./biome/silk.jsonc",
		});
	});

	it("strips the public/ segment from a flat leaf public asset, keeping any substructure", () => {
		assert.deepStrictEqual(
			transformExports(
				{ ".": "./src/index.ts", "./asset": "./public/ecma.json", "./nested": "./public/tsconfig/ecma.json" },
				false,
			),
			{
				".": { types: "./index.d.ts", import: "./index.js", default: "./index.js" },
				"./asset": "./ecma.json",
				"./nested": "./tsconfig/ecma.json",
			},
		);
	});

	it("passes a .d.ts asset export through as a leaf but strips its public/ segment", () => {
		const exports = { ".": "./src/index.ts", "./rspress-env.d.ts": "./public/rspress-env.d.ts" };
		const out = transformExports(exports, false) as Record<string, unknown>;
		assert.deepStrictEqual(out["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
		assert.strictEqual(out["./rspress-env.d.ts"], "./rspress-env.d.ts");
	});

	it("rewrites TS bins to bin/<name>.js and strips leading ./", () => {
		assert.deepStrictEqual(transformBin({ savvy: "./src/bin/cli.ts" }), { savvy: "bin/savvy.js" });
		assert.strictEqual(transformBin("./src/bin/cli.ts"), "bin/cli.js");
	});

	it("normalizeBinPaths strips leading ./ as the final guard", () => {
		assert.deepStrictEqual(normalizeBinPaths({ savvy: "./bin/savvy.js" }), { savvy: "bin/savvy.js" });
		assert.strictEqual(normalizeBinPaths("./bin/cli.js"), "bin/cli.js");
	});

	it("runs sort-package-json (name before version before exports)", () => {
		const out = transformManifest({ exports: { ".": "./src/index.ts" }, version: "1.0.0", name: "@x/p" });
		assert.deepStrictEqual(Object.keys(out).slice(0, 2), ["name", "version"]);
	});

	it("emits require conditions only for export keys in a dual Set (per-entry dual)", () => {
		const exports = {
			"./changesets/markdownlint": "./src/changesets/markdownlint.ts",
			"./commitlint": "./src/commitlint/index.ts",
		};
		const out = transformExports(exports, new Set(["./changesets/markdownlint"])) as Record<
			string,
			Record<string, string>
		>;
		// markdownlint is in the set -> gets require
		assert.strictEqual(out["./changesets/markdownlint"].require, "./changesets-markdownlint.cjs");
		assert.strictEqual(out["./changesets/markdownlint"].import, "./changesets-markdownlint.js");
		// commitlint is NOT in the set -> import only, no require
		assert.isUndefined(out["./commitlint"].require);
		assert.strictEqual(out["./commitlint"].import, "./commitlint.js");
	});

	it("maps a subdirExports key to <subdir>/index.* conditions", () => {
		const exports = { ".": "./src/index.ts", "./runtime": "./src/runtime/index.tsx" };
		const out = transformExports(exports, false, new Set(["./runtime"])) as Record<
			string,
			{ types: string; import: string; default: string }
		>;
		assert.deepStrictEqual(out["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
		assert.deepStrictEqual(out["./runtime"], {
			types: "./runtime/index.d.ts",
			import: "./runtime/index.js",
			default: "./runtime/index.js",
		});
	});

	it("omits the types condition from a TS export when emitDts is false, keeping import/require", () => {
		// issue #198: emitDts:false skips the dts pass, so the manifest must not point at a
		// declaration file that was never written.
		const exports = { ".": "./src/index.ts" };
		const out = transformExports(exports, true, undefined, false) as Record<string, Record<string, string>>;
		assert.deepStrictEqual(out["."], { import: "./index.js", require: "./index.cjs", default: "./index.js" });
		assert.isUndefined(out["."].types);
	});

	it("keeps the types condition by default (emitDts omitted / true)", () => {
		const exports = { ".": "./src/index.ts" };
		assert.deepStrictEqual(transformExports(exports, false) as Record<string, Record<string, string>>, {
			".": { types: "./index.d.ts", import: "./index.js", default: "./index.js" },
		});
	});

	it("treats dual:true as every TS export dual (back-compat) and dual:false as none", () => {
		const exports = { "./a": "./src/a.ts", "./b": "./src/b.ts" };
		const all = transformExports(exports, true) as Record<string, Record<string, string>>;
		assert.strictEqual(all["./a"].require, "./a.cjs");
		assert.strictEqual(all["./b"].require, "./b.cjs");
		const none = transformExports(exports, false) as Record<string, Record<string, string>>;
		assert.isUndefined(none["./a"].require);
		assert.isUndefined(none["./b"].require);
	});
});

describe("transformExports — non-code exports", () => {
	it("passes a wildcard export of data files through verbatim", () => {
		assert.deepStrictEqual(transformExports({ "./tsconfig/*": "./tsconfig/*" }), { "./tsconfig/*": "./tsconfig/*" });
	});

	it("strips public/ from one, which is where the build copies it from", () => {
		assert.deepStrictEqual(transformExports({ "./tsconfig/*": "./public/tsconfig/*" }), {
			"./tsconfig/*": "./tsconfig/*",
		});
	});
});

describe("transformExports — ambient .d.ts exports", () => {
	it("rewrites a { types: '*.d.ts' } export to the export-key-derived dist pointer", () => {
		const out = transformExports({
			".": "./src/index.ts",
			"./virtual": { types: "./src/long/path/input-file.d.ts" },
			"./package.json": "./package.json",
		}) as Record<string, unknown>;
		assert.deepStrictEqual(out["./virtual"], { types: "./virtual.d.ts" });
		// the normal runtime export is untouched
		assert.deepStrictEqual(out["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
	});
	it("rewrites a bare .d.ts string export and preserves the declaration extension", () => {
		const out = transformExports({ "./globals": "./src/g.d.cts" }) as Record<string, unknown>;
		assert.deepStrictEqual(out["./globals"], { types: "./globals.d.cts" });
	});
	it("never adds import/require to an ambient export even when dual is true", () => {
		const out = transformExports({ "./virtual": { types: "./src/v.d.ts" } }, true) as Record<string, unknown>;
		assert.deepStrictEqual(out["./virtual"], { types: "./virtual.d.ts" });
	});
	it("throws on a mixed export (hand types + runtime source)", () => {
		assert.throws(
			() => transformExports({ "./x": { types: "./src/x.d.ts", import: "./src/x.ts" } }),
			/cannot also hand-author its `types`/,
		);
	});
	it("leaves a bare-string root .d.ts export verbatim (root ambient is unsupported)", () => {
		assert.strictEqual(transformExports("./src/globals.d.ts"), "./src/globals.d.ts");
	});
	it("strips public/ from a .d.ts-keyed asset re-export (not treated as ambient)", () => {
		const out = transformExports({
			".": "./src/index.ts",
			"./rspress-env.d.ts": "./public/rspress-env.d.ts",
		}) as Record<string, unknown>;
		// Not rewritten to an ambient `{ types }` object; passes through as a leaf, with public/ stripped.
		assert.strictEqual(out["./rspress-env.d.ts"], "./rspress-env.d.ts");
	});
});

describe("auto ./package.json export injection", () => {
	it("adds ./package.json to object exports that lack it", () => {
		const out = transformManifest({ name: "@x/p", version: "1.0.0", exports: { ".": "./src/index.ts" } });
		const exports = out.exports as Record<string, unknown>;
		assert.strictEqual(exports["./package.json"], "./package.json");
		assert.deepStrictEqual(exports["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
	});

	it("does not duplicate or overwrite an existing ./package.json export", () => {
		const out = transformManifest({
			name: "@x/p",
			version: "1.0.0",
			exports: { ".": "./src/index.ts", "./package.json": "./package.json" },
		});
		const exports = out.exports as Record<string, unknown>;
		assert.strictEqual(exports["./package.json"], "./package.json");
	});

	it("injects ./package.json for a bare-string (root-only) exports, preserving the root under .", () => {
		const out = transformManifest({ name: "@x/p", version: "1.0.0", exports: "./src/index.ts" });
		const exports = out.exports as Record<string, unknown>;
		assert.deepStrictEqual(exports["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
		assert.strictEqual(exports["./package.json"], "./package.json");
	});

	it("does not add an exports field when the manifest has none", () => {
		const out = transformManifest({ name: "@x/p", version: "1.0.0" });
		assert.isUndefined(out.exports);
	});
});

describe("transformExports — condition-object exports", () => {
	it("names a { import } condition object's outputs after the export key, as the JS pass does", () => {
		const out = transformExports({ "./foo": { import: "./src/foo.ts" } }) as Record<string, unknown>;
		assert.deepStrictEqual(out["./foo"], { types: "./foo.d.ts", import: "./foo.js", default: "./foo.js" });
	});
	it("collapses { import, types } naming one TS source into the export key's conditions", () => {
		const out = transformExports({ "./foo": { types: "./src/foo.ts", import: "./src/foo.ts" } }, true) as Record<
			string,
			unknown
		>;
		assert.deepStrictEqual(out["./foo"], {
			types: "./foo.d.ts",
			import: "./foo.js",
			require: "./foo.cjs",
			default: "./foo.js",
		});
	});
	it("refuses a condition object whose conditions name different TS sources", () => {
		assert.throws(
			() => transformExports({ "./foo": { import: "./src/foo.ts", default: "./src/other.ts" } }),
			/exports\."\.\/foo"/,
		);
	});
	it("refuses a TS source under a condition the entry pass does not build", () => {
		assert.throws(() => transformExports({ "./foo": { node: "./src/foo.ts" } }), /exports\."\.\/foo"/);
		assert.throws(() => transformExports({ "./foo": { import: { node: "./src/foo.ts" } } }), /exports\."\.\/foo"/);
	});
	it("passes a condition object of non-TS targets through unchanged (control)", () => {
		const exports = {
			".": "./src/index.ts",
			"./data": { import: "./public/data.mjs", require: "./data.cjs", default: "./data.mjs" },
		};
		const out = transformExports(exports) as Record<string, unknown>;
		assert.deepStrictEqual(out["./data"], { import: "./data.mjs", require: "./data.cjs", default: "./data.mjs" });
		assert.deepStrictEqual(out["."], { types: "./index.d.ts", import: "./index.js", default: "./index.js" });
	});
});
