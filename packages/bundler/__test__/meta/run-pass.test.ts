// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/run-pass.test.ts on 2026-11-06
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { deriveExportPaths } from "../../src/entries/export-paths.js";
import { BuildCollector, OgGenerateError, TsdoctorEmitError, TsdoctorSourceError } from "../../src/index.js";
import type { GenerateMetaOptions } from "../../src/meta/generate.js";
import { applySubdirMetaEntries, runMetaPass } from "../../src/meta/run-pass.js";

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
	it("calls generateMeta once per group with derived exportPaths and bin/ excluded", async () => {
		const cwd = "/pkg";
		const calls: Array<{
			outMetaDir: string;
			entries: Record<string, string>;
			exportPaths: Record<string, string>;
			dtsDir: string;
			aeInputDir: string | undefined;
		}> = [];
		const collector = new BuildCollector();
		await runMetaPass({
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
	});

	it("loads the tsdoctor sources once and hands each group its own targets", async () => {
		const loads: string[] = [];
		const seen: Array<{ group: string; tsdoctor: GenerateMetaOptions["tsdoctor"] }> = [];
		await runMetaPass({
			cwd: "/pkg",
			packageName: "@scope/pkg",
			tsconfigPath: "/pkg/tsconfig.json",
			groups: [
				{ id: "npm", name: "@scope/pkg" },
				{ id: "github", name: "@org/pkg" },
			],
			entries: { index: "./src/index.ts" },
			exportsMap: { ".": "./src/index.ts" },
			meta: { tsdoctor: { name: "Configured" } },
			collector: new BuildCollector(),
			ci: false,
			targets: [
				{ group: "npm", id: "npm", registry: "https://registry.npmjs.org" },
				{ group: "github", id: "github", registry: "https://npm.pkg.github.com" },
			],
			loadTsdoctorSources: async (cwd) => {
				loads.push(cwd);
				return { leaf: { tagline: "leaf" }, project: { name: "Proj" } };
			},
			generateMeta: async (opts) => {
				seen.push({ group: opts.outMetaDir, tsdoctor: opts.tsdoctor });
				return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
			},
		});
		assert.deepStrictEqual(loads, ["/pkg"]);
		assert.deepStrictEqual(
			seen.map((s) => s.tsdoctor),
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
	});

	it("records a workspace-discovery failure as a meta warning on every group and continues", async () => {
		const collector = new BuildCollector();
		const generated: string[] = [];
		await runMetaPass({
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
			loadTsdoctorSources: async () => ({ leaf: undefined, project: undefined, discoveryFailure: "missingName" }),
			generateMeta: async (opts) => {
				generated.push(opts.outMetaDir);
				return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
			},
		});
		assert.strictEqual(generated.length, 2);
		const warnings = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.warnings));
		assert.strictEqual(warnings.length, 2);
		assert.containSubset(warnings[0], { source: "meta", code: "tsdoctor-workspace-discovery-failed" });
		assert.include(warnings[0]?.text, "missingName");
	});

	it("records an invalid tsdoctor.json source in the collector and fails the pass", async () => {
		const collector = new BuildCollector();
		const generated: string[] = [];
		assert.instanceOf(
			await runMetaPass({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [{ id: "npm", name: "@scope/pkg" }],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				loadTsdoctorSources: async () => {
					throw new TsdoctorSourceError({ path: "/pkg/tsdoctor.json", cause: new Error("bad") });
				},
				generateMeta: async (opts) => {
					generated.push(opts.outMetaDir);
					return { apiJsonPath: "/x", apiJsonFilename: "pkg.api.json" };
				},
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			TsdoctorSourceError,
		);
		assert.deepStrictEqual(generated, []);
		const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
		assert.strictEqual(errors.length, 1);
		assert.containSubset(errors[0], { source: "meta", code: "tsdoctor-source-invalid", file: "/pkg/tsdoctor.json" });
	});

	it("records a sidecar emit failure in the collector and fails the pass", async () => {
		const collector = new BuildCollector();
		assert.instanceOf(
			await runMetaPass({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [{ id: "npm", name: "@scope/pkg" }],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				loadTsdoctorSources: async () => ({ leaf: undefined, project: undefined }),
				generateMeta: async () => {
					throw new TsdoctorEmitError({
						packageName: "@scope/pkg",
						path: "/pkg/dist/prod/npm/meta/tsdoctor.json",
						cause: Object.assign(new Error("read-only"), { code: "EACCES" }),
					});
				},
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			TsdoctorEmitError,
		);
		const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
		assert.strictEqual(errors.length, 1);
		assert.containSubset(errors[0], {
			source: "meta",
			code: "tsdoctor-emit-failed",
			file: "/pkg/dist/prod/npm/meta/tsdoctor.json",
		});
		assert.include(errors[0]?.text, "read-only");
	});

	it("records an Open Graph generation failure in the collector and fails the pass", async () => {
		const collector = new BuildCollector();
		assert.instanceOf(
			await runMetaPass({
				cwd: "/pkg",
				packageName: "@scope/pkg",
				tsconfigPath: "/pkg/tsconfig.json",
				groups: [{ id: "npm", name: "@scope/pkg" }],
				entries: { index: "./src/index.ts" },
				exportsMap: { ".": "./src/index.ts" },
				meta: {},
				collector,
				ci: false,
				loadTsdoctorSources: async () => ({ leaf: undefined, project: undefined }),
				generateMeta: async () => {
					throw new OgGenerateError({ packageName: "@scope/pkg", cause: new Error("renderer exploded") });
				},
			}).then(
				() => undefined,
				(e: unknown) => e,
			),
			OgGenerateError,
		);
		const errors = collector.snapshot("@scope/pkg").flatMap((r) => r.targetGroups.flatMap((g) => g.errors));
		assert.strictEqual(errors.length, 1);
		assert.containSubset(errors[0], { source: "meta", code: "og-generate-failed" });
		assert.include(errors[0]?.text, "renderer exploded");
	});
});
