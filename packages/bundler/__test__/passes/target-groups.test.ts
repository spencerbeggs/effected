// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/target-groups.test.ts on 2026-11-06
// packages/bundler/__test__/build/target-groups.test.ts
import { assert, describe, it } from "@effect/vitest";
import {
	deriveDtsPassOptions,
	deriveTargetGroupOptions,
	dtsOnlyOption,
	dtsPassDtsOptions,
} from "../../src/passes/target-groups.js";

/** Split the declarations-only flag off a dts block, asserting exactly one spelling is set to true. */
const splitDtsOnly = <T extends { dtsOnly?: true; emitDtsOnly?: true }>(dts: T) => {
	const { dtsOnly, emitDtsOnly, ...rest } = dts;
	assert.strictEqual([dtsOnly, emitDtsOnly].filter((v) => v === true).length, 1);
	return rest;
};

describe("dtsOnlyOption", () => {
	it("uses dtsOnly from rolldown-plugin-dts 0.30.0", () => {
		assert.deepStrictEqual(dtsOnlyOption("0.30.0"), { dtsOnly: true });
		assert.deepStrictEqual(dtsOnlyOption("0.31.2"), { dtsOnly: true });
		assert.deepStrictEqual(dtsOnlyOption("1.0.0"), { dtsOnly: true });
	});
	it("uses emitDtsOnly below 0.30.0, where dtsOnly is silently ignored", () => {
		assert.deepStrictEqual(dtsOnlyOption("0.29.0"), { emitDtsOnly: true });
		assert.deepStrictEqual(dtsOnlyOption("0.29.9"), { emitDtsOnly: true });
		assert.deepStrictEqual(dtsOnlyOption("0.30.0-beta.1"), { emitDtsOnly: true });
	});
	it("falls back to emitDtsOnly when the version is unknown or unparsable", () => {
		assert.deepStrictEqual(dtsOnlyOption(undefined), { emitDtsOnly: true });
		assert.deepStrictEqual(dtsOnlyOption("not-a-version"), { emitDtsOnly: true });
	});
	it("dtsPassDtsOptions sets exactly the chosen key", () => {
		const modern = dtsPassDtsOptions("/tmp/t.json", "0.30.0");
		assert.strictEqual(modern.dtsOnly, true);
		assert.notProperty(modern, "emitDtsOnly");
		const legacy = dtsPassDtsOptions("/tmp/t.json", "0.29.0");
		assert.strictEqual(legacy.emitDtsOnly, true);
		assert.notProperty(legacy, "dtsOnly");
	});
});

describe("deriveTargetGroupOptions (JS pass)", () => {
	const base = { cwd: "/abs/pkg", version: "1.2.3", entry: { index: "./src/index.ts" }, tsconfigPath: "/tmp/t.json" };

	it("dev group -> dist/dev/pkg, sourcemaps on, minify off, not prod", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.outDir, "/abs/pkg/dist/dev/pkg");
		assert.strictEqual(o.sourcemap, true);
		assert.strictEqual(o.minify, false);
		assert.deepStrictEqual(o.format, ["esm"]);
		assert.strictEqual(o.platform, "node");
		assert.strictEqual(o.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("1.2.3"));
		assert.isUndefined(o.define.__PACKAGE_VERSION__);
	});

	it("JS pass emits per-module JS with no dts (unbundle true, dts false, clean true)", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.unbundle, true);
		assert.strictEqual(o.dts, false);
		assert.strictEqual(o.clean, true);
	});

	it("npm group -> dist/prod/npm/pkg, sourcemaps off, minify off by default", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "npm", devManifest: "preserve" });
		assert.strictEqual(o.outDir, "/abs/pkg/dist/prod/npm/pkg");
		assert.strictEqual(o.sourcemap, false);
		// Default is unminified: Node libraries favor readable output.
		assert.strictEqual(o.minify, false);
	});

	it("prod group minifies only when minify:true is passed", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "npm", devManifest: "preserve", minify: true });
		assert.strictEqual(o.minify, true);
	});

	it("dev group never minifies even with minify:true (prod-only option)", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve", minify: true });
		assert.strictEqual(o.minify, false);
	});

	it("folders an arbitrary prod group id under dist/prod/<id>/pkg", () => {
		const derived = deriveTargetGroupOptions({
			group: "github",
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			devManifest: "preserve",
		});
		assert.strictEqual(derived.outDir, "/abs/pkg/dist/prod/github/pkg");
		assert.strictEqual(derived.isProd, true);
	});

	it("forwards an explicit esm+cjs format", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve", format: ["esm", "cjs"] });
		assert.deepStrictEqual(o.format, ["esm", "cjs"]);
	});

	it("sets fixedExtension false for esm-only (default)", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.fixedExtension, false);
	});

	it("keeps fixedExtension false for esm+cjs (tsdown derives .js/.cjs for type:module)", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve", format: ["esm", "cjs"] });
		assert.strictEqual(o.fixedExtension, false);
	});

	it("never carries bundledPackages on the JS pass (dts-only concern)", () => {
		const o = deriveTargetGroupOptions({
			...base,
			group: "dev",
			devManifest: "preserve",
			bundledPackages: ["@commitlint/types"],
		} as never);
		assert.isUndefined((o as unknown as Record<string, unknown>).bundledPackages);
	});

	it("turns preserveModules OFF (unbundle:false) when bundleNodeModules is set", () => {
		// bundleNodeModules promises a self-contained artifact; a per-module (preserveModules)
		// JS pass writes every inlined node_modules dependency to its own sibling file, which
		// `npm pack` strips, breaking that promise for the esm output. See the TSDoc on
		// DerivedTsdownOptions.unbundle for the full finding.
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve", bundleNodeModules: true });
		assert.strictEqual(o.unbundle, false);
	});

	it("keeps preserveModules ON (unbundle:true) when bundleNodeModules is false or absent", () => {
		const withFalse = deriveTargetGroupOptions({
			...base,
			group: "dev",
			devManifest: "preserve",
			bundleNodeModules: false,
		});
		assert.strictEqual(withFalse.unbundle, true);
		const withAbsent = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(withAbsent.unbundle, true);
	});

	it("turns preserveModules off for a prod group too when bundleNodeModules is set", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "npm", devManifest: "preserve", bundleNodeModules: true });
		assert.strictEqual(o.unbundle, false);
		assert.strictEqual(o.isProd, true);
	});
});

describe("deriveDtsPassOptions (dts pass)", () => {
	const base = { cwd: "/abs/pkg", version: "1.2.3", entry: { index: "./src/index.ts" }, tsconfigPath: "/tmp/t.json" };

	it("dts pass: bundled declarations only, no clean, same outDir", () => {
		const o = deriveDtsPassOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.outDir, "/abs/pkg/dist/dev/pkg");
		// bundled: rolldown preserveModules off
		assert.strictEqual(o.unbundle, false);
		// dts-only emission on the tsgo (TypeScript 7.1 API) generator, naming this package's own
		// typescript module explicitly so a consumer's hoisted copy can never be picked instead.
		const { tsgo, ...dtsRest } = o.dts as { tsgo: { moduleUrl: string }; dtsOnly?: true; emitDtsOnly?: true };
		assert.deepStrictEqual(splitDtsOnly(dtsRest), { tsconfig: "/tmp/t.json", generator: "tsgo" });
		assert.match(tsgo.moduleUrl, /^file:\/\/.*\/typescript\//);
		// must NOT wipe the JS pass output
		assert.strictEqual(o.clean, false);
		// dts maps off
		assert.strictEqual(o.sourcemap, false);
		assert.deepStrictEqual(o.format, ["esm"]);
		assert.deepStrictEqual(o.entry, { index: "./src/index.ts" });
	});

	it("dts pass strips bin/ entries (bin executables have no declarations)", () => {
		// A bin entry produces an empty `export {};` .d.ts chunk that triggers a spurious
		// rolldown-plugin-dts:fake-js SOURCEMAP_BROKEN warning. The dts pass excludes them;
		// the JS pass (deriveTargetGroupOptions) still includes bin/cli for the executable.
		const withBin = {
			cwd: "/abs/pkg",
			version: "1.2.3",
			entry: { index: "./src/index.ts", "bin/cli": "./src/bin/cli.ts" },
			tsconfigPath: "/tmp/t.json",
		};
		const dts = deriveDtsPassOptions({ ...withBin, group: "dev", devManifest: "preserve" });
		assert.deepStrictEqual(dts.entry, { index: "./src/index.ts" });
		assert.isFalse("bin/cli" in dts.entry);
		// JS pass must still include bin/cli (it builds the executable).
		const js = deriveTargetGroupOptions({ ...withBin, group: "dev", devManifest: "preserve" });
		assert.deepStrictEqual(js.entry, { index: "./src/index.ts", "bin/cli": "./src/bin/cli.ts" });
	});

	it("dts pass uses the same outDir for a prod group", () => {
		const o = deriveDtsPassOptions({ ...base, group: "npm", devManifest: "preserve" });
		assert.strictEqual(o.outDir, "/abs/pkg/dist/prod/npm/pkg");
	});

	it("dts pass keeps esm+cjs format so both .d.ts and .d.cts emit", () => {
		const o = deriveDtsPassOptions({ ...base, group: "dev", devManifest: "preserve", format: ["esm", "cjs"] });
		assert.deepStrictEqual(o.format, ["esm", "cjs"]);
	});

	it("threads bundledPackages into the dts pass when provided", () => {
		const o = deriveDtsPassOptions({
			...base,
			group: "dev",
			devManifest: "preserve",
			bundledPackages: ["@commitlint/types"],
		});
		assert.deepStrictEqual(o.bundledPackages, ["@commitlint/types"]);
	});

	it("omits bundledPackages from the dts pass when not provided", () => {
		const o = deriveDtsPassOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.isUndefined(o.bundledPackages);
	});
});

describe("define merge (auto-version + user define)", () => {
	const base = { cwd: "/abs/pkg", version: "1.2.3", entry: { index: "./src/index.ts" }, tsconfigPath: "/tmp/t.json" };

	it("JS pass injects process.env.__PACKAGE_VERSION__ and not the bare identifier", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("1.2.3"));
		assert.isUndefined(o.define.__PACKAGE_VERSION__);
	});

	it("dts pass injects process.env.__PACKAGE_VERSION__ and not the bare identifier", () => {
		const o = deriveDtsPassOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("1.2.3"));
		assert.isUndefined(o.define.__PACKAGE_VERSION__);
	});

	it("merges a user define alongside the auto-version", () => {
		const o = deriveTargetGroupOptions({
			...base,
			group: "dev",
			devManifest: "preserve",
			define: { "process.env.FLAG": JSON.stringify("on") },
		});
		assert.strictEqual(o.define["process.env.FLAG"], JSON.stringify("on"));
		assert.strictEqual(o.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("1.2.3"));
	});

	it("lets a user define override the auto-version on key collision", () => {
		const o = deriveTargetGroupOptions({
			...base,
			group: "dev",
			devManifest: "preserve",
			define: { "process.env.__PACKAGE_VERSION__": JSON.stringify("9.9.9") },
		});
		assert.strictEqual(o.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("9.9.9"));
	});
});

describe("deriveTargetGroupOptions platform override", () => {
	const base = { cwd: "/abs/pkg", version: "1.2.3", entry: { index: "./src/index.ts" }, tsconfigPath: "/tmp/t.json" };

	it("defaults platform to node", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve" });
		assert.strictEqual(o.platform, "node");
	});

	it("honors an explicit browser platform (JS pass only)", () => {
		const o = deriveTargetGroupOptions({ ...base, group: "dev", devManifest: "preserve", platform: "browser" });
		assert.strictEqual(o.platform, "browser");
	});
});

import { declarationsDirFor, deriveDeclarationsPassOptions } from "../../src/passes/target-groups.js";

describe("deriveDeclarationsPassOptions", () => {
	const base = {
		group: "npm",
		cwd: "/repo/pkg",
		version: "1.2.3",
		entry: { index: "/repo/pkg/src/index.ts", "bin/cli": "/repo/pkg/src/bin.ts" },
		tsconfigPath: "/tmp/tsconfig.json",
		devManifest: "preserve" as const,
	};

	it("emits per-module (unbundle) declarations into the prod declarations dir, bin excluded", () => {
		const d = deriveDeclarationsPassOptions(base);
		assert.strictEqual(d.unbundle, true);
		assert.strictEqual(d.outDir, "/repo/pkg/dist/prod/npm/declarations");
		const { tsgo: declTsgo, ...declRest } = d.dts as {
			tsgo: { moduleUrl: string };
			dtsOnly?: true;
			emitDtsOnly?: true;
		};
		assert.deepStrictEqual(splitDtsOnly(declRest), { tsconfig: "/tmp/tsconfig.json", generator: "tsgo" });
		assert.match(declTsgo.moduleUrl, /^file:\/\/.*\/typescript\//);
		assert.deepStrictEqual(d.format, ["esm"]);
		assert.strictEqual(d.platform, "node");
		assert.deepStrictEqual(Object.keys(d.entry), ["index"]);
		assert.strictEqual(d.define["process.env.__PACKAGE_VERSION__"], JSON.stringify("1.2.3"));
	});

	it("forwards bundledPackages when present", () => {
		const d = deriveDeclarationsPassOptions({ ...base, bundledPackages: ["zod"] });
		assert.deepStrictEqual(d.bundledPackages, ["zod"]);
	});

	it("declarationsDirFor points at the prod declarations sibling of pkg", () => {
		assert.strictEqual(declarationsDirFor("/repo/pkg", "github"), "/repo/pkg/dist/prod/github/declarations");
	});
});
