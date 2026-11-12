// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/run-pass.test.ts on 2026-11-06
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { deriveExportPaths } from "../../src/entries/export-paths.js";
import {
	BuildCollector,
	BundleManifestEmitError,
	BundleManifestSourceError,
	OgGenerateError,
} from "../../src/index.js";
import type { GenerateMetaOptions } from "../../src/meta/generate.js";
import type { RunMetaPassOptions } from "../../src/meta/run-pass.js";
import { applySubdirMetaEntries, runMetaPass } from "../../src/meta/run-pass.js";

/** Every injectable is a test double, so the pass touches no disk: an empty volume stands in for it. */
const run = (o: RunMetaPassOptions) => runMetaPass(o).pipe(Effect.provide(MemoryFileSystem.makeSync({}).layer));

describe("deriveExportPaths", () => {
	it("maps index to '.' and matches exports keys by source path", () => {
		const entries = { index: "./src/index.ts", sub: "./src/sub.ts" };
		const exportsMap = { ".": "./src/index.ts", "./sub": "./src/sub.ts" };
		assert.deepStrictEqual(deriveExportPaths(entries, exportsMap), { index: ".", sub: "./sub" });
	});
	it("falls back to ./<name> when no exports map", () => {
		assert.deepStrictEqual(deriveExportPaths({ index: "./src/index.ts", foo: "./src/foo.ts" }, undefined), {
			index: ".",
			foo: "./foo",
		});
	});
});

describe("applySubdirMetaEntries", () => {
	it("remaps the flattened entry's dts basename to <subdir>/index and sets its export path", () => {
		const dtsBasenames = { "changesets-markdownlint": "changesets-markdownlint" };
		const exportPaths: Record<string, string> = {};
		applySubdirMetaEntries(
			[{ entries: ["./changesets/markdownlint"], outSubdir: "changesets/markdownlint" }],
			dtsBasenames,
			exportPaths,
		);
		assert.strictEqual(dtsBasenames["changesets-markdownlint"], "changesets/markdownlint/index");
		assert.strictEqual(exportPaths["changesets-markdownlint"], "./changesets/markdownlint");
	});
	it("is a no-op when overrides is undefined", () => {
		const dts = { index: "index" };
		applySubdirMetaEntries(undefined, dts, {});
		assert.deepStrictEqual(dts, { index: "index" });
	});
});

describe("runMetaPass", () => {
	it.effect("calls generateMeta once per group with derived exportPaths and bin/ excluded", () =>
		Effect.gen(function* () {
			const cwd = "/pkg";
			const calls: Array<{
				outMetaDir: string;
				entries: Record<string, string>;
				exportPaths: Record<string, string>;
				dtsDir: string;
				aeInputDir: string | undefined;
			}> = [];
			const collector = new BuildCollector();
			yield* run({
				cwd,
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [{ id: "npm", name: "@scope/pkg" }],
				entries: { index: "./src/index.ts", "bin/cli": "./src/bin/cli.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				generateMeta: async (opts) => {
					calls.push({
						outMetaDir: opts.outMetaDir,
						entries: opts.entries,
						exportPaths: opts.exportPaths,
						dtsDir: opts.dtsDir,
						aeInputDir: opts.aeInputDir,
					});
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
			});
			assert.strictEqual(calls.length, 1);
			assert.deepStrictEqual(calls[0]?.entries, { index: "index" }); // bin/cli excluded
			assert.deepStrictEqual(calls[0]?.exportPaths, { index: "." });
			assert.include(calls[0]?.outMetaDir, "/pkg/dist/prod/npm/meta");
			assert.strictEqual(calls[0]?.dtsDir, join(cwd, "dist", "prod", "npm", "pkg"));
			assert.strictEqual(calls[0]?.aeInputDir, join(cwd, "dist", "prod", "npm", "declarations"));
		}),
	);

	const localPathsByGroup = (groups: ReadonlyArray<{ id: string; name: string }>) => {
		const seen: Record<string, ReadonlyArray<string>> = {};
		return Effect.as(
			run({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups,
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: { localPaths: ["../models"] },
				collector: new BuildCollector(),
				ci: false,
				generateMeta: async (opts) => {
					seen[opts.outMetaDir.split("/").at(-2) as string] = opts.localPaths;
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
				loadBundleManifestSources: async () => ({ leaf: undefined, project: undefined, discoveryFailure: undefined }),
			}),
			seen,
		);
	};

	it.effect("copies into localPaths only for the group named after the package", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(
				yield* localPathsByGroup([
					{ id: "github", name: "@org/pkg" },
					{ id: "npm", name: "@scope/pkg" },
				]),
				{ github: [], npm: ["../models"] },
			);
		}),
	);

	it.effect("falls back to the first group for localPaths when none is named after the package", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(
				yield* localPathsByGroup([
					{ id: "github", name: "@org/pkg" },
					{ id: "other", name: "@other/pkg" },
				]),
				{ github: ["../models"], other: [] },
			);
		}),
	);

	it.effect("loads the bundle sources once and hands each group its own targets", () =>
		Effect.gen(function* () {
			const loads: string[] = [];
			const seen: Array<{ group: string; bundle: GenerateMetaOptions["bundle"] }> = [];
			yield* run({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [
					{ id: "npm", name: "@scope/pkg" },
					{ id: "github", name: "@org/pkg" },
				],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: { bundle: { name: "Configured" } },
				collector: new BuildCollector(),
				ci: false,
				targets: [
					{ group: "npm", id: "npm", registry: "https://registry.npmjs.org" },
					{ group: "github", id: "github", registry: "https://npm.pkg.github.com" },
				],
				loadBundleManifestSources: async (cwd) => {
					loads.push(cwd);
					return { leaf: { tagline: "leaf" }, project: { name: "Proj" } };
				},
				generateMeta: async (opts) => {
					seen.push({ group: opts.outMetaDir, bundle: opts.bundle });
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
			});
			assert.deepStrictEqual(loads, ["/pkg"]);
			assert.deepStrictEqual(
				seen.map((s) => s.bundle),
				[
					{
						config: { name: "Configured" },
						leaf: { tagline: "leaf" },
						project: { name: "Proj" },
						targets: [{ name: "npm", registry: "https://registry.npmjs.org" }],
					},
					{
						config: { name: "Configured" },
						leaf: { tagline: "leaf" },
						project: { name: "Proj" },
						targets: [{ name: "github", registry: "https://npm.pkg.github.com" }],
					},
				],
			);
		}),
	);

	it.effect("records a workspace-discovery failure as a meta warning on every group and continues", () =>
		Effect.gen(function* () {
			const collector = new BuildCollector();
			const generated: string[] = [];
			yield* run({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [
					{ id: "npm", name: "@scope/pkg" },
					{ id: "github", name: "@org/pkg" },
				],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				loadBundleManifestSources: async () => ({
					leaf: undefined,
					project: undefined,
					discoveryFailure: "missingName",
				}),
				generateMeta: async (opts) => {
					generated.push(opts.outMetaDir);
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
			});
			assert.strictEqual(generated.length, 2);
			const warnings = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.warnings));
			assert.strictEqual(warnings.length, 2);
			assert.containSubset(warnings[0], { source: "meta", code: "bundle-manifest-workspace-discovery-failed" });
			assert.include(warnings[0]?.text, "missingName");
		}),
	);

	it.effect("warns once per group for each retired tsdoctor.json source, naming the file and the rename", () =>
		Effect.gen(function* () {
			const collector = new BuildCollector();
			const generated: string[] = [];
			yield* run({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [
					{ id: "npm", name: "@scope/pkg" },
					{ id: "github", name: "@org/pkg" },
				],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				loadBundleManifestSources: async () => ({
					leaf: undefined,
					project: undefined,
					retiredSources: ["/pkg/tsdoctor.json", "/repo/tsdoctor.json"],
				}),
				generateMeta: async (opts) => {
					generated.push(opts.outMetaDir);
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
			});
			// a warning, not a failure: the meta pass still runs for every group
			assert.strictEqual(generated.length, 2);
			const warnings = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.warnings));
			assert.strictEqual(warnings.length, 4);
			assert.containSubset(warnings[0], {
				source: "meta",
				code: "bundle-manifest-retired-source",
				file: "/pkg/tsdoctor.json",
				text: "/pkg/tsdoctor.json is no longer read; rename it to bundle.json",
			});
			assert.sameMembers(
				warnings.map((w) => w.file),
				["/pkg/tsdoctor.json", "/pkg/tsdoctor.json", "/repo/tsdoctor.json", "/repo/tsdoctor.json"],
			);
		}),
	);

	it.effect("records an invalid bundle.json source in the collector and fails the pass", () =>
		Effect.gen(function* () {
			const collector = new BuildCollector();
			const generated: string[] = [];
			assert.instanceOf(
				yield* run({
					cwd: "/pkg",
					packageName: "@scope/pkg",
					tsconfigPath: "/pkg/tsconfig.json",
					groups: [{ id: "npm", name: "@scope/pkg" }],
					entries: { index: "./src/index.ts" },
					exportsMap: { ".": "./src/index.ts" },
					meta: {},
					collector,
					ci: false,
					loadBundleManifestSources: async () => {
						throw new BundleManifestSourceError({ path: "/pkg/bundle.json", cause: new Error("bad") });
					},
					generateMeta: async (opts) => {
						generated.push(opts.outMetaDir);
						return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
					},
				}).pipe(Effect.flip),
				BundleManifestSourceError,
			);
			assert.deepStrictEqual(generated, []);
			const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
			assert.strictEqual(errors.length, 1);
			assert.containSubset(errors[0], {
				source: "meta",
				code: "bundle-manifest-source-invalid",
				file: "/pkg/bundle.json",
			});
		}),
	);

	it.effect("records a sidecar emit failure in the collector and fails the pass", () =>
		Effect.gen(function* () {
			const collector = new BuildCollector();
			assert.instanceOf(
				yield* run({
					cwd: "/pkg",
					packageName: "@scope/pkg",
					tsconfigPath: "/pkg/tsconfig.json",
					groups: [{ id: "npm", name: "@scope/pkg" }],
					entries: { index: "./src/index.ts" },
					exportsMap: { ".": "./src/index.ts" },
					meta: {},
					collector,
					ci: false,
					loadBundleManifestSources: async () => ({ leaf: undefined, project: undefined }),
					generateMeta: async () => {
						throw new BundleManifestEmitError({
							packageName: "@scope/pkg",
							path: "/pkg/dist/prod/npm/meta/bundle.json",
							cause: Object.assign(new Error("read-only"), { code: "EACCES" }),
						});
					},
				}).pipe(Effect.flip),
				BundleManifestEmitError,
			);
			const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
			assert.strictEqual(errors.length, 1);
			assert.containSubset(errors[0], {
				source: "meta",
				code: "bundle-manifest-emit-failed",
				file: "/pkg/dist/prod/npm/meta/bundle.json",
			});
			assert.include(errors[0]?.text, "read-only");
		}),
	);

	it.effect("records an Open Graph generation failure in the collector and fails the pass", () =>
		Effect.gen(function* () {
			const collector = new BuildCollector();
			assert.instanceOf(
				yield* run({
					cwd: "/pkg",
					packageName: "@scope/pkg",
					tsconfigPath: "/pkg/tsconfig.json",
					groups: [{ id: "npm", name: "@scope/pkg" }],
					entries: { index: "./src/index.ts" },
					exportsMap: { ".": "./src/index.ts" },
					meta: {},
					collector,
					ci: false,
					loadBundleManifestSources: async () => ({ leaf: undefined, project: undefined }),
					generateMeta: async () => {
						throw new OgGenerateError({ packageName: "@scope/pkg", cause: new Error("renderer exploded") });
					},
				}).pipe(Effect.flip),
				OgGenerateError,
			);
			const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
			assert.strictEqual(errors.length, 1);
			assert.containSubset(errors[0], { source: "meta", code: "og-generate-failed" });
			assert.include(errors[0]?.text, "renderer exploded");
		}),
	);
});
