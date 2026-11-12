// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/build-target-groups.test.ts on 2026-11-06
// packages/bundler/__test__/passes/build-target-groups.test.ts
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import type { BuildTargetGroupsOptions } from "../../src/passes/build-target-groups.js";
import { buildTargetGroups } from "../../src/passes/build-target-groups.js";
import { BuildCollector } from "../../src/report/collector.js";

/** The pass copies `public/`, writes temp tsconfigs and reads real tsconfig files, so it runs on the host disk. */
const runBuildTargetGroups = (options: BuildTargetGroupsOptions): Promise<void> =>
	Effect.runPromise(buildTargetGroups(options).pipe(Effect.provide(NodeServices.layer)));

// #430: `writeDtsEmitTsconfig` (src/dts/resolved-tsconfig.ts) only derives a temp dts-emit
// tsconfig when its base path resolves via `existsSync` — a synthetic path that happens not to
// exist on disk falls through its best-effort branch and is returned unchanged. To keep the two
// tests below deterministic (rather than depending on whatever incidentally does or doesn't
// already exist at a fixed path — a literal shared path like "/tmp/t.json" is also live-written
// by the vitest-agent MCP reporter itself, so it is not even a stable "leftover"), each test gets
// its OWN real tsconfig file under a unique `mkdtemp` directory, cleaned up afterward.
/** Escape every regex metacharacter in a literal path segment before splicing it into a `RegExp` source. */
function escapeForRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the derived-path naming-contract regex for a given real base tsconfig path, mirroring
 * `writeDtsEmitTsconfig`'s own `join(tmpdir(), "tsconfig-dts-emit-<pid>-<sanitized-base>.json")`
 * scheme. Building the prefix via `join(tmpdir(), "tsconfig-dts-emit-")` (rather than hard-coding a
 * "/" join) keeps this test's expectation platform-correct on a `path.sep` other than "/". Never
 * asserts a literal tmpdir/pid value — only the pattern.
 */
function dtsEmitTsconfigPattern(basePath: string): RegExp {
	const sanitizedBase = basePath.replace(/[^\w]/g, "_");
	const prefixEscaped = escapeForRegExp(join(tmpdir(), "tsconfig-dts-emit-"));
	return new RegExp(`^${prefixEscaped}\\d+-${sanitizedBase}\\.json$`);
}

/**
 * The EXACT derived dts-emit tsconfig path `writeDtsEmitTsconfig` would write for `basePath` in
 * THIS process — same sanitization, same `process.pid` (resolved-tsconfig.ts writes under
 * `tmpdir()` directly, never under the caller's own `mkdtemp` directory, so removing only that
 * directory in `withRealTsconfig`'s `finally` left this file behind on disk after every run).
 */
function derivedDtsEmitTsconfigPath(basePath: string): string {
	const sanitizedBase = basePath.replace(/[^\w]/g, "_");
	return join(tmpdir(), `tsconfig-dts-emit-${process.pid}-${sanitizedBase}.json`);
}

async function withRealTsconfig<T>(run: (tsconfigPath: string, pattern: RegExp) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "btg-real-tsconfig-"));
	const tsconfigPath = join(dir, "tsconfig.json");
	await writeFile(tsconfigPath, "{}\n", "utf-8");
	try {
		return await run(tsconfigPath, dtsEmitTsconfigPattern(tsconfigPath));
	} finally {
		await rm(dir, { recursive: true, force: true });
		await rm(derivedDtsEmitTsconfigPath(tsconfigPath), { force: true });
	}
}

describe("buildTargetGroups", () => {
	it("runs a JS pass + a dts pass per group (two passes to the same outDir)", async () => {
		await withRealTsconfig(async (realTsconfigPath, dtsEmitPattern) => {
			const calls: Array<{
				outDir: string;
				plugins: number;
				hasManifest: boolean;
				dts: unknown;
				unbundle: unknown;
				clean: unknown;
			}> = [];
			const fakeBuild = vi.fn(
				async (cfg: {
					outDir: string;
					plugins: Array<{ name?: string }>;
					dts: unknown;
					unbundle: unknown;
					clean: unknown;
				}) => {
					calls.push({
						outDir: cfg.outDir,
						plugins: cfg.plugins.length,
						hasManifest: cfg.plugins.some((p) => p.name === "savvy:emit-manifest"),
						dts: cfg.dts,
						unbundle: cfg.unbundle,
						clean: cfg.clean,
					});
					return [];
				},
			);
			await runBuildTargetGroups({
				cwd: "/abs/pkg",
				version: "1.0.0",
				entry: { index: "./src/index.ts" },
				tsconfigPath: realTsconfigPath,
				groups: [
					{ id: "dev", name: "base" },
					{ id: "npm", name: "base" },
				],
				devManifest: "preserve",
				build: fakeBuild as never,
			});
			// 2 groups x 2 passes = 4 calls.
			assert.strictEqual(fakeBuild.mock.calls.length, 4);

			// Group "dev": JS pass then dts pass, both to dist/dev/pkg.
			const [devJs, devDts, npmJs, npmDts] = calls;
			assert.strictEqual(devJs.outDir, "/abs/pkg/dist/dev/pkg");
			assert.strictEqual(devDts.outDir, "/abs/pkg/dist/dev/pkg");
			assert.strictEqual(npmJs.outDir, "/abs/pkg/dist/prod/npm/pkg");
			assert.strictEqual(npmDts.outDir, "/abs/pkg/dist/prod/npm/pkg");

			// JS pass: per-module JS, no dts, manifest plugin present, fresh outDir.
			assert.strictEqual(devJs.hasManifest, true);
			assert.strictEqual(devJs.dts, false);
			assert.strictEqual(devJs.unbundle, true);
			assert.strictEqual(devJs.clean, true);

			// dts pass: bundled declarations only, NO manifest plugin, clean:false (keep JS pass output).
			assert.strictEqual(devDts.hasManifest, false);
			// #430: the base tsconfig exists on disk here, so `writeDtsEmitTsconfig` derives a
			// dts-emit variant rather than passing the source path through verbatim — assert the
			// derivation CONTRACT (naming pattern), not a literal path.
			const devDtsConfig = devDts.dts as { tsconfig: string; dtsOnly?: true; emitDtsOnly?: true; generator: string };
			assert.match(devDtsConfig.tsconfig, dtsEmitPattern);
			assert.strictEqual(devDtsConfig.dtsOnly ?? devDtsConfig.emitDtsOnly, true);
			assert.strictEqual(devDtsConfig.generator, "tsgo");
			// Stronger pin: the derived file exists and extends the real base by absolute CANONICAL path.
			const derivedContents = JSON.parse(await readFile(devDtsConfig.tsconfig, "utf-8")) as {
				extends: string;
				compilerOptions: { stableTypeOrdering: boolean };
			};
			assert.strictEqual(derivedContents.extends, realpathSync.native(realTsconfigPath));
			assert.strictEqual(derivedContents.compilerOptions.stableTypeOrdering, true);
			assert.strictEqual(devDts.unbundle, false);
			assert.strictEqual(devDts.clean, false);
		});
	});

	it("runs one dts build PER entry for a multi-entry partition (single-entry rollups, no shared chunk)", async () => {
		// The determinism fix (#185): a multi-entry partition must NOT roll all entries through one
		// dts pass — rolldown then code-splits the shared declarations into a content-hashed sibling
		// chunk whose name/layout is non-deterministic. One single-entry rollup per entry is
		// deterministic by construction and self-contained. The JS pass stays a single per-module pass
		// over all entries; only the dts pass splits.
		const passes: Array<{ kind: "js" | "dts"; entry: Record<string, string> }> = [];
		const build = (async (cfg: { dts: unknown; entry: Record<string, string> }) => {
			passes.push({ kind: cfg.dts === false ? "js" : "dts", entry: cfg.entry });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "./src/index.ts", testing: "./src/testing.ts" },
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		const js = passes.filter((p) => p.kind === "js");
		const dts = passes.filter((p) => p.kind === "dts");
		// One JS pass over all entries (per-module).
		assert.strictEqual(js.length, 1);
		assert.deepStrictEqual(js[0]?.entry, { index: "./src/index.ts", testing: "./src/testing.ts" });
		// One dts pass per entry, each a single-entry map (the deterministic property).
		assert.strictEqual(dts.length, 2);
		for (const d of dts) assert.lengthOf(Object.keys(d.entry), 1);
		assert.deepStrictEqual(
			dts.map((d) => d.entry).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
			[{ index: "./src/index.ts" }, { testing: "./src/testing.ts" }],
		);
	});

	it("emits a re-export STUB for a pure-barrel secondary entry instead of a second dts rollup (#185)", async () => {
		// A `./testing`-style entry that purely re-exports a subset of the primary `index` entry is
		// emitted as a thin `export { … } from "./index.js"` stub — index is the only entry that gets a
		// self-contained dts rollup, keeping the package compact without a shared chunk.
		const dir = await mkdtemp(join(tmpdir(), "btg-stub-"));
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src/index.ts"), "export const A = 1;\nexport const B = 2;\nexport type T = string;\n");
		await writeFile(
			join(dir, "src/testing.ts"),
			'export { A } from "./index.js";\nexport type { T } from "./index.js";\n',
		);

		const dtsEntries: Array<Record<string, string>> = [];
		const build = (async (cfg: { dts: unknown; entry: Record<string, string>; outDir: string }) => {
			if (cfg.dts !== false) dtsEntries.push(cfg.entry);
			// The real JS pass creates/owns the outDir; mirror that so the stub writeFileSync has a dir.
			await mkdir(cfg.outDir, { recursive: true });
		}) as never;
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "./src/index.ts", testing: "./src/testing.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		// Only the base `index` entry is rolled up; `testing` is a stub, not a dts build.
		assert.deepStrictEqual(dtsEntries, [{ index: "./src/index.ts" }]);
		const stub = await readFile(join(dir, "dist/dev/pkg/testing.d.ts"), "utf-8");
		assert.strictEqual(stub, 'export { A } from "./index.js";\nexport type { T } from "./index.js";\n');
	}, 30_000);

	it("does NOT stub a secondary entry that is not a pure re-export barrel (keeps it self-contained)", async () => {
		// `testing` here declares a local symbol, so it is NOT expressible as a stub of index — it must
		// get its own self-contained dts rollup (two dts builds, no stub file written).
		const dir = await mkdtemp(join(tmpdir(), "btg-nostub-"));
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src/index.ts"), "export const A = 1;\n");
		await writeFile(join(dir, "src/testing.ts"), 'export { A } from "./index.js";\nexport const own = 2;\n');

		const dtsEntries: Array<Record<string, string>> = [];
		const build = (async (cfg: { dts: unknown; entry: Record<string, string>; outDir: string }) => {
			if (cfg.dts !== false) dtsEntries.push(cfg.entry);
			await mkdir(cfg.outDir, { recursive: true });
		}) as never;
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "./src/index.ts", testing: "./src/testing.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		// Both entries get a self-contained rollup; no stub short-circuit.
		assert.lengthOf(dtsEntries, 2);
		assert.deepStrictEqual(dtsEntries.map((e) => Object.keys(e)[0]).sort(), ["index", "testing"]);
	}, 30_000);

	it("builds once per group spec, threading the spec's name and the drop keys into the manifest pipeline", async () => {
		const dir = await mkdtemp(join(tmpdir(), "btg-"));
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "base", version: "1.0.0", dependencies: { effect: "^3.0.0" }, keywords: ["k"] }),
		);
		// Make the temp dir its own workspace root so resolveManifest assembles an empty catalog
		// set instead of walking up to the host workspace (90-entry catalogs + large lockfile).
		await writeFile(join(dir, "pnpm-workspace.yaml"), "packages: []\n");

		const calls: Array<{ outDir: string }> = [];
		// Drive each group's emitManifest plugin so the manifest pipeline runs for real and the
		// emitted package.json (name, dropped keys) can be inspected per group.
		const build = (async (cfg: {
			outDir: string;
			plugins: Array<{ name: string; generateBundle?: () => Promise<void> }>;
		}) => {
			calls.push({ outDir: cfg.outDir });
			const emit = cfg.plugins.find((p) => p.name === "savvy:emit-manifest");
			await emit?.generateBundle?.call({
				emitFile(file: { fileName: string; source: string }) {
					if (file.fileName === "package.json") emitted.push(JSON.parse(file.source) as Record<string, unknown>);
				},
			});
		}) as never;

		const emitted: Array<Record<string, unknown>> = [];
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [
				{ id: "npm", name: "base" },
				{ id: "github", name: "@scope/base" },
			],
			devManifest: "preserve",
			drop: ["dependencies"],
			build,
		});

		// Two passes per group share an outDir, so dedup before comparing.
		assert.deepStrictEqual([...new Set(calls.map((c) => c.outDir))].sort(), [
			join(dir, "dist/prod/github/pkg"),
			join(dir, "dist/prod/npm/pkg"),
		]);
		// The manifest is emitted once per group (JS pass only), not on the dts pass: each carries its
		// group's name, and the dropped key is gone while the rest survives.
		assert.deepStrictEqual(emitted.map((m) => m.name).sort(), ["@scope/base", "base"]);
		assert.strictEqual(
			emitted.every((m) => m.dependencies === undefined && Array.isArray(m.keywords)),
			true,
		);
	}, 30_000); // real fs (mkdtemp + manifest read) can starve past the 5s default under full-suite load

	it("never sets rolldown inputOptions on any pass (JSX is applied via the tsconfig, issue #170)", async () => {
		const captured: Array<{ inputOptions: unknown }> = [];
		const build = (async (cfg: { inputOptions?: unknown }) => {
			captured.push({ inputOptions: cfg.inputOptions });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		// A top-level `jsx` in rolldown inputOptions is invalid ("Expected never"); the build must
		// never forward one — every pass leaves inputOptions undefined.
		assert.isAbove(captured.length, 0);
		for (const c of captured) assert.isUndefined(c.inputOptions);
	});

	it("attaches the cjs-default-interop plugin to BOTH the JS and dts passes only when format includes cjs", async () => {
		// Capture plugin names per pass. The JS pass has dts === false; the dts pass has dts
		// !== false (the dtsOnly pass). The dts-pass attachment is LOAD-BEARING: tsdown's
		// dts pass re-emits the .cjs for dual format and would overwrite the JS pass's footer,
		// so the interop plugin MUST be present there too (a refactor dropping it would silently
		// regress the lint:md fix while every JS-pass-only assertion still passes).
		const passes: Array<{ kind: "js" | "dts"; plugins: Array<string> }> = [];
		const build = (async (cfg: { dts: unknown; plugins: Array<{ name?: string }> }) => {
			passes.push({
				kind: cfg.dts === false ? "js" : "dts",
				plugins: cfg.plugins.map((p) => p.name ?? ""),
			});
		}) as never;

		// esm-only (default): interop plugin absent from BOTH passes.
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		const esmJs = passes.find((p) => p.kind === "js");
		const esmDts = passes.find((p) => p.kind === "dts");
		assert.notInclude(esmJs?.plugins ?? [], "savvy:cjs-default-interop");
		assert.notInclude(esmDts?.plugins ?? [], "savvy:cjs-default-interop");

		// dual esm+cjs: interop plugin present on BOTH the JS pass and the dts pass.
		passes.length = 0;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm", "cjs"],
			build,
		});
		const dualJs = passes.find((p) => p.kind === "js");
		const dualDts = passes.find((p) => p.kind === "dts");
		assert.include(dualJs?.plugins ?? [], "savvy:cjs-default-interop");
		assert.include(dualDts?.plugins ?? [], "savvy:cjs-default-interop");
	});

	it("emits dual import/require export conditions when format includes cjs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "btg-"));
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "base", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
		);

		// Drive the emitManifest plugin's generateBundle hook, capturing the emitted package.json.
		const captureBuild = (manifests: Array<Record<string, unknown>>) =>
			(async (cfg: { plugins: Array<{ name: string; generateBundle?: () => Promise<void> }> }) => {
				const emit = cfg.plugins.find((p) => p.name === "savvy:emit-manifest");
				await emit?.generateBundle?.call({
					emitFile(file: { fileName: string; source: string }) {
						if (file.fileName === "package.json") manifests.push(JSON.parse(file.source));
					},
				});
			}) as never;

		const dual: Array<Record<string, unknown>> = [];
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm", "cjs"],
			build: captureBuild(dual),
		});
		assert.deepStrictEqual((dual[0]?.exports as Record<string, unknown> | undefined)?.["."], {
			types: "./index.d.ts",
			import: "./index.js",
			require: "./index.cjs",
			default: "./index.js",
		});

		const esm: Array<Record<string, unknown>> = [];
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build: captureBuild(esm),
		});
		assert.deepStrictEqual((esm[0]?.exports as Record<string, unknown> | undefined)?.["."], {
			types: "./index.d.ts",
			import: "./index.js",
			default: "./index.js",
		});
	}, 30_000); // real fs (mkdtemp + manifest read) can starve past the 5s default under full-suite load

	it("enables cjs interop on the tsdown build when cjs is in the format", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const build = (async (cfg: Record<string, unknown>) => {
			captured.push(cfg);
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm", "cjs"],
			build,
		});
		assert.strictEqual(captured[0]?.cjsDefault, true);
	});

	it("omits cjs interop when the format is esm-only", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const build = (async (cfg: Record<string, unknown>) => {
			captured.push(cfg);
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		assert.isUndefined(captured[0]?.cjsDefault);
	});

	it("passes the configured format through to the tsdown build", async () => {
		const captured: Array<{ format?: unknown }> = [];
		const build = (async (cfg: { format?: unknown }) => {
			captured.push({ format: cfg.format });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm", "cjs"],
			build,
		});
		assert.deepStrictEqual(captured[0]?.format, ["esm", "cjs"]);
	});

	it("threads `bundle` into the JS-pass deps.alwaysBundle (force-inline), alongside neverBundle", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["effect"],
			bundle: ["semver-effect", "@savvy-web/silk-effects"],
			build,
		});
		// [0] = JS pass: alwaysBundle present (force-inline), coexisting with neverBundle.
		assert.deepStrictEqual((captured[0]?.deps as { alwaysBundle?: unknown })?.alwaysBundle, [
			"semver-effect",
			"@savvy-web/silk-effects",
		]);
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, ["effect"]);
		// The dts pass RE-EMITS the dual-format `.cjs` chunk (see build-target-groups.ts), so it
		// must carry the SAME `alwaysBundle` as the JS pass or a force-bundled declared dependency
		// gets re-externalized in that re-emitted `.cjs` (the silk workaround this closed).
		assert.deepStrictEqual((captured[1]?.deps as { alwaysBundle?: unknown } | undefined)?.alwaysBundle, [
			"semver-effect",
			"@savvy-web/silk-effects",
		]);
	});

	it("creates a `deps` object off `bundle` alone on the dts pass, with no stray neverBundle", async () => {
		// `bundle` with no `externals`/`dtsExternals`/`bundledPackages` must still widen the
		// dtsDeps guard (previously `dtsNeverBundle.length > 0 || dts.bundledPackages`, which a
		// bundle-only partition never satisfied) and produce a `deps` object carrying ONLY
		// `alwaysBundle` — no `neverBundle` key at all, since nothing was externalized.
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			bundle: ["@savvy-web/silk-effects"],
			build,
		});
		// [0] = JS pass, [1] = dts pass.
		assert.deepStrictEqual(captured[1]?.deps, { alwaysBundle: ["@savvy-web/silk-effects"] });
	});

	it("creates a `deps` object off `bundle` alone on the declarations pass (Pass 3), with no stray neverBundle", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const build = async (cfg: Record<string, unknown>) => {
			calls.push(cfg);
		};
		await runBuildTargetGroups({
			cwd: "/repo/pkg",
			version: "1.0.0",
			entry: { index: "/repo/pkg/src/index.ts" },
			tsconfigPath: "/tmp/tsconfig.json",
			groups: [{ id: "npm", name: "pkg" }],
			devManifest: "preserve",
			bundle: ["@savvy-web/silk-effects"],
			emitDeclarations: true,
			build,
		});
		const decl = calls.find((c) => c.unbundle === true && String(c.outDir).endsWith("/dist/prod/npm/declarations"));
		assert.isDefined(decl);
		assert.deepStrictEqual(decl?.deps, { alwaysBundle: ["@savvy-web/silk-effects"] });
	});

	it("omits alwaysBundle when `bundle` is not set", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["effect"],
			build,
		});
		assert.isUndefined((captured[0]?.deps as { alwaysBundle?: unknown } | undefined)?.alwaysBundle);
	});

	it("inlines bundledPackages in the dts pass via neverBundle: true + deps.dts.alwaysBundle, not the JS pass", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			bundledPackages: ["@commitlint/types"],
			build,
		});
		// [0] = JS pass, [1] = dts pass for the single group.
		// JS pass must NOT carry the dts-only inlining knobs.
		assert.isUndefined((captured[0]?.deps as { onlyBundle?: unknown } | undefined)?.onlyBundle);
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown } | undefined)?.neverBundle, ["typescript"]);
		assert.isUndefined((captured[0]?.deps as { dts?: unknown } | undefined)?.dts);
		// dts pass: externalize everything, force-bundle only the listed packages.
		// onlyBundle is intentionally NOT used (it puts tsdown into strict mode).
		assert.isUndefined((captured[1]?.deps as { onlyBundle?: unknown })?.onlyBundle);
		assert.deepStrictEqual((captured[1]?.deps as { dts?: { alwaysBundle?: unknown } })?.dts?.alwaysBundle, [
			"@commitlint/types",
		]);
		// `neverBundle: true` supersedes the externals array on this pass — it is a strict
		// superset of it (externalize EVERY node_modules type), and deps.dts.alwaysBundle
		// opts the listed packages back in.
		assert.strictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, true);
	});

	it("inlines bundledPackages via neverBundle: true when bundledPackages is set but externals are not", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			bundledPackages: ["@commitlint/types"],
			build,
		});
		// JS pass: no deps at all.
		assert.isUndefined(captured[0]?.deps);
		// dts pass: neverBundle: true + dts.alwaysBundle present.
		assert.isUndefined((captured[1]?.deps as { onlyBundle?: unknown })?.onlyBundle);
		assert.strictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, true);
		assert.deepStrictEqual((captured[1]?.deps as { dts?: { alwaysBundle?: unknown } })?.dts?.alwaysBundle, [
			"@commitlint/types",
		]);
	});

	it("inlines all node_modules into BOTH passes when bundleNodeModules is set (dts posture tracks the JS pass)", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			bundleNodeModules: true,
			build,
		});
		// [0] = JS pass: neverBundle (externals) only. bundleNodeModules contributes NO deps
		// flag — inlining node_modules is tsdown's default; the option acts via unbundle:false.
		assert.notProperty(captured[0]?.deps as Record<string, unknown>, "skipNodeModulesBundle");
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
		// [1] = dts pass: must MATCH the JS posture so the declarations are self-contained
		// (rslib parity) — i.e. NOT neverBundle: true, which would externalize every type. No
		// dts.alwaysBundle because bundledPackages is not set.
		assert.notProperty(captured[1]?.deps as Record<string, unknown>, "skipNodeModulesBundle");
		assert.isUndefined((captured[1]?.deps as { dts?: unknown })?.dts);
		assert.deepStrictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
	});

	it("inlines all node_modules into the dts AND keeps dts.alwaysBundle when both bundleNodeModules and bundledPackages are set", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			bundleNodeModules: true,
			bundledPackages: ["@commitlint/types"],
			build,
		});
		// JS pass unchanged: no dts/onlyBundle inlining knobs.
		assert.isUndefined((captured[0]?.deps as { dts?: unknown })?.dts);
		// dts pass: bundleNodeModules wins — the default posture inlines everything, so
		// neverBundle stays the externals array (never promoted to true), and dts.alwaysBundle
		// is included as belt-and-suspenders since bundledPackages is set.
		assert.deepStrictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
		assert.deepStrictEqual((captured[1]?.deps as { dts?: { alwaysBundle?: unknown } })?.dts?.alwaysBundle, [
			"@commitlint/types",
		]);
		// onlyBundle is never used (strict-mode trap).
		assert.isUndefined((captured[1]?.deps as { onlyBundle?: unknown })?.onlyBundle);
	});

	it("emits no JS-pass deps at all when bundleNodeModules is set and no externals are configured", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			bundleNodeModules: true,
			build,
		});
		// bundleNodeModules alone contributes nothing to deps, so with no externals and no
		// `bundle` there is no deps object to emit.
		assert.isUndefined(captured[0]?.deps);
	});

	it("leaves the JS pass deps unchanged when bundleNodeModules is absent or false", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			build,
		});
		// JS pass: only neverBundle, no deprecated skipNodeModulesBundle key.
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
		assert.notProperty(captured[0]?.deps as Record<string, unknown>, "skipNodeModulesBundle");
	});

	it("turns the JS pass unbundle OFF when bundleNodeModules is set (self-contained esm+cjs)", async () => {
		// Regression test for the packed-esm defect: a per-module (preserveModules) JS pass
		// writes every inlined node_modules dependency it bundles to its OWN sibling file,
		// mirroring its node_modules/... path — which `npm pack` strips, so the esm entry
		// throws `Cannot find module` once packed and installed. bundleNodeModules already
		// promises a self-contained artifact (its own TSDoc says so); the JS pass must
		// actually bundle (not preserve modules) to keep that promise for BOTH esm and cjs.
		const captured: Array<{ unbundle?: unknown; dts?: unknown }> = [];
		const build = (async (cfg: { unbundle?: unknown; dts?: unknown }) => {
			captured.push({ unbundle: cfg.unbundle, dts: cfg.dts });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm", "cjs"],
			bundleNodeModules: true,
			build,
		});
		// [0] = JS pass (dts:false): unbundle must be false so both esm and cjs bundle whole.
		assert.strictEqual(captured[0]?.dts, false);
		assert.strictEqual(captured[0]?.unbundle, false);
		// [1] = dts pass: already unbundle:false regardless — unaffected, still bundled.
		assert.strictEqual(captured[1]?.unbundle, false);
	});

	it("leaves the JS pass unbundle ON when bundleNodeModules is absent (default per-module layout)", async () => {
		const captured: Array<{ unbundle?: unknown; dts?: unknown }> = [];
		const build = (async (cfg: { unbundle?: unknown; dts?: unknown }) => {
			captured.push({ unbundle: cfg.unbundle, dts: cfg.dts });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		assert.strictEqual(captured[0]?.dts, false);
		assert.strictEqual(captured[0]?.unbundle, true);
	});

	it("keeps the leaf dts pass deps byte-identical (only neverBundle) when neither bundle flag is set", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["effect"],
			build,
		});
		// dts pass (the four-leaves else-branch): neverBundle ONLY — no skipNodeModulesBundle,
		// no dts.alwaysBundle, no onlyBundle. This guards against regressing the leaves.
		assert.deepStrictEqual(captured[1]?.deps, { neverBundle: ["effect"] });
	});

	it("emits no deps at all on either pass when no externals and no bundle flags are set", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build,
		});
		assert.isUndefined(captured[0]?.deps);
		assert.isUndefined(captured[1]?.deps);
	});

	it("emits no deps at all on either pass when externals is an explicit empty array and no bundle flags are set", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			// Explicit empty array (the runBuild default). An empty array is truthy, so a
			// naive truthy guard would emit a spurious empty `deps: {}` on both passes.
			externals: [],
			build,
		});
		assert.isUndefined(captured[0]?.deps);
		assert.isUndefined(captured[1]?.deps);
	});

	it("unions dtsExternals into the dts pass neverBundle while the JS pass bundles them (bundleNodeModules)", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript", "source-map-support"],
			bundleNodeModules: true,
			bundledPackages: ["@commitlint/types"],
			dtsExternals: ["effect", "@effect/platform"],
			build,
		});
		// JS pass: still force-bundles node_modules; neverBundle is the externals ONLY,
		// NOT the dtsExternals (the JS pass bundles effect for the self-contained runtime).
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, [
			"typescript",
			"source-map-support",
		]);
		// dts pass: neverBundle is the UNION of externals + dtsExternals, so effect stays an
		// external import reference in the .d.ts while every other node_modules type inlines.
		assert.deepStrictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, [
			"typescript",
			"source-map-support",
			"effect",
			"@effect/platform",
		]);
		assert.deepStrictEqual((captured[1]?.deps as { dts?: { alwaysBundle?: unknown } })?.dts?.alwaysBundle, [
			"@commitlint/types",
		]);
	});

	it("unions dtsExternals into the dts pass neverBundle with no externals configured", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			bundleNodeModules: true,
			dtsExternals: ["effect"],
			build,
		});
		// JS pass: no neverBundle (no externals), so no deps object at all.
		assert.isUndefined(captured[0]?.deps);
		// dts pass: neverBundle is just the dtsExternals — never promoted to true, since
		// bundleNodeModules wants every OTHER node_modules type inlined.
		assert.deepStrictEqual(captured[1]?.deps, { neverBundle: ["effect"] });
	});

	it("unions dtsExternals into the dts pass neverBundle in the bundledPackages-only branch", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			bundledPackages: ["@commitlint/types"],
			dtsExternals: ["effect"],
			build,
		});
		// JS pass: neverBundle is externals only (no dtsExternals, no bundle flag here).
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
		// dts pass: neverBundle: true supersedes the externals+dtsExternals union (a strict
		// superset of it — both stay external), and dts.alwaysBundle is preserved.
		assert.strictEqual((captured[1]?.deps as { neverBundle?: unknown })?.neverBundle, true);
		assert.deepStrictEqual((captured[1]?.deps as { dts?: { alwaysBundle?: unknown } })?.dts?.alwaysBundle, [
			"@commitlint/types",
		]);
	});

	it("builds a base partition plus an override partition with per-partition format/deps", async () => {
		const calls: Array<{ entry: unknown; format: unknown; clean: unknown; deps?: unknown; hasManifest: boolean }> = [];
		const build = (async (cfg: {
			entry: unknown;
			format: unknown;
			clean: unknown;
			deps?: unknown;
			plugins?: Array<{ name?: string }>;
		}) => {
			calls.push({
				entry: cfg.entry,
				format: cfg.format,
				clean: cfg.clean,
				deps: cfg.deps,
				hasManifest: (cfg.plugins ?? []).some((p) => p.name === "savvy:emit-manifest"),
			});
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { commitlint: "src/commitlint/index.ts" }, // BASE entries only (overrides removed upstream)
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			format: ["esm"],
			overrides: [
				{
					entry: { "changesets-markdownlint": "src/changesets/markdownlint.ts" },
					format: ["esm", "cjs"],
					bundle: ["@savvy-web/silk-effects"],
				},
			],
			build,
		});
		// Order: base JS (clean:true), base dts (clean:false), override JS (clean:false), override dts (clean:false).
		assert.strictEqual(calls[0]?.clean, true);
		assert.deepStrictEqual(calls[0]?.entry, { commitlint: "src/commitlint/index.ts" });
		assert.deepStrictEqual(calls[0]?.format, ["esm"]);
		// every later pass is clean:false (never wipes the base output)
		assert.strictEqual(
			calls.slice(1).every((c) => c.clean === false),
			true,
		);
		// an override JS pass carries the override entry, dual format, and alwaysBundle
		const overrideJs = calls.find(
			(c) =>
				JSON.stringify(c.entry) === JSON.stringify({ "changesets-markdownlint": "src/changesets/markdownlint.ts" }) &&
				Array.isArray(c.format) &&
				(c.format as string[]).includes("cjs"),
		);
		assert.isDefined(overrideJs);
		assert.deepStrictEqual((overrideJs?.deps as { alwaysBundle?: unknown })?.alwaysBundle, ["@savvy-web/silk-effects"]);
		// manifest is emitted exactly once (base partition's JS pass only)
		assert.strictEqual(calls.filter((c) => c.hasManifest).length, 1);
		assert.strictEqual(calls[0]?.hasManifest, true);
	});

	it("threads a user define into the build() define alongside the auto-version", async () => {
		const defines: Array<Record<string, string>> = [];
		const fakeBuild = vi.fn(async (cfg: { define?: Record<string, string> }) => {
			if (cfg.define) defines.push(cfg.define);
			return [];
		});
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "2.0.0",
			entry: { index: "./src/index.ts" },
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			define: { "process.env.FLAG": JSON.stringify("on") },
			build: fakeBuild as never,
		});
		// Both passes (JS + dts) receive the merged define.
		assert.strictEqual(defines.length, 2);
		for (const d of defines) {
			assert.strictEqual(d["process.env.FLAG"], JSON.stringify("on"));
			assert.strictEqual(d["process.env.__PACKAGE_VERSION__"], JSON.stringify("2.0.0"));
		}
	});

	it("unions dtsExternals into the dts pass neverBundle in the plain branch (no bundle flags)", async () => {
		const captured: Array<{ deps?: unknown }> = [];
		const build = (async (cfg: { deps?: unknown }) => {
			captured.push({ deps: cfg.deps });
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			externals: ["typescript"],
			dtsExternals: ["effect"],
			build,
		});
		// JS pass: externals only.
		assert.deepStrictEqual((captured[0]?.deps as { neverBundle?: unknown })?.neverBundle, ["typescript"]);
		// dts pass: union, nothing else (plain leaf branch).
		assert.deepStrictEqual(captured[1]?.deps, { neverBundle: ["typescript", "effect"] });
	});

	it("emits one extra bundled, no-dts, no-manifest pass per loose file, after the base passes", async () => {
		const calls: Array<{
			entry: unknown;
			format: unknown;
			fixedExtension: unknown;
			unbundle: unknown;
			clean: unknown;
			dts: unknown;
			outDir: string;
			hasManifest: boolean;
			deps?: unknown;
		}> = [];
		const build = (async (cfg: {
			entry: unknown;
			format: unknown;
			fixedExtension: unknown;
			unbundle: unknown;
			clean: unknown;
			dts: unknown;
			outDir: string;
			plugins?: Array<{ name?: string }>;
			deps?: unknown;
		}) => {
			calls.push({
				entry: cfg.entry,
				format: cfg.format,
				fixedExtension: cfg.fixedExtension,
				unbundle: cfg.unbundle,
				clean: cfg.clean,
				dts: cfg.dts,
				outDir: cfg.outDir,
				hasManifest: (cfg.plugins ?? []).some((p) => p.name === "savvy:emit-manifest"),
				deps: cfg.deps,
			});
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			bundleNodeModules: true,
			looseFiles: [
				{
					outFile: "pnpmfile.mjs",
					entryName: "pnpmfile",
					source: "./src/pnpmfile.ts",
					format: "esm",
					fixedExtension: true,
				},
				{
					outFile: "pnpmfile.cjs",
					entryName: "pnpmfile",
					source: "./src/pnpmfile.ts",
					format: "cjs",
					fixedExtension: true,
				},
			],
			build,
		});
		// base JS + base dts (2) + one pass per loose file (2) = 4 calls.
		assert.strictEqual(calls.length, 4);
		const loose = calls.slice(2);
		// ESM loose file: single entry, bundled, fixed extension, no dts, no manifest, clean:false.
		const mjs = loose.find((c) => Array.isArray(c.format) && (c.format as string[])[0] === "esm");
		assert.deepStrictEqual(mjs?.entry, { pnpmfile: "./src/pnpmfile.ts" });
		assert.deepStrictEqual(mjs?.format, ["esm"]);
		assert.strictEqual(mjs?.fixedExtension, true);
		assert.strictEqual(mjs?.unbundle, false);
		assert.strictEqual(mjs?.dts, false);
		assert.strictEqual(mjs?.clean, false);
		assert.strictEqual(mjs?.hasManifest, false);
		assert.strictEqual(mjs?.outDir, "/abs/pkg/dist/dev/pkg");
		// bundleNodeModules posture is inherited so the loose file is self-contained: nothing is
		// externalized, so the pass carries no deps object at all.
		assert.isUndefined(mjs?.deps);
		// CJS loose file present with cjs format.
		const cjs = loose.find((c) => Array.isArray(c.format) && (c.format as string[])[0] === "cjs");
		assert.deepStrictEqual(cjs?.format, ["cjs"]);
	});

	it("attaches the cjs interop plugins to a cjs loose file but not an esm one", async () => {
		const passes: Array<{ format: string; plugins: string[] }> = [];
		const build = (async (cfg: {
			format: string[];
			dts: unknown;
			unbundle: unknown;
			plugins?: Array<{ name?: string }>;
		}) => {
			// Capture ONLY the loose-file passes. They are uniquely identified by unbundle:false
			// (bundled) AND dts:false: the base JS pass is unbundle:true, and the dts pass has
			// dts !== false. Filtering on dts:false alone would also match the base ESM JS pass
			// (deriveTargetGroupOptions emits it with dts:false + format:["esm"]), so `esm` would
			// resolve to the base pass and the esm assertion would have a blind spot.
			if (cfg.unbundle === false && cfg.dts === false && Array.isArray(cfg.format) && cfg.format.length === 1) {
				passes.push({ format: cfg.format[0] as string, plugins: (cfg.plugins ?? []).map((p) => p.name ?? "") });
			}
		}) as never;
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: "/abs/pkg/tsconfig.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			looseFiles: [
				{
					outFile: "pnpmfile.mjs",
					entryName: "pnpmfile",
					source: "./src/pnpmfile.ts",
					format: "esm",
					fixedExtension: true,
				},
				{
					outFile: "pnpmfile.cjs",
					entryName: "pnpmfile",
					source: "./src/pnpmfile.ts",
					format: "cjs",
					fixedExtension: true,
				},
			],
			build,
		});
		// Exactly the two loose-file passes were captured (the base JS/dts passes are excluded),
		// so `esm` below is genuinely the ESM loose-file pass, not the base ESM JS pass.
		assert.strictEqual(passes.length, 2);
		const esm = passes.find((p) => p.format === "esm");
		const cjs = passes.find((p) => p.format === "cjs");
		assert.notInclude(esm?.plugins ?? [], "savvy:cjs-default-interop");
		assert.notInclude(esm?.plugins ?? [], "savvy:node-builtin-default-interop");
		assert.include(cjs?.plugins ?? [], "savvy:cjs-default-interop");
		assert.include(cjs?.plugins ?? [], "savvy:node-builtin-default-interop");
	});

	it("threads an override partition's platform + css into the JS pass only", async () => {
		const calls: Array<{ platform: unknown; css: unknown; dts: unknown; entry: Record<string, string> }> = [];
		const fakeBuild = vi.fn(
			async (cfg: { platform: unknown; css?: unknown; dts: unknown; entry: Record<string, string> }) => {
				calls.push({ platform: cfg.platform, css: cfg.css, dts: cfg.dts, entry: cfg.entry });
				return [];
			},
		);
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "./src/index.ts" }, // base (plugin) entry
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			overrides: [
				{
					entry: { "runtime/index": "./src/runtime/index.tsx" },
					platform: "browser",
					css: { modules: { localsConvention: "camelCaseOnly", namedExport: false } },
					externals: ["react", "@theme"],
				},
			],
			build: fakeBuild as never,
		});

		// 1 group x (base JS, base dts, override JS, override dts) = 4 calls.
		assert.strictEqual(fakeBuild.mock.calls.length, 4);
		const [baseJs, baseDts, ovJs, ovDts] = calls;

		// Base partition JS pass: node platform, no css.
		assert.strictEqual(baseJs?.platform, "node");
		assert.isUndefined(baseJs?.css);

		// Base dts pass: stays node, NO css (types do not carry CSS config).
		assert.strictEqual(baseDts?.platform, "node");
		assert.isUndefined(baseDts?.css);

		// Override JS pass: browser platform + css forwarded.
		assert.strictEqual(ovJs?.platform, "browser");
		assert.deepStrictEqual(ovJs?.css, { modules: { localsConvention: "camelCaseOnly", namedExport: false } });
		assert.strictEqual(ovJs?.dts, false);

		// Override dts pass: stays node, NO css (types resolve via ambient declarations).
		assert.strictEqual(ovDts?.platform, "node");
		assert.isUndefined(ovDts?.css);
	});

	it("routes an override partition with outSubdir into a nested outDir (both passes)", async () => {
		await withRealTsconfig(async (realTsconfigPath, dtsEmitPattern) => {
			const calls: Array<{ outDir: string; dts: unknown }> = [];
			const fakeBuild = vi.fn(async (cfg: { outDir: string; dts: unknown }) => {
				calls.push({ outDir: cfg.outDir, dts: cfg.dts });
				return [];
			});
			await runBuildTargetGroups({
				cwd: "/abs/pkg",
				version: "1.0.0",
				entry: { index: "./src/index.ts" },
				tsconfigPath: realTsconfigPath,
				groups: [{ id: "dev", name: "base" }],
				devManifest: "preserve",
				overrides: [
					{
						entry: { index: "./src/runtime/index.tsx" },
						outSubdir: "runtime",
						platform: "browser",
						css: { modules: { localsConvention: "camelCaseOnly", namedExport: false }, inject: true },
						externals: ["react", "@theme"],
					},
				],
				build: fakeBuild as never,
			});

			// base JS, base dts, runtime JS, runtime dts = 4 calls.
			assert.strictEqual(fakeBuild.mock.calls.length, 4);
			const [baseJs, baseDts, rtJs, rtDts] = calls;
			assert.strictEqual(baseJs.outDir, "/abs/pkg/dist/dev/pkg");
			assert.strictEqual(baseDts.outDir, "/abs/pkg/dist/dev/pkg");
			assert.strictEqual(rtJs.outDir, "/abs/pkg/dist/dev/pkg/runtime");
			assert.strictEqual(rtJs.dts, false);
			assert.strictEqual(rtDts.outDir, "/abs/pkg/dist/dev/pkg/runtime");
			// #430: same derived-tsconfig contract as the JS+dts-pass test above — the base exists
			// on disk, so the dts pass gets a derived temp tsconfig, not the source path verbatim.
			const rtDtsConfig = rtDts.dts as { tsconfig: string; dtsOnly?: true; emitDtsOnly?: true; generator: string };
			assert.match(rtDtsConfig.tsconfig, dtsEmitPattern);
			assert.strictEqual(rtDtsConfig.dtsOnly ?? rtDtsConfig.emitDtsOnly, true);
			assert.strictEqual(rtDtsConfig.generator, "tsgo");
		});
	});

	it("skips the dts pass when all entries are bin/ (empty dts entry after bin filter)", async () => {
		// A partition whose only entry is a bin/ executable gets no .d.ts. deriveDtsPassOptions
		// strips all bin/-prefixed keys, leaving an empty entry map. The guard in buildTargetGroups
		// skips the dts build() call so tsdown never receives "No input files".
		const calls: Array<{ dts: unknown }> = [];
		const fakeBuild = vi.fn(async (cfg: { dts: unknown }) => {
			calls.push({ dts: cfg.dts });
			return [];
		});
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { "bin/cli": "./src/bin/cli.ts" },
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			build: fakeBuild as never,
		});
		// Only the JS pass runs (dts:false). No dts build() call.
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0]?.dts, false);
	});

	it("runs a third per-module declarations pass into declarations/ when emitDeclarations is set", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const build = async (cfg: Record<string, unknown>) => {
			calls.push(cfg);
		};
		await runBuildTargetGroups({
			cwd: "/repo/pkg",
			version: "1.0.0",
			entry: { index: "/repo/pkg/src/index.ts" },
			tsconfigPath: "/tmp/tsconfig.json",
			groups: [{ id: "npm", name: "pkg" }],
			devManifest: "preserve",
			emitDeclarations: true,
			build,
		});
		const decl = calls.find((c) => c.unbundle === true && String(c.outDir).endsWith("/dist/prod/npm/declarations"));
		assert.isDefined(decl);
		const { tsgo, dtsOnly, emitDtsOnly, ...declDts } = (decl as { dts: unknown }).dts as {
			tsgo: { moduleUrl: string };
			dtsOnly?: true;
			emitDtsOnly?: true;
		};
		assert.strictEqual(dtsOnly ?? emitDtsOnly, true);
		assert.deepStrictEqual(declDts, { tsconfig: "/tmp/tsconfig.json", generator: "tsgo" });
		assert.match(tsgo.moduleUrl, /^file:\/\/.*\/typescript\//);
		assert.strictEqual(decl?.clean, true);
	});

	it("threads `bundle` into the declarations pass (Pass 3) deps.alwaysBundle too", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const build = async (cfg: Record<string, unknown>) => {
			calls.push(cfg);
		};
		await runBuildTargetGroups({
			cwd: "/repo/pkg",
			version: "1.0.0",
			entry: { index: "/repo/pkg/src/index.ts" },
			tsconfigPath: "/tmp/tsconfig.json",
			groups: [{ id: "npm", name: "pkg" }],
			devManifest: "preserve",
			externals: ["effect"],
			bundle: ["@savvy-web/silk-effects"],
			emitDeclarations: true,
			build,
		});
		const decl = calls.find((c) => c.unbundle === true && String(c.outDir).endsWith("/dist/prod/npm/declarations"));
		assert.isDefined(decl);
		assert.deepStrictEqual((decl?.deps as { alwaysBundle?: unknown } | undefined)?.alwaysBundle, [
			"@savvy-web/silk-effects",
		]);
		assert.deepStrictEqual((decl?.deps as { neverBundle?: unknown } | undefined)?.neverBundle, ["effect"]);
	});

	it("declarations pass is best-effort: a failure does not abort the build and is recorded", async () => {
		const collector = new BuildCollector();
		const build = async (cfg: Record<string, unknown>) => {
			// Only the per-module declarations pass throws; the published JS + dts passes succeed.
			if (String(cfg.outDir).endsWith("/declarations")) throw new Error("decl boom");
		};
		assert.isUndefined(
			await runBuildTargetGroups({
				cwd: "/repo/pkg",
				version: "1.0.0",
				entry: { index: "/repo/pkg/src/index.ts" },
				tsconfigPath: "/tmp/tsconfig.json",
				groups: [{ id: "npm", name: "pkg" }],
				devManifest: "preserve",
				emitDeclarations: true,
				build,
				collector,
			}),
		);
		// pkg/ (JS+dts) still emitted; only the diagnostics-input pass failed, surfaced as a warning.
		assert.include(JSON.stringify(collector.snapshot("pkg")), "Could not emit per-module declarations");
	});

	it("does NOT run a declarations pass when emitDeclarations is absent (byte-identical default)", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const build = async (cfg: Record<string, unknown>) => {
			calls.push(cfg);
		};
		await runBuildTargetGroups({
			cwd: "/repo/pkg",
			version: "1.0.0",
			entry: { index: "/repo/pkg/src/index.ts" },
			tsconfigPath: "/tmp/tsconfig.json",
			groups: [{ id: "npm", name: "pkg" }],
			devManifest: "preserve",
			build,
		});
		assert.strictEqual(
			calls.some((c) => String(c.outDir).endsWith("/declarations")),
			false,
		);
	});

	it("does NOT run a declarations pass for a dev group even when emitDeclarations is set (prod-only)", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const build = async (cfg: Record<string, unknown>) => {
			calls.push(cfg);
		};
		await runBuildTargetGroups({
			cwd: "/repo/pkg",
			version: "1.0.0",
			entry: { index: "/repo/pkg/src/index.ts" },
			tsconfigPath: "/tmp/tsconfig.json",
			groups: [{ id: "dev", name: "pkg" }],
			devManifest: "preserve",
			emitDeclarations: true,
			build,
		});
		assert.strictEqual(
			calls.some((c) => String(c.outDir).endsWith("/declarations")),
			false,
		);
	});

	it("omits the types condition from the emitted manifest when emitDts is false", async () => {
		// issue #198: the manifest's exports must not point at a .d.ts that the (now-skipped) dts
		// pass never wrote.
		const dir = await mkdtemp(join(tmpdir(), "btg-emitdts-"));
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "base", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
		);
		const captureBuild = (manifests: Array<Record<string, unknown>>) =>
			(async (cfg: { plugins: Array<{ name: string; generateBundle?: () => Promise<void> }> }) => {
				const emit = cfg.plugins.find((p) => p.name === "savvy:emit-manifest");
				await emit?.generateBundle?.call({
					emitFile(file: { fileName: string; source: string }) {
						if (file.fileName === "package.json") manifests.push(JSON.parse(file.source));
					},
				});
			}) as never;

		const manifests: Array<Record<string, unknown>> = [];
		await runBuildTargetGroups({
			cwd: dir,
			version: "1.0.0",
			entry: { index: "src/index.ts" },
			tsconfigPath: join(dir, "tsconfig.json"),
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			emitDts: false,
			build: captureBuild(manifests),
		});
		const exportsOut = manifests[0]?.exports as Record<string, unknown>;
		assert.deepStrictEqual(exportsOut["."], { import: "./index.js", default: "./index.js" });
	}, 30_000);

	it("skips both the dts pass and the declarations pass when emitDts is false, while the JS pass still emits", async () => {
		// issue #198: emitDts:false must drop BOTH the per-entry bundled dts pass AND the prod
		// per-module declarations pass (no TypeScript compiler load), while the JS pass is unaffected.
		const calls: Array<{ kind: "js" | "dts" | "declarations"; dts: unknown }> = [];
		const fakeBuild = vi.fn(async (cfg: { outDir: string; dts: unknown }) => {
			calls.push({
				kind: String(cfg.outDir).endsWith("/declarations") ? "declarations" : cfg.dts === false ? "js" : "dts",
				dts: cfg.dts,
			});
			return [];
		});
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "./src/index.ts" },
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "npm", name: "base" }],
			devManifest: "preserve",
			emitDeclarations: true,
			emitDts: false,
			build: fakeBuild as never,
		});
		// Only the JS pass ran — no dts build() call, no declarations build() call.
		assert.deepStrictEqual(calls, [{ kind: "js", dts: false }]);
	});

	it("globs the whole source subtree for an outSubdir partition's JS pass, keeps the barrel for dts", async () => {
		const calls: Array<{ entry: unknown; dts: unknown }> = [];
		const fakeBuild = vi.fn(async (cfg: { entry: unknown; dts: unknown }) => {
			calls.push({ entry: cfg.entry, dts: cfg.dts });
			return [];
		});
		await runBuildTargetGroups({
			cwd: "/abs/pkg",
			version: "1.0.0",
			entry: { index: "./src/index.ts" },
			tsconfigPath: "/tmp/t.json",
			groups: [{ id: "dev", name: "base" }],
			devManifest: "preserve",
			overrides: [
				{
					entry: { index: "./src/runtime/index.tsx" },
					outSubdir: "runtime",
					platform: "browser",
					externals: ["react"],
				},
			],
			build: fakeBuild as never,
		});

		// base JS, base dts, runtime JS, runtime dts = 4 calls.
		assert.strictEqual(fakeBuild.mock.calls.length, 4);
		const [, , rtJs, rtDts] = calls;
		// JS pass: a glob over the barrel's source dir so the WHOLE bundleless subtree emits
		// (RSPress references some files only by path via globalUIComponents/resolve.alias), with
		// test/declaration files excluded.
		assert.deepStrictEqual(rtJs.entry, [
			"./src/runtime/**/*.{ts,tsx,mts,cts}",
			"!./src/runtime/**/*.{test,spec}.{ts,tsx,mts,cts}",
			"!./src/runtime/**/*.d.{ts,cts,mts}",
		]);
		assert.strictEqual(rtJs.dts, false);
		// dts pass: stays the single named barrel entry so it rolls up one bundled index.d.ts.
		assert.deepStrictEqual(rtDts.entry, { index: "./src/runtime/index.tsx" });
	});

	describe("ambient .d.ts export copying", () => {
		// The copy runs INSIDE buildTargetGroups (not just runBuild) so every build path — including
		// the self-hosting escape hatches that call this function directly — gets ambient exports
		// copied. This is what makes the manifest's rewritten "./<outName>" (transformExports) actually
		// resolve on disk. The `build` passed in is a no-op fake; the copy itself reads real fs at
		// `options.cwd`, independent of whatever the JS/dts passes would have done.
		async function ambientFixture(): Promise<string> {
			const dir = await mkdtemp(join(tmpdir(), "btg-ambient-"));
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(
				join(dir, "package.json"),
				JSON.stringify({
					name: "pkg",
					version: "1.0.0",
					exports: { ".": "./src/index.ts", "./virtual": { types: "./src/virtual.d.ts" } },
				}),
			);
			await writeFile(join(dir, "src/index.ts"), "export const A = 1;\n");
			await writeFile(
				join(dir, "src/virtual.d.ts"),
				'declare module "pkg/virtual/x" {\n  export const y: number;\n}\n',
			);
			return dir;
		}

		it("a prod build copies each ambient entry into every resolved group's own pkg dir", async () => {
			const dir = await ambientFixture();
			const build = (async () => {}) as never;
			await runBuildTargetGroups({
				cwd: dir,
				version: "1.0.0",
				entry: { index: "./src/index.ts" },
				tsconfigPath: join(dir, "tsconfig.json"),
				groups: [
					{ id: "npm", name: "pkg" },
					{ id: "jsr", name: "pkg" },
				],
				devManifest: "preserve",
				build,
			});
			for (const groupDir of ["dist/prod/npm/pkg", "dist/prod/jsr/pkg"]) {
				const dst = join(dir, groupDir, "virtual.d.ts");
				assert.strictEqual(existsSync(dst), true);
				assert.include(await readFile(dst, "utf-8"), 'declare module "pkg/virtual/x"');
			}
		}, 30_000);

		it("a dev build copies ambient entries into dist/dev/pkg", async () => {
			const dir = await ambientFixture();
			const build = (async () => {}) as never;
			await runBuildTargetGroups({
				cwd: dir,
				version: "1.0.0",
				entry: { index: "./src/index.ts" },
				tsconfigPath: join(dir, "tsconfig.json"),
				groups: [{ id: "dev", name: "pkg" }],
				devManifest: "preserve",
				build,
			});
			const dst = join(dir, "dist/dev/pkg/virtual.d.ts");
			assert.strictEqual(existsSync(dst), true);
			assert.include(await readFile(dst, "utf-8"), 'declare module "pkg/virtual/x"');
		}, 30_000);

		it("a package with no ambient exports triggers no copy", async () => {
			const dir = await mkdtemp(join(tmpdir(), "btg-noambient-"));
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(
				join(dir, "package.json"),
				JSON.stringify({ name: "pkg", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
			);
			await writeFile(join(dir, "src/index.ts"), "export const A = 1;\n");
			const build = (async () => {}) as never;
			await runBuildTargetGroups({
				cwd: dir,
				version: "1.0.0",
				entry: { index: "./src/index.ts" },
				tsconfigPath: join(dir, "tsconfig.json"),
				groups: [{ id: "dev", name: "pkg" }],
				devManifest: "preserve",
				build,
			});
			assert.strictEqual(existsSync(join(dir, "dist/dev/pkg")), false);
		}, 30_000);
	});
});
