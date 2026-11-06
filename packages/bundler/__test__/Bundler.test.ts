// Ported from savvy-web/systems packages/bundler/__test__/run*.test.ts on 2026-11-06, with seams in place of argv targets
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { BundlerBuildOptions, BundlerExeBuildOptions, BundlerPackageJson, BundlerSeams } from "../src/Bundler.js";
import { Bundler } from "../src/Bundler.js";
import { BundlerError } from "../src/BundlerError.js";
import { PackageBuildConfig, TsdoctorConfig } from "../src/config/BuildConfig.js";
import { ConfigValidationError } from "../src/errors.js";
import type { GenerateMetaOptions } from "../src/meta/generate.js";
import type { RunMetaPassOptions } from "../src/meta/run-pass.js";
import type { BuildTargetGroupsOptions } from "../src/passes/build-target-groups.js";
import { buildTargetGroups } from "../src/passes/build-target-groups.js";
import type { BuildReport } from "../src/report/schema.js";

const decodeConfig = Schema.decodeUnknownSync(PackageBuildConfig);

const tmpDirs: string[] = [];
const makeTmp = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "bundler-build-"));
	tmpDirs.push(dir);
	return dir;
};
afterAll(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

interface IssuesCall {
	readonly cwd: string;
	readonly target: string;
	readonly reports: ReadonlyArray<BuildReport>;
	readonly buildOk: boolean;
	readonly failure?: { readonly name?: string | undefined; readonly message: string };
}

/**
 * A build with every side effect replaced, recording what reached each seam. `meta` defaults to `false` here
 * because most cases are not about the meta pass.
 */
const harness = (input: {
	readonly config?: Record<string, unknown>;
	readonly pkg?: BundlerPackageJson;
	readonly seams?: Partial<BundlerSeams>;
	readonly options?: Partial<BundlerBuildOptions>;
}) => {
	const builds: BuildTargetGroupsOptions[] = [];
	const issues: IssuesCall[] = [];
	const bindings: string[] = [];
	const metas: RunMetaPassOptions[] = [];
	const exes: BundlerExeBuildOptions[] = [];
	const tsconfigs: Array<{ cwd: string; jsx: unknown }> = [];
	const options: BundlerBuildOptions = {
		cwd: "/abs/pkg",
		config: decodeConfig({ meta: false, ...input.config }),
		tsdoctor: undefined,
		noExe: false,
		verbose: false,
		plugins: [],
		ci: false,
		...input.options,
		seams: {
			readPackageJson: () => input.pkg ?? { name: "base", version: "1.2.3", exports: { ".": "./src/index.ts" } },
			readTsconfigJsx: () => ({}),
			writeTsconfig: (cwd, jsx) => {
				tsconfigs.push({ cwd, jsx });
				return "/fake/tsconfig.json";
			},
			buildTargetGroups: async (o) => {
				builds.push(o);
			},
			writeTargetsBinding: (cwd) => {
				const path = join(cwd, "dist", "prod", "targets.json");
				bindings.push(path);
				return path;
			},
			runMetaPass: async (o) => {
				metas.push(o);
			},
			runExeBuild: async (o) => {
				exes.push(o);
			},
			writeIssues: (o) => {
				issues.push(o);
				return `${o.cwd}/dist/prod/issues.json`;
			},
			...input.seams,
		},
	};
	return { options, builds, issues, bindings, metas, exes, tsconfigs };
};

const firstBuild = (builds: ReadonlyArray<BuildTargetGroupsOptions>): BuildTargetGroupsOptions => {
	const build = builds[0];
	if (build === undefined) assert.fail("buildTargetGroups was not called");
	return build;
};

describe("Bundler.build orchestration", () => {
	it.effect("builds one npm group named after the package when no targets are declared", () =>
		Effect.gen(function* () {
			const h = harness({});
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(firstBuild(h.builds).groups, [{ id: "npm", name: "base" }]);
			assert.strictEqual(h.builds.length, 1);
		}),
	);

	it.effect("reads the version for the __PACKAGE_VERSION__ define from package.json", () =>
		Effect.gen(function* () {
			const h = harness({});
			yield* Bundler.build(h.options);
			assert.strictEqual(firstBuild(h.builds).version, "1.2.3");
		}),
	);

	it.effect("forwards the injected tsconfig path and always asks for the prod declarations tree", () =>
		Effect.gen(function* () {
			const h = harness({});
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(h.tsconfigs, [{ cwd: "/abs/pkg", jsx: undefined }]);
			const build = firstBuild(h.builds);
			assert.strictEqual(build.tsconfigPath, "/fake/tsconfig.json");
			assert.strictEqual(build.emitDeclarations, true);
			assert.strictEqual(build.emitDts, true);
		}),
	);

	// JSX reaches the build through the generated tsconfig, never as a top-level option forwarded to rolldown.
	const writtenCompilerOptions = (build: BuildTargetGroupsOptions) =>
		(JSON.parse(readFileSync(build.tsconfigPath, "utf-8")) as { compilerOptions: Record<string, unknown> })
			.compilerOptions;
	const jsxSeams = (jsx: { jsx?: string; jsxImportSource?: string }): Partial<BundlerSeams> => {
		// Leaves the default tsconfig writer in place by dropping the harness's fake below.
		return { readTsconfigJsx: () => jsx as never };
	};
	const realTsconfig = (h: ReturnType<typeof harness>): BundlerBuildOptions => {
		const { writeTsconfig: _dropped, ...seams } = h.options.seams ?? {};
		return { ...h.options, cwd: makeTmp(), seams };
	};

	it.effect("infers automatic jsx from tsconfig and writes it into the generated tsconfig", () =>
		Effect.gen(function* () {
			const h = harness({ seams: jsxSeams({ jsx: "react-jsx", jsxImportSource: "preact" }) });
			yield* Bundler.build(realTsconfig(h));
			const co = writtenCompilerOptions(firstBuild(h.builds));
			assert.strictEqual(co.jsx, "react-jsx");
			assert.strictEqual(co.jsxImportSource, "preact");
		}),
	);

	it.effect("lets an explicit classic jsx override win over tsconfig inference", () =>
		Effect.gen(function* () {
			const h = harness({
				config: { jsx: { runtime: "classic" } },
				seams: jsxSeams({ jsx: "react-jsx", jsxImportSource: "react" }),
			});
			yield* Bundler.build(realTsconfig(h));
			const co = writtenCompilerOptions(firstBuild(h.builds));
			assert.strictEqual(co.jsx, "react");
			assert.isUndefined(co.jsxImportSource);
		}),
	);

	it.effect("writes no jsx into the tsconfig when neither tsconfig nor config request it", () =>
		Effect.gen(function* () {
			const h = harness({ seams: jsxSeams({}) });
			yield* Bundler.build(realTsconfig(h));
			assert.isUndefined(writtenCompilerOptions(firstBuild(h.builds)).jsx);
		}),
	);

	it.effect("forwards every configured build setting", () =>
		Effect.gen(function* () {
			const h = harness({
				config: {
					format: ["esm", "cjs"],
					externals: ["typescript"],
					bundle: ["inlined"],
					bundledPackages: ["@commitlint/types"],
					dtsExternals: ["effect", "@effect/platform"],
					bundleNodeModules: true,
					minify: true,
					emitDts: false,
					define: { "process.env.FLAG": '"on"' },
				},
			});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			assert.deepStrictEqual(build.format, ["esm", "cjs"]);
			assert.deepStrictEqual(build.externals, ["typescript"]);
			assert.deepStrictEqual(build.bundle, ["inlined"]);
			assert.deepStrictEqual(build.bundledPackages, ["@commitlint/types"]);
			assert.deepStrictEqual(build.dtsExternals, ["effect", "@effect/platform"]);
			assert.strictEqual(build.bundleNodeModules, true);
			assert.strictEqual(build.minify, true);
			assert.strictEqual(build.emitDts, false);
			assert.deepStrictEqual(build.define, { "process.env.FLAG": '"on"' });
		}),
	);

	it.effect("omits the settings a default config leaves empty, so the passes see them absent", () =>
		Effect.gen(function* () {
			const h = harness({});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			for (const key of [
				"bundle",
				"bundledPackages",
				"dtsExternals",
				"bundleNodeModules",
				"minify",
				"define",
				"overrides",
				"dualExports",
				"subdirExports",
				"looseFiles",
				"extraPlugins",
				"exeRewrite",
			]) {
				assert.isFalse(key in build, `${key} should be absent`);
			}
			assert.deepStrictEqual(build.format, ["esm"]);
		}),
	);

	it.effect("always passes the manifest drop list, the empty one included, so stripping always runs", () =>
		Effect.gen(function* () {
			const empty = harness({});
			yield* Bundler.build(empty.options);
			assert.deepStrictEqual(firstBuild(empty.builds).drop, []);
			const listed = harness({ config: { manifest: { drop: ["scripts"] } } });
			yield* Bundler.build(listed.options);
			assert.deepStrictEqual(firstBuild(listed.builds).drop, ["scripts"]);
		}),
	);

	it.effect("normalizes looseFiles and forwards them", () =>
		Effect.gen(function* () {
			const h = harness({
				config: {
					bundleNodeModules: true,
					looseFiles: { "pnpmfile.mjs": "./src/pnpmfile.ts", "pnpmfile.cjs": "./src/pnpmfile.ts" },
				},
			});
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(firstBuild(h.builds).looseFiles, [
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
			]);
		}),
	);

	it.effect("forwards loaded plugins as extraPlugins, by identity", () =>
		Effect.gen(function* () {
			const plugin = { name: "virtual-module" };
			const h = harness({ options: { plugins: [plugin] } });
			yield* Bundler.build(h.options);
			assert.strictEqual(firstBuild(h.builds).extraPlugins?.[0], plugin);
		}),
	);
});

describe("Bundler.build overrides", () => {
	const twoExports: BundlerPackageJson = {
		name: "base",
		version: "1.0.0",
		exports: {
			"./changesets/markdownlint": "./src/changesets/markdownlint.ts",
			"./commitlint": "./src/commitlint/index.ts",
		},
	};

	it.effect("partitions override entries out of the base set and threads dualExports", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: twoExports,
				config: {
					overrides: [
						{ entries: ["./changesets/markdownlint"], format: ["esm", "cjs"], bundle: ["@savvy-web/silk-effects"] },
					],
				},
			});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			assert.deepStrictEqual(build.entry, { commitlint: "./src/commitlint/index.ts" });
			assert.strictEqual(build.overrides?.length, 1);
			assert.deepStrictEqual(build.overrides?.[0]?.entry, {
				"changesets-markdownlint": "./src/changesets/markdownlint.ts",
			});
			assert.deepStrictEqual(build.overrides?.[0]?.format, ["esm", "cjs"]);
			assert.deepStrictEqual(build.overrides?.[0]?.bundle, ["@savvy-web/silk-effects"]);
			assert.deepStrictEqual([...(build.dualExports as Set<string>)], ["./changesets/markdownlint"]);
		}),
	);

	it.effect("threads base export keys into dualExports when the base format includes cjs", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: { ...twoExports, exports: { ".": "./src/index.ts", ...(twoExports.exports as object) } },
				config: {
					format: ["esm", "cjs"],
					overrides: [{ entries: ["./changesets/markdownlint"], format: ["esm", "cjs"], bundleNodeModules: true }],
				},
			});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			assert.deepStrictEqual([...(build.dualExports as Set<string>)].sort(), [
				".",
				"./changesets/markdownlint",
				"./commitlint",
			]);
			assert.deepStrictEqual(build.entry, { index: "./src/index.ts", commitlint: "./src/commitlint/index.ts" });
		}),
	);

	it.effect("leaves dualExports unset for an empty override table, keeping the uniform cjs behaviour", () =>
		Effect.gen(function* () {
			const h = harness({ config: { format: ["esm", "cjs"], overrides: [] } });
			yield* Bundler.build(h.options);
			assert.isFalse("dualExports" in firstBuild(h.builds));
		}),
	);

	const runtimePkg: BundlerPackageJson = {
		name: "rspress-plugin-fixture",
		version: "1.0.0",
		exports: { ".": "./src/index.ts", "./runtime": "./src/runtime/index.tsx" },
	};

	it.effect("forwards an override's platform and css into its partition", () =>
		Effect.gen(function* () {
			const css = { modules: { localsConvention: "camelCaseOnly", namedExport: false } };
			const h = harness({
				pkg: runtimePkg,
				config: { overrides: [{ entries: ["./runtime"], platform: "browser", css, externals: ["react", "@theme"] }] },
			});
			yield* Bundler.build(h.options);
			const ov = firstBuild(h.builds).overrides?.[0];
			assert.strictEqual(ov?.platform, "browser");
			assert.deepStrictEqual(ov?.css, css);
			assert.deepStrictEqual(ov?.entry, { runtime: "./src/runtime/index.tsx" });
		}),
	);

	it.effect("constructs an outSubdir partition with entry index and subdirExports", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: runtimePkg,
				config: { overrides: [{ entries: ["./runtime"], outSubdir: "runtime", platform: "browser" }] },
			});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			assert.strictEqual(build.overrides?.[0]?.outSubdir, "runtime");
			assert.deepStrictEqual(build.overrides?.[0]?.entry, { index: "./src/runtime/index.tsx" });
			assert.deepStrictEqual(build.entry, { index: "./src/index.ts" });
			assert.deepStrictEqual([...(build.subdirExports ?? [])], ["./runtime"]);
		}),
	);

	const rejected = (overrides: ReadonlyArray<unknown>, pattern: RegExp) =>
		Effect.gen(function* () {
			const h = harness({ pkg: runtimePkg, config: { overrides } });
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, ConfigValidationError);
			assert.match(error.message, pattern);
			assert.strictEqual(h.builds.length, 0);
		});

	it.effect("rejects an override entry with no ./ prefix before building", () =>
		rejected([{ entries: ["runtime"] }], /must be a canonical export path/),
	);
	it.effect("rejects an override naming an export that is not a build entry", () =>
		rejected([{ entries: ["./does-not-exist"], outSubdir: "runtime" }], /is not a build entry/),
	);
	it.effect("rejects an outSubdir override pinning more than one export", () =>
		rejected([{ entries: [".", "./runtime"], outSubdir: "runtime" }], /must pin exactly one export path \(got 2\)/),
	);
});

describe("Bundler.build validation", () => {
	const refused = (input: Parameters<typeof harness>[0], pattern: RegExp) =>
		Effect.gen(function* () {
			const h = harness(input);
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, ConfigValidationError);
			assert.match(error.message, pattern);
			assert.strictEqual(h.builds.length, 0);
			assert.strictEqual(h.exes.length, 0);
			assert.strictEqual(h.bindings.length, 0);
			return h;
		});
	const withTargets = (targets: unknown): BundlerPackageJson => ({
		name: "pkg",
		version: "1.0.0",
		exports: { ".": "./src/index.ts" },
		publishConfig: { targets },
	});

	it.effect("fails before any build when a target has a dangling from", () =>
		refused({ pkg: withTargets({ a: { from: "nope", registry: "https://r" } }) }, /Config validation failed/),
	);
	it.effect("fails before any build on a from+name collision", () =>
		refused(
			{ pkg: withTargets({ npm: true, a: { from: "npm", name: "@s/x", registry: "https://r" } }) },
			/Config validation failed/,
		),
	);
	it.effect("fails before any build on an exe with no inferable targets", () =>
		refused({ config: { exe: { fileName: "tool" } } }, /no targets/),
	);
	it.effect("fails an exe config that resolves to more than one binary", () =>
		refused(
			{
				config: {
					exe: [
						{ fileName: "a", targets: [{ platform: "linux", arch: "x64" }] },
						{ fileName: "b", targets: [{ platform: "linux", arch: "x64" }] },
					],
				},
			},
			/exactly one binary with one target \(got 2 spec/,
		),
	);
	it.effect("fails an explicit meta table in a package with no exports map", () =>
		refused(
			{ pkg: { name: "pkg", version: "1.0.0" }, config: { meta: { optimistic: true } } },
			/requires an exports map/,
		),
	);

	it.effect("does not treat a default meta table as a request for a model", () =>
		Effect.gen(function* () {
			const h = harness({ pkg: { name: "pkg", version: "1.0.0", bin: "./src/bin.ts" }, config: { meta: {} } });
			yield* Bundler.build(h.options);
			assert.strictEqual(h.builds.length, 1);
		}),
	);

	it.effect("refuses a collision between an ambient output and a JS entry", () =>
		refused(
			{ pkg: { name: "p", version: "1.0.0", exports: { "./a/b": "./src/a/b.ts", "./a-b": "./src/a-b.d.ts" } } },
			/collides with the JS build entry/,
		),
	);

	it.effect("names the validate phase when setup throws something other than a config fault", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					readTsconfigJsx: () => {
						throw new Error("unreadable tsconfig");
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "validate");
			assert.strictEqual(h.builds.length, 0);
		}),
	);

	it.effect("refuses a types-only package", () =>
		refused({ pkg: { name: "p", version: "1.0.0", exports: { "./types": "./src/types.d.ts" } } }, /types-only package/),
	);

	it.effect("validates before it writes anything but the tsconfig", () =>
		Effect.gen(function* () {
			const h = yield* refused({ pkg: withTargets({ a: { from: "nope", registry: "https://r" } }) }, /validation/);
			assert.strictEqual(h.metas.length, 0);
			assert.strictEqual(h.issues.length, 1);
		}),
	);
});

describe("Bundler.build targets", () => {
	const pkg = (targets: unknown): BundlerPackageJson => ({
		name: "base",
		version: "1.0.0",
		exports: { ".": "./src/index.ts" },
		publishConfig: { targets },
	});

	it.effect("builds one group per resolved prod group and writes the binding once", () =>
		Effect.gen(function* () {
			const h = harness({ pkg: pkg({ npm: true, github: "@scope/base" }) });
			const result = yield* Bundler.build(h.options);
			const groups = firstBuild(h.builds).groups;
			assert.deepStrictEqual(groups.map((g) => g.id).sort(), ["github", "npm"]);
			assert.strictEqual(groups.find((g) => g.id === "github")?.name, "@scope/base");
			assert.strictEqual(h.bindings.length, 1);
			assert.strictEqual(result.targetsPath, "/abs/pkg/dist/prod/targets.json");
		}),
	);

	it.effect("ignores the legacy array form of publishConfig.targets", () =>
		Effect.gen(function* () {
			const h = harness({ pkg: pkg(["npm", "github"]) });
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(firstBuild(h.builds).groups, [{ id: "npm", name: "base" }]);
		}),
	);

	it.effect("records a config warning when every target is prerelease-only", () =>
		Effect.gen(function* () {
			const h = harness({ pkg: pkg({ npm: { releases: "prerelease" } }) });
			const result = yield* Bundler.build(h.options);
			const warning = result.report.targetGroups[0]?.warnings[0];
			assert.strictEqual(warning?.source, "config");
			assert.strictEqual(warning?.code, "targets-no-final-release");
		}),
	);

	it.effect("records no config warning when a target still receives final versions", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: pkg({ npm: { releases: "stable" }, pnpr: { from: "npm", registry: "https://r.test" } }),
			});
			const result = yield* Bundler.build(h.options);
			assert.isFalse(JSON.stringify(result.report).includes("targets-no-final-release"));
		}),
	);

	it.effect("writes the real targets.json and issues.json under dist/prod", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const h = harness({ options: { cwd } });
			const { writeTargetsBinding: _b, writeIssues: _i, ...seams } = h.options.seams ?? {};
			const result = yield* Bundler.build({ ...h.options, seams });
			assert.strictEqual(result.issuesPath, join(cwd, "dist", "prod", "issues.json"));
			assert.strictEqual(result.targetsPath, join(cwd, "dist", "prod", "targets.json"));
			assert.isTrue(existsSync(result.targetsPath as string));
			const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as { buildOk: boolean; target: string };
			assert.strictEqual(issues.buildOk, true);
			assert.strictEqual(issues.target, "prod");
		}),
	);
});

describe("Bundler.build reporting", () => {
	const recording = (o: BuildTargetGroupsOptions): void => {
		const id = o.groups[0]?.id ?? "npm";
		o.collector?.registerGroup(id, ["index"]);
		o.collector?.recordEmitted(id, "js", { path: "index.js", bytes: 60 });
		o.collector?.recordPassTiming(id, "js", 10);
	};

	it.effect("answers the collector's report on success", () =>
		Effect.gen(function* () {
			const h = harness({ seams: { buildTargetGroups: async (o) => recording(o) } });
			const result = yield* Bundler.build(h.options);
			assert.strictEqual(result.report.package, "base");
			assert.strictEqual(result.report.targetGroups[0]?.passes[0]?.files[0]?.path, "index.js");
		}),
	);

	it.effect("writes issues once, stamped buildOk true, on success", () =>
		Effect.gen(function* () {
			const h = harness({});
			const result = yield* Bundler.build(h.options);
			assert.strictEqual(h.issues.length, 1);
			assert.strictEqual(h.issues[0]?.target, "prod");
			assert.strictEqual(h.issues[0]?.buildOk, true);
			assert.isFalse("failure" in (h.issues[0] as object));
			assert.strictEqual(result.issuesPath, "/abs/pkg/dist/prod/issues.json");
		}),
	);

	it.effect("still writes issues when the build throws, and fails carrying the snapshot", () =>
		Effect.gen(function* () {
			const boom = new Error("boom");
			const h = harness({
				seams: {
					buildTargetGroups: async (o) => {
						recording(o);
						o.collector?.recordError("npm", { source: "tsdown", level: "error", text: "kaboom" });
						throw boom;
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "js");
			assert.strictEqual(error.message, "boom");
			assert.strictEqual(error.cause, boom);
			assert.strictEqual(error.report.targetGroups[0]?.errors[0]?.text, "kaboom");
			assert.strictEqual(h.issues.length, 1);
			assert.strictEqual(h.issues[0]?.buildOk, false);
			assert.deepStrictEqual(h.issues[0]?.failure, { name: "Error", message: "boom" });
			assert.strictEqual(h.bindings.length, 0, "a failed build must not leave a targets.json for the release action");
			assert.strictEqual(h.issues[0]?.reports[0]?.targetGroups[0]?.errors[0]?.text, "kaboom");
		}),
	);

	it.effect("writes issues stamped buildOk false when validation fails before the build", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: {
					name: "pkg",
					version: "1.0.0",
					exports: { ".": "./src/index.ts" },
					publishConfig: { targets: { a: { from: "nope", registry: "https://r" } } },
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.strictEqual(error._tag, "ConfigValidationError");
			assert.strictEqual(h.issues.length, 1);
			assert.strictEqual(h.issues[0]?.buildOk, false);
			assert.strictEqual(h.issues[0]?.failure?.name, "ConfigValidationError");
			assert.match(h.issues[0]?.failure?.message ?? "", /Config validation failed/);
		}),
	);

	it.effect("names the package in the failure report even when setup fails before a group exists", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					writeTsconfig: () => {
						throw new Error("read-only tmp");
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "validate");
			assert.strictEqual(error.report.package, "base");
			assert.deepStrictEqual(error.report.targetGroups, []);
		}),
	);

	it.effect("does not let a failed issues write change a successful build", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					writeIssues: () => {
						throw new Error("read-only dist");
					},
				},
			});
			const result = yield* Bundler.build(h.options);
			assert.strictEqual(result.issuesPath, "/abs/pkg/dist/prod/issues.json");
		}),
	);

	it.effect("does not let a failed issues write mask the build's own failure", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					buildTargetGroups: async () => {
						throw new Error("boom");
					},
					writeIssues: () => {
						throw new Error("read-only dist");
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.message, "boom");
		}),
	);

	it.effect("reads a non-Error throw through the guarded cause walk", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					buildTargetGroups: async () => {
						throw "a string";
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.message, "a string");
			assert.deepStrictEqual(h.issues[0]?.failure, { message: "a string" });
		}),
	);
});

describe("Bundler.build failure phases", () => {
	// Runs the real pass sequencing over a fake tsdown, so the phase comes from the real onPass wiring.
	const failingPass = (fails: (config: Record<string, unknown>) => boolean): Partial<BundlerSeams> => ({
		buildTargetGroups: (o) =>
			buildTargetGroups({
				...o,
				build: async (config) => {
					if (fails(config)) throw new Error("tsdown failed");
				},
			}),
	});

	it.effect("names the js pass", () =>
		Effect.gen(function* () {
			const h = harness({ seams: failingPass((c) => c.dts === false), options: { cwd: makeTmp() } });
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "js");
		}),
	);

	it.effect("names the dts pass", () =>
		Effect.gen(function* () {
			const h = harness({ seams: failingPass((c) => c.dts !== false), options: { cwd: makeTmp() } });
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "dts");
		}),
	);

	it.effect("names the manifest phase for a targets.json write failure", () =>
		Effect.gen(function* () {
			const h = harness({
				seams: {
					writeTargetsBinding: () => {
						throw new Error("disk full");
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "manifest");
		}),
	);
});

describe("Bundler.build meta pass", () => {
	it.effect("hands the meta pass its facts, with ci as an input", () =>
		Effect.gen(function* () {
			const tsdoctor = undefined;
			const h = harness({ config: { meta: {} }, options: { ci: true, tsdoctor } });
			yield* Bundler.build(h.options);
			assert.strictEqual(h.metas.length, 1);
			const meta = h.metas[0] as RunMetaPassOptions;
			assert.strictEqual(meta.ci, true);
			assert.strictEqual(meta.packageName, "base");
			assert.strictEqual(meta.tsconfigPath, "/fake/tsconfig.json");
			assert.deepStrictEqual(meta.groups, [{ id: "npm", name: "base" }]);
			assert.deepStrictEqual(meta.entries, { index: "./src/index.ts" });
			assert.strictEqual(meta.meta.optimistic, false);
			assert.deepStrictEqual(
				meta.targets?.map((t) => t.group),
				["npm"],
			);
		}),
	);

	it.effect("runs for a config that never mentions meta", () =>
		Effect.gen(function* () {
			const h = harness({ options: { config: decodeConfig({}) } });
			yield* Bundler.build(h.options);
			assert.strictEqual(h.metas.length, 1);
		}),
	);

	it.effect("runs for an exe package that also has JS entries, after the binding", () =>
		Effect.gen(function* () {
			let bindingsAtMeta = -1;
			const bindings: string[] = [];
			const h = harness({
				pkg: {
					name: "m",
					version: "1.0.0",
					os: ["darwin"],
					cpu: ["arm64"],
					exports: { ".": "./src/index.ts", "./bin": "./src/bin.ts" },
				},
				config: { meta: {}, exe: { fileName: "m" } },
				options: { noExe: true },
				seams: {
					writeTargetsBinding: () => {
						bindings.push("written");
						return "/abs/pkg/dist/prod/targets.json";
					},
					runMetaPass: async () => {
						bindingsAtMeta = bindings.length;
					},
				},
			});
			yield* Bundler.build(h.options);
			assert.strictEqual(bindingsAtMeta, 1);
		}),
	);

	it.effect("forwards the generateMeta and resolveNextVersions seams only when set", () =>
		Effect.gen(function* () {
			const generateMeta = async () => ({ apiJsonPath: "x", apiJsonFilename: "x" });
			const resolveNextVersions = async () => ({ versions: new Map<string, string>() });
			const set = harness({ config: { meta: {} }, seams: { generateMeta, resolveNextVersions } });
			yield* Bundler.build(set.options);
			assert.strictEqual(set.metas[0]?.generateMeta, generateMeta);
			assert.strictEqual(set.metas[0]?.resolveNextVersions, resolveNextVersions);
			const unset = harness({ config: { meta: {} } });
			yield* Bundler.build(unset.options);
			assert.isFalse("generateMeta" in (unset.metas[0] as object));
			assert.isFalse("resolveNextVersions" in (unset.metas[0] as object));
		}),
	);

	it.effect("skips it for meta false, for emitDts false, and for an exe-only package", () =>
		Effect.gen(function* () {
			const off = harness({ config: { meta: false } });
			yield* Bundler.build(off.options);
			assert.strictEqual(off.metas.length, 0);
			const noDts = harness({ config: { meta: {}, emitDts: false } });
			yield* Bundler.build(noDts.options);
			assert.strictEqual(noDts.metas.length, 0);
			const exeOnly = harness({
				pkg: { name: "t", version: "1.0.0", exports: { ".": "./src/bin.ts" }, os: ["darwin"], cpu: ["arm64"] },
				config: { meta: {}, exe: { fileName: "t" } },
				options: { cwd: makeTmp(), noExe: true },
			});
			yield* Bundler.build(exeOnly.options);
			assert.strictEqual(exeOnly.metas.length, 0);
		}),
	);

	it.effect("names the meta phase and still writes issues when the meta pass throws", () =>
		Effect.gen(function* () {
			const h = harness({
				config: { meta: {} },
				seams: {
					runMetaPass: async () => {
						throw new Error("api extractor blew up");
					},
				},
			});
			const error = yield* Effect.flip(Bundler.build(h.options));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "meta");
			assert.strictEqual(h.issues[0]?.buildOk, false);
			assert.strictEqual(h.issues[0]?.failure?.message, "api extractor blew up");
		}),
	);

	it.effect("hands the meta pass the decoded tsdoctor table", () =>
		Effect.gen(function* () {
			const tsdoctor = Schema.decodeUnknownSync(TsdoctorConfig)({ tagline: "Every shape", registries: false });
			const h = harness({ config: { meta: {} }, options: { tsdoctor } });
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(h.metas[0]?.meta.tsdoctor, { tagline: "Every shape", registries: false });
		}),
	);

	// The real meta pass over an injected API Extractor run, from the upstream run-meta cases.
	const overRealPass = (input: Parameters<typeof harness>[0]) => {
		const generated: GenerateMetaOptions[] = [];
		const nextVersionReads: string[] = [];
		const h = harness({
			...input,
			seams: {
				generateMeta: async (o) => {
					generated.push(o);
					return { apiJsonPath: "x", apiJsonFilename: "x" };
				},
				resolveNextVersions: async (cwd) => {
					nextVersionReads.push(cwd);
					return { versions: new Map([["base", "1.0.0"]]) };
				},
				...input.seams,
			},
		});
		const { runMetaPass: _real, ...seams } = h.options.seams ?? {};
		return { options: { ...h.options, seams }, h, generated, nextVersionReads };
	};
	const targeted = (targets: unknown): BundlerPackageJson => ({
		name: "base",
		version: "1.0.0",
		exports: { ".": "./src/index.ts" },
		publishConfig: { targets },
	});

	it.effect("reaches the real pass by default, and calls generateMeta once for a config that never mentions meta", () =>
		Effect.gen(function* () {
			const run = overRealPass({ options: { config: decodeConfig({}) } });
			yield* Bundler.build(run.options);
			assert.strictEqual(run.generated.length, 1);
			assert.strictEqual(run.generated[0]?.dtsDir, "/abs/pkg/dist/prod/npm/pkg");
			assert.strictEqual(run.generated[0]?.aeInputDir, "/abs/pkg/dist/prod/npm/declarations");
		}),
	);

	it.effect("runs generateMeta once per prod group", () =>
		Effect.gen(function* () {
			const run = overRealPass({ pkg: targeted({ npm: true, github: "@scope/base-gh" }), config: { meta: {} } });
			yield* Bundler.build(run.options);
			assert.deepStrictEqual(run.generated.map((g) => g.outMetaDir).sort(), [
				"/abs/pkg/dist/prod/github/meta",
				"/abs/pkg/dist/prod/npm/meta",
			]);
		}),
	);

	it.effect("builds the meta of a group not named after the package", () =>
		Effect.gen(function* () {
			const run = overRealPass({ pkg: targeted({ github: "@scope/x" }), config: { meta: {} } });
			yield* Bundler.build(run.options);
			assert.strictEqual(run.generated.length, 1);
			assert.include(run.generated[0]?.dtsDir ?? "", "github");
		}),
	);

	it.effect("rewrites versions when optimistic is on", () =>
		Effect.gen(function* () {
			const run = overRealPass({ config: { meta: { optimistic: true } }, options: { ci: true } });
			yield* Bundler.build(run.options);
			assert.deepStrictEqual(run.nextVersionReads, ["/abs/pkg"]);
			assert.strictEqual(run.generated[0]?.manifestTransform?.({ name: "base", version: "0.0.0" }).version, "1.0.0");
		}),
	);

	it.effect("does not read next versions when optimistic is off", () =>
		Effect.gen(function* () {
			const run = overRealPass({ config: { meta: { optimistic: false } }, options: { ci: false } });
			yield* Bundler.build(run.options);
			assert.deepStrictEqual(run.nextVersionReads, []);
			assert.isUndefined(run.generated[0]?.manifestTransform);
		}),
	);

	// Whichever way the process environment says, because `ci` is the only input: a CI-set environment would pass the
	// first case for the wrong reason, and an unset one the second.
	it.effect("resolves an auto optimistic setting from the ci option, never the environment", () =>
		Effect.gen(function* () {
			const saved = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
			yield* Effect.acquireUseRelease(
				Effect.void,
				() =>
					Effect.gen(function* () {
						process.env.CI = "true";
						const local = overRealPass({ config: { meta: {} }, options: { ci: false } });
						yield* Bundler.build(local.options);
						assert.deepStrictEqual(local.nextVersionReads, ["/abs/pkg"]);
						delete process.env.CI;
						delete process.env.GITHUB_ACTIONS;
						const ci = overRealPass({ config: { meta: {} }, options: { ci: true } });
						yield* Bundler.build(ci.options);
						assert.deepStrictEqual(ci.nextVersionReads, []);
					}),
				() =>
					Effect.sync(() => {
						for (const [key, value] of Object.entries(saved)) {
							if (value === undefined) delete process.env[key];
							else process.env[key] = value;
						}
					}),
			);
		}),
	);

	it.effect("forwards ci to the API Extractor run", () =>
		Effect.gen(function* () {
			const run = overRealPass({ config: { meta: {} }, options: { ci: true } });
			yield* Bundler.build(run.options);
			assert.strictEqual(run.generated[0]?.ci, true);
		}),
	);

	it.effect("strips declaration maps from the published dirs after the meta pass read them", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const pkgDir = join(cwd, "dist", "prod", "npm", "pkg");
			mkdirSync(pkgDir, { recursive: true });
			const map = join(pkgDir, "index.d.ts.map");
			writeFileSync(map, "{}");
			let presentDuringMeta = false;
			const h = harness({
				config: { meta: {} },
				options: { cwd },
				seams: {
					runMetaPass: async () => {
						presentDuringMeta = existsSync(map);
					},
				},
			});
			yield* Bundler.build(h.options);
			assert.isTrue(presentDuringMeta);
			assert.isFalse(existsSync(map));
		}),
	);
});

describe("Bundler.build exe", () => {
	const exePkg = (): BundlerPackageJson => ({
		name: "p",
		version: "1.0.0",
		type: "module",
		os: ["darwin"],
		cpu: ["arm64"],
		exports: { ".": "./src/bin.ts", "./package.json": "./package.json" },
		devDependencies: { typescript: "7.0.0" },
		scripts: { build: "x" },
	});
	const readManifest = (cwd: string): Record<string, unknown> =>
		JSON.parse(readFileSync(join(cwd, "dist", "prod", "npm", "pkg", "package.json"), "utf-8"));

	it.effect("programs the manifest of an exe-only package and compiles into pkg/bin", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const h = harness({ pkg: exePkg(), config: { exe: { fileName: "p" } }, options: { cwd } });
			yield* Bundler.build(h.options);
			assert.strictEqual(h.builds.length, 0);
			assert.strictEqual(h.exes.length, 1);
			assert.strictEqual(h.exes[0]?.outDir, join(cwd, "dist", "prod", "npm", "pkg", "bin"));
			assert.strictEqual(h.exes[0]?.groupId, "npm");
			assert.strictEqual(h.exes[0]?.specs[0]?.targets[0]?.platform, "darwin");
			const manifest = readManifest(cwd);
			assert.strictEqual((manifest.exports as Record<string, unknown>)["."], "./bin/p-darwin-arm64");
			assert.deepStrictEqual(manifest.files, ["bin/p-darwin-arm64"]);
		}),
	);

	it.effect("skips the compile with noExe but still programs the manifest", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const h = harness({ pkg: exePkg(), config: { exe: { fileName: "p" } }, options: { cwd, noExe: true } });
			yield* Bundler.build(h.options);
			assert.strictEqual(h.exes.length, 0);
			const manifest = readManifest(cwd);
			assert.strictEqual((manifest.exports as Record<string, unknown>)["."], "./bin/p-darwin-arm64");
			assert.deepStrictEqual(manifest.files, ["bin/p-darwin-arm64"]);
		}),
	);

	it.effect("strips the standalone manifest as the JS pass would, always", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const h = harness({ pkg: exePkg(), config: { exe: { fileName: "p" } }, options: { cwd, noExe: true } });
			yield* Bundler.build(h.options);
			const manifest = readManifest(cwd);
			assert.isFalse("devDependencies" in manifest);
			assert.isFalse("scripts" in manifest);
			assert.strictEqual(manifest.name, "p");
		}),
	);

	it.effect("rewrites the exe entry and runs the library build for a mixed package", () =>
		Effect.gen(function* () {
			const h = harness({
				pkg: { ...exePkg(), exports: { ".": "./src/index.ts", "./bin": "./src/bin.ts" } },
				config: { exe: { fileName: "p" } },
				options: { noExe: true },
			});
			yield* Bundler.build(h.options);
			const build = firstBuild(h.builds);
			assert.deepStrictEqual(build.entry, { index: "./src/index.ts" });
			assert.deepStrictEqual(build.exeRewrite, { source: "./src/bin.ts", fileName: "p-darwin-arm64", dir: "bin" });
		}),
	);

	it.effect("fails phase exe until the real compile is ported, with the manifest already emitted", () =>
		Effect.gen(function* () {
			const cwd = makeTmp();
			const h = harness({ pkg: exePkg(), config: { exe: { fileName: "p" } }, options: { cwd } });
			const { runExeBuild: _dropped, ...seams } = h.options.seams ?? {};
			const error = yield* Effect.flip(Bundler.build({ ...h.options, seams }));
			assert.instanceOf(error, BundlerError);
			assert.strictEqual(error.phase, "exe");
			assert.match(error.message, /not ported yet/);
			assert.isTrue(existsSync(join(cwd, "dist", "prod", "npm", "pkg", "package.json")));
		}),
	);
});

describe("Bundler.build resolves from options.cwd, never the process directory", () => {
	// A workspace whose catalog and sibling exist nowhere else: resolved from the process directory (this repo), neither
	// specifier has an answer, so the build fails rather than emitting these versions.
	const makeWorkspace = (): { readonly root: string; readonly cwd: string; readonly pkg: BundlerPackageJson } => {
		const root = makeTmp();
		writeFileSync(
			join(root, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\ncatalog:\n  only-in-this-workspace: 1.2.3\n",
		);
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", version: "0.0.0", private: true }));
		const sibling = join(root, "packages", "sibling-only-here");
		mkdirSync(sibling, { recursive: true });
		writeFileSync(join(sibling, "package.json"), JSON.stringify({ name: "sibling-only-here", version: "4.5.6" }));
		const cwd = join(root, "packages", "subject");
		mkdirSync(cwd, { recursive: true });
		return {
			root,
			cwd,
			pkg: {
				name: "subject",
				version: "1.0.0",
				os: ["darwin"],
				cpu: ["arm64"],
				exports: { ".": "./src/bin.ts" },
				dependencies: { "only-in-this-workspace": "catalog:", "sibling-only-here": "workspace:^" },
			},
		};
	};
	const resolved = { "only-in-this-workspace": "1.2.3", "sibling-only-here": "^4.5.6" };

	it.effect("for the standalone manifest of an exe-only package", () =>
		Effect.gen(function* () {
			const { cwd, pkg } = makeWorkspace();
			assert.notStrictEqual(process.cwd(), cwd);
			const h = harness({ pkg, config: { exe: { fileName: "subject" } }, options: { cwd, noExe: true } });
			yield* Bundler.build(h.options);
			const manifest = JSON.parse(readFileSync(join(cwd, "dist", "prod", "npm", "pkg", "package.json"), "utf-8"));
			assert.deepStrictEqual(manifest.dependencies, resolved);
		}),
	);

	it.effect("for the manifest the JS pass emits", () =>
		Effect.gen(function* () {
			const { cwd, pkg } = makeWorkspace();
			writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
			const emitted: Array<Record<string, unknown>> = [];
			const h = harness({
				pkg,
				options: { cwd },
				seams: {
					buildTargetGroups: (o) =>
						buildTargetGroups({
							...o,
							build: async (config) => {
								const plugins = config.plugins as ReadonlyArray<{ name: string; generateBundle?: () => Promise<void> }>;
								await plugins
									.find((plugin) => plugin.name === "savvy:emit-manifest")
									?.generateBundle?.call({
										emitFile: (file: { fileName: string; source: string }) => {
											if (file.fileName === "package.json") emitted.push(JSON.parse(file.source));
										},
									} as never);
							},
						}),
				},
			});
			yield* Bundler.build(h.options);
			assert.deepStrictEqual(emitted[0]?.dependencies, resolved);
		}),
	);
});
