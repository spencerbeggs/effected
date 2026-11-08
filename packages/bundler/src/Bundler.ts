import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import type { Plugin } from "rolldown";
import type { BundlerPhase } from "./BundlerError.js";
import { BundlerError } from "./BundlerError.js";
import type { BundleConfig, PackageBuildConfig } from "./config/BuildConfig.js";
import { MetaConfig } from "./config/BuildConfig.js";
import { ConfigValidator } from "./config-validation/ConfigValidator.js";
import { writeResolvedTsconfig } from "./dts/resolved-tsconfig.js";
import { assertNoEntryCollisions, extractAmbientDts } from "./entries/ambient-dts.js";
import { deriveExportPaths } from "./entries/export-paths.js";
import { createEntryName } from "./entries/extract.js";
import { packageJsonEntries } from "./entries/package-json-entries.js";
import { ConfigValidationError } from "./errors.js";
import type { RunExeBuildOptions } from "./exe/build.js";
import { normalizeExeOptions } from "./exe/config.js";
import { computeExeFileName } from "./exe/filename.js";
import { causeMessage } from "./internal/causeMessage.js";
import type { JsxConfig as ResolvedJsxConfig, TsconfigJsx } from "./jsx/config.js";
import { readTsconfigJsx, resolveJsxConfig } from "./jsx/config.js";
import { builtConditionTargets, mismatchedBuiltTargets, stripBuiltCondition } from "./manifest/built-condition.js";
import { buildEmittedManifest } from "./manifest/emit-manifest.js";
import { unmatchedExportPatterns } from "./manifest/export-patterns.js";
import { emittedPackageName, validateManifestSet } from "./manifest/manifest-set.js";
import type { Json } from "./manifest/transform.js";
import { assertBuildableConditionExports } from "./manifest/transform.js";
import type { OgImageGenerator } from "./meta/bundle-config.js";
import { bundleMetaOptionsOf } from "./meta/bundle-config.js";
import type { MetaOptions } from "./meta/config.js";
import type { GenerateMetaOptions, MetaResult } from "./meta/generate.js";
import { OgGenerateError, resolveOgGenerator } from "./meta/og-image.js";
import type { RunMetaPassOptions } from "./meta/run-pass.js";
import type { BuildTargetGroupsOptions, CssOptions, EntryOverride } from "./passes/build-target-groups.js";
import { buildTargetGroups as realBuildTargetGroups } from "./passes/build-target-groups.js";
import { normalizeLooseFiles } from "./passes/loose-files.js";
import { removeDeclarationMaps } from "./passes/strip-maps.js";
import type { BuildGroupSpec } from "./passes/target-groups.js";
import { BuildCollector } from "./report/collector.js";
import { writeIssuesArtifact } from "./report/issues-artifact.js";
import { BuildReport } from "./report/schema.js";
import { writeTargetsBinding as realWriteTargetsBinding } from "./targets/binding.js";
import type { PublishTargets, TargetResolution } from "./targets/config.js";
import { releaseWarnings, resolveTargets } from "./targets/resolve-targets.js";

/**
 * The `package.json` fields the build reads. Any other field reaches the emitted manifest untouched.
 *
 * @public
 */
export interface BundlerPackageJson {
	readonly name?: string;
	readonly version?: string;
	readonly exports?: unknown;
	readonly bin?: unknown;
	readonly publishConfig?: unknown;
	readonly os?: unknown;
	readonly cpu?: unknown;
	readonly [key: string]: unknown;
}

/**
 * The orchestrator's side effects, each replaceable so a test can run it without tsdown, API Extractor or a
 * compiler. Every member defaults to the real implementation.
 *
 * @public
 */
export interface BundlerSeams {
	/** The JS and declaration passes. */
	readonly buildTargetGroups: (options: BuildTargetGroupsOptions) => Promise<void>;
	/** The meta pass, once per build. */
	readonly runMetaPass: (options: RunMetaPassOptions) => Promise<void>;
	/** The API Extractor run inside the real meta pass. */
	readonly generateMeta: (options: GenerateMetaOptions) => Promise<MetaResult>;
	/** The optimistic next-version read inside the real meta pass. */
	readonly resolveNextVersions: (cwd: string) => Promise<{ readonly versions: ReadonlyMap<string, string> }>;
	/** Imports an optional peer of an Open Graph renderer, the check that it is installed. */
	readonly importOgPeer: (specifier: string) => Promise<unknown>;
	/** The SEA compile. */
	readonly runExeBuild: (options: RunExeBuildOptions) => Promise<void>;
	/** Writes `dist/prod/issues.json` and answers its path. */
	readonly writeIssues: (options: {
		readonly cwd: string;
		readonly target: "prod";
		readonly reports: ReadonlyArray<BuildReport>;
		readonly buildOk: boolean;
		readonly failure?: { readonly name?: string | undefined; readonly message: string };
	}) => string | undefined;
	/** Reads the package's `package.json`. */
	readonly readPackageJson: (cwd: string) => BundlerPackageJson;
	/** Writes the resolved tsconfig and answers its path. */
	readonly writeTsconfig: (cwd: string, jsx: ResolvedJsxConfig | undefined) => string;
	/** Writes `dist/prod/targets.json` and answers its path. */
	readonly writeTargetsBinding: (cwd: string, resolution: TargetResolution) => string;
	/** Reads the jsx-relevant slice of the package's tsconfig. */
	readonly readTsconfigJsx: (cwd: string) => TsconfigJsx;
}

/**
 * The inputs of one package build.
 *
 * @public
 */
export interface BundlerBuildOptions {
	/** The package root, as an absolute path. The build never reads the process's own directory. */
	readonly cwd: string;
	/** The decoded `[package.build]` table. */
	readonly config: PackageBuildConfig;
	/** The decoded `[package.bundle]` table, the config tier of the emitted `bundle.json`. */
	readonly bundle: BundleConfig | undefined;
	/** Skips the SEA compile. The manifest still points at the binary. */
	readonly noExe: boolean;
	/** Measures gzip sizes for the report. */
	readonly verbose: boolean;
	/** Rolldown plugins added to the JS and declaration passes, already loaded. */
	readonly plugins: ReadonlyArray<Plugin>;
	/** Whether this build runs under CI. Resolves an `"auto"` optimistic meta setting, and read from nothing else. */
	readonly ci: boolean;
	/** Replaces side effects, for tests. */
	readonly seams?: Partial<BundlerSeams>;
}

/**
 * A finished build.
 *
 * @public
 */
export class BundlerBuildResult extends Schema.Class<BundlerBuildResult>("BundlerBuildResult")({
	/** Everything the build recorded. */
	report: BuildReport,
	/** Where `issues.json` was written. */
	issuesPath: Schema.String,
	/** Where `targets.json` was written. */
	targetsPath: Schema.UndefinedOr(Schema.String),
}) {}

// Loaded on first use: the meta pass reaches API Extractor and its own TypeScript, which nothing else here needs.
const defaultRunMetaPass: BundlerSeams["runMetaPass"] = (options) =>
	import("./meta/run-pass.js").then((module) => module.runMetaPass(options));

// Loaded on first use, for the one kind of package that compiles a binary.
const defaultRunExeBuild: BundlerSeams["runExeBuild"] = (options) =>
	import("./exe/build.js").then((module) => module.runExeBuild(options));

/** Reduce a thrown value to the `{ name?, message }` shape the issues artifact stamps on a failed build. */
function describeFailure(err: unknown): { name?: string; message: string } {
	if (err instanceof Error) {
		return err.name !== "" ? { name: err.name, message: err.message } : { message: err.message };
	}
	if (typeof err === "object" && err !== null) {
		const rec = err as { _tag?: unknown; name?: unknown; message?: unknown };
		const name = typeof rec._tag === "string" ? rec._tag : typeof rec.name === "string" ? rec.name : undefined;
		const message = typeof rec.message === "string" ? rec.message : String(err);
		return name !== undefined ? { name, message } : { message };
	}
	return { message: String(err) };
}

/** Read and parse package.json at cwd, returning an empty object on any error. */
function readPackageJson(cwd: string): BundlerPackageJson {
	try {
		return JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")) as BundlerPackageJson;
	} catch {
		return {};
	}
}

/** Write the resolved tsconfig with the resolved JSX settings in `compilerOptions`. */
function writeTsconfig(cwd: string, jsx: ResolvedJsxConfig | undefined): string {
	return writeResolvedTsconfig({
		cwd,
		...(jsx?.runtime === "automatic" ? { jsx: "react-jsx", jsxImportSource: jsx.importSource } : {}),
		...(jsx?.runtime === "classic" ? { jsx: "react" } : {}),
	});
}

/** The publish targets declared in `publishConfig.targets`; only the map form drives multi-target. */
function readPublishTargets(pkg: BundlerPackageJson): PublishTargets | undefined {
	const declared = (pkg.publishConfig as { targets?: unknown } | undefined)?.targets;
	return declared !== undefined && !Array.isArray(declared) && typeof declared === "object"
		? (declared as PublishTargets)
		: undefined;
}

/** Resolve the prod build groups and the target binding from publishConfig.targets (or the single-npm default). */
function deriveProdGroups(
	targets: PublishTargets | undefined,
	baseName: string,
): { groups: ReadonlyArray<BuildGroupSpec>; resolution: TargetResolution } {
	const effective: PublishTargets = targets !== undefined && Object.keys(targets).length > 0 ? targets : { npm: true };
	const resolution = resolveTargets({ targets: effective, baseName });
	return { groups: resolution.groups.map((g) => ({ id: g.id, name: g.name })), resolution };
}

const overridesError = (reason: string): ConfigValidationError =>
	new ConfigValidationError({ path: "overrides", reason });

/** The partitions, base entries and export-key sets that per-entry overrides produce. */
function partitionOverrides(
	config: PackageBuildConfig,
	entries: Record<string, string>,
	exportsMap: Record<string, string> | undefined,
	packageName: string,
): {
	readonly partitions: ReadonlyArray<EntryOverride>;
	readonly baseEntries: Record<string, string>;
	readonly dualExports: ReadonlySet<string> | undefined;
	readonly subdirExports: ReadonlySet<string>;
} {
	const subdirExports = new Set<string>();
	// An empty table overrides nothing: the manifest keeps the uniform format-includes-cjs behaviour.
	if (config.overrides.length === 0) {
		return { partitions: [], baseEntries: entries, dualExports: undefined, subdirExports };
	}
	const partitions: EntryOverride[] = [];
	const overriddenEntryNames = new Set<string>();
	const dualExports = new Set<string>();
	const exportPathByEntry = deriveExportPaths(entries, exportsMap);
	for (const ov of config.overrides) {
		// An outSubdir partition is an isolated single-export sub-package, so it pins exactly one export.
		if (ov.outSubdir !== undefined && ov.entries.length !== 1) {
			throw overridesError(`outSubdir "${ov.outSubdir}" must pin exactly one export path (got ${ov.entries.length})`);
		}
		const partEntry: Record<string, string> = {};
		for (const exportPath of ov.entries) {
			// A non-canonical value like "changesets/markdownlint" still flattens to a valid entry name and builds
			// the JS, but its dualExports key would miss the manifest's "./"-prefixed key and silently drop the
			// require condition.
			if (exportPath !== "." && !exportPath.startsWith("./")) {
				throw overridesError(
					`entry "${exportPath}" must be a canonical export path — use "." for the root or a "./"-prefixed subpath (e.g. "./changesets/markdownlint")`,
				);
			}
			const flatName = createEntryName(exportPath, false);
			const src = entries[flatName];
			if (src === undefined) {
				throw overridesError(
					`export path "${exportPath}" (entry "${flatName}") is not a build entry of ${packageName}`,
				);
			}
			// An outSubdir partition emits a barrel at `<subdir>/index.*`, so its output entry KEY is "index". The
			// source lookup above still uses the flattened name.
			partEntry[ov.outSubdir !== undefined ? "index" : flatName] = src;
			overriddenEntryNames.add(flatName);
			if (ov.outSubdir !== undefined) subdirExports.add(exportPath);
			if ((ov.format ?? config.format).includes("cjs")) dualExports.add(exportPath);
		}
		partitions.push({
			entry: partEntry,
			...(ov.format !== undefined ? { format: ov.format } : {}),
			...(ov.externals !== undefined ? { externals: ov.externals } : {}),
			...(ov.bundle !== undefined ? { bundle: ov.bundle } : {}),
			...(ov.bundleNodeModules !== undefined ? { bundleNodeModules: ov.bundleNodeModules } : {}),
			...(ov.bundledPackages !== undefined ? { bundledPackages: ov.bundledPackages } : {}),
			...(ov.dtsExternals !== undefined ? { dtsExternals: ov.dtsExternals } : {}),
			...(ov.platform !== undefined ? { platform: ov.platform } : {}),
			...(ov.css !== undefined ? { css: ov.css as CssOptions } : {}),
			...(ov.outSubdir !== undefined ? { outSubdir: ov.outSubdir } : {}),
		});
	}
	const baseEntries: Record<string, string> = {};
	const baseIsDual = config.format.includes("cjs");
	for (const [name, src] of Object.entries(entries)) {
		if (overriddenEntryNames.has(name)) continue;
		baseEntries[name] = src;
		if (baseIsDual) dualExports.add(exportPathByEntry[name] ?? (name === "index" ? "." : `./${name}`));
	}
	return { partitions, baseEntries, dualExports, subdirExports };
}

/** Refuses a `copy` the build could not honour: no JS pass to run it, or a destination outside `pkg/`. */
function validateCopy(config: PackageBuildConfig, hasJsEntries: boolean): void {
	if (config.copy.length === 0) return;
	if (!hasJsEntries && config.exe !== undefined) {
		throw new ConfigValidationError({
			path: "copy",
			reason: "a package that only compiles a binary runs no JS pass, so nothing would copy these files",
		});
	}
	for (const entry of config.copy) {
		if (typeof entry === "string" || entry.to === undefined) continue;
		const fromPkg = relative("/pkg", resolve("/pkg", entry.to));
		if (isAbsolute(entry.to) || fromPkg === ".." || fromPkg.startsWith(`..${sep}`)) {
			throw new ConfigValidationError({
				path: "copy",
				reason: `"to" must stay inside the group's pkg/ directory (got "${entry.to}")`,
			});
		}
	}
}

/** The `exports` of a group's emitted manifest, or `undefined` when there is none to read. */
function readEmittedExports(cwd: string, groupId: string): unknown {
	try {
		return (JSON.parse(readFileSync(join(cwd, "dist", "prod", groupId, "pkg", "package.json"), "utf-8")) as Json)
			.exports;
	} catch {
		return undefined;
	}
}

/**
 * The optimistic next-version read for a package `set.name` renames: changesets key the release by the workspace
 * package's own name, so the emitted name takes that entry's version.
 */
function aliasNextVersions(
	seam: BundlerSeams["resolveNextVersions"] | undefined,
	sourceName: string,
	emittedName: string,
): BundlerSeams["resolveNextVersions"] {
	const read: BundlerSeams["resolveNextVersions"] =
		seam ?? ((cwd) => import("./changesets/next-versions.js").then((module) => module.resolveNextVersions(cwd)));
	return async (cwd) => {
		const { versions } = await read(cwd);
		const own = versions.get(sourceName);
		if (own === undefined) return { versions };
		const aliased = new Map(versions);
		aliased.set(emittedName, own);
		return { versions: aliased };
	};
}

/** A decoded empty `[package.build.meta]` table, which a config that never wrote one also decodes to. */
const defaultMetaFingerprint = JSON.stringify(Schema.decodeUnknownSync(MetaConfig)({}));

/**
 * The generator the bundle table names, if any. A failure is named in `issues.json` the way the meta pass names a
 * renderer failure, since it never reaches that pass.
 */
async function resolveConfiguredGenerator(
	options: BundlerBuildOptions,
	packageName: string,
	groups: ReadonlyArray<BuildGroupSpec>,
	collector: BuildCollector,
	seams: Partial<BundlerSeams>,
): Promise<OgImageGenerator | undefined> {
	const name = options.bundle?.openGraph?.generate;
	if (name === undefined) return undefined;
	try {
		return await Effect.runPromise(
			resolveOgGenerator(name, {
				packageName,
				...(seams.importOgPeer !== undefined ? { importModule: seams.importOgPeer } : {}),
			}),
		);
	} catch (err) {
		if (err instanceof OgGenerateError) {
			for (const g of groups) {
				collector.recordError(g.id, { source: "meta", level: "error", code: "og-generate-failed", text: err.message });
			}
		}
		throw err;
	}
}

/** The mutable facts the failure path reads: how far the build got, and whose build it is. */
interface BuildProgress {
	phase: BundlerPhase;
	packageName: string;
}

/**
 * The orchestration, in plain async code over the ported modules. A thrown value reaches the Effect boundary in
 * {@link Bundler.build}; the issues artifact is written on the way out of either terminal path.
 */
async function runBuild(
	options: BundlerBuildOptions,
	collector: BuildCollector,
	progress: BuildProgress,
): Promise<{ readonly issuesPath: string; readonly targetsPath: string | undefined }> {
	const { cwd, config, noExe, verbose, seams = {} } = options;
	let issuesPath = join(cwd, "dist", "prod", "issues.json");

	// Persist the structured diagnostics on every terminal path: a failed build is exactly when an agent wants to
	// read why. `buildOk` is stamped because a crashed build can leave every diagnostic bucket empty, which is
	// otherwise byte-identical to a clean gate. A write failure must never compound or mask the build's outcome.
	const writeIssuesBestEffort = (err?: unknown): void => {
		try {
			const written = (seams.writeIssues ?? writeIssuesArtifact)({
				cwd,
				target: "prod",
				reports: collector.snapshot(progress.packageName),
				buildOk: err === undefined,
				...(err !== undefined ? { failure: describeFailure(err) } : {}),
			});
			if (written !== undefined) issuesPath = written;
		} catch {
			// intentionally swallowed — see above
		}
	};

	try {
		const sourcePkg = (seams.readPackageJson ?? readPackageJson)(cwd);
		const version = sourcePkg.version ?? "0.0.0";
		// The build reports under the workspace package's own name; everything it emits carries `set.name` when written.
		const sourceName = sourcePkg.name ?? "unknown";
		progress.packageName = sourceName;
		validateManifestSet(config.manifest.set, config.manifest.drop);
		const packageName = emittedPackageName(config.manifest.set, sourceName);
		// The built-output link condition is checked here and removed before anything reads the exports: it is a
		// workspace-only route, and a `./dist/prod/...` target would otherwise read as a build source.
		const builtTargets = builtConditionTargets(sourcePkg.exports);
		const pkg = stripBuiltCondition(sourcePkg);

		const jsx = resolveJsxConfig((seams.readTsconfigJsx ?? readTsconfigJsx)(cwd), config.jsx);
		const tsconfigPath = (seams.writeTsconfig ?? writeTsconfig)(cwd, jsx);
		const exportsMap = pkg.exports as Record<string, string> | undefined;
		const publishTargets = readPublishTargets(pkg);
		const osCpu = { os: (pkg.os as string[] | undefined) ?? [], cpu: (pkg.cpu as string[] | undefined) ?? [] };
		// "auto" resolves here, against `ci`: left for the meta pass, it would read the process environment instead.
		const meta: MetaOptions | undefined =
			config.meta === false
				? undefined
				: {
						localPaths: config.meta.localPaths,
						optimistic: config.meta.optimistic === "auto" ? !options.ci : config.meta.optimistic,
						tsdoc: config.meta.tsdoc,
					};
		const hasLooseFiles = Object.keys(config.looseFiles).length > 0;

		// Fast-fail config validation, before any build work. An untouched meta table is not a request for a model:
		// a bin-only package with no exports map still builds.
		const metaIsExplicit = config.meta !== false && JSON.stringify(config.meta) !== defaultMetaFingerprint;
		await Effect.runPromise(
			Effect.flatMap(ConfigValidator, (v) =>
				v.validate({
					baseName: packageName,
					hasExports: exportsMap !== undefined && Object.keys(exportsMap).length > 0,
					...(publishTargets !== undefined ? { targets: publishTargets } : {}),
					...(config.exe !== undefined ? { exe: config.exe } : {}),
					osCpu,
					// The validator stats these, so they resolve against the package rather than the process directory.
					...(meta !== undefined && metaIsExplicit
						? { meta: { ...meta, localPaths: meta.localPaths?.map((path) => resolve(cwd, path)) } }
						: {}),
					...(hasLooseFiles ? { looseFiles: config.looseFiles } : {}),
				}),
			).pipe(Effect.provide(ConfigValidator.layer)),
		);

		// Resolve the SEA spec once. The emitted filename is computed, not read from disk, so `noExe` can program the
		// same manifest without a build, and the exe entry source is excluded from the JS pass so a pure-binary
		// package emits no dead JS.
		const exeSpecs = config.exe !== undefined ? normalizeExeOptions(config.exe, osCpu) : [];
		// A package's exports["."] resolves to exactly one SEA, so the manifest rewrite below reads the first spec and
		// target. Reject anything else rather than program the manifest for only the first binary.
		if (config.exe !== undefined && (exeSpecs.length !== 1 || (exeSpecs[0]?.targets.length ?? 0) !== 1)) {
			throw new ConfigValidationError({
				path: "exe",
				reason: `exe build requires exactly one binary with one target (got ${exeSpecs.length} spec(s), ${exeSpecs[0]?.targets.length ?? 0} target(s) on the first). A package's exports["."] resolves to a single SEA — cross-platform binaries must each ship as their own per-platform package.`,
			});
		}
		const exeSpec = exeSpecs[0];
		const exeTarget = exeSpec?.targets[0];
		const exeFileName = exeSpec && exeTarget ? computeExeFileName(exeSpec.fileName, exeTarget) : undefined;
		const exeEntrySource = exeSpec?.entry ?? "./src/bin.ts";
		const exeRewrite =
			config.exe !== undefined && exeFileName !== undefined
				? { source: exeEntrySource, fileName: exeFileName, dir: "bin" }
				: undefined;

		const entries = packageJsonEntries({
			pkg: { exports: pkg.exports, bin: pkg.bin },
			...(config.exe !== undefined ? { excludeSources: [exeEntrySource] } : {}),
		});
		const hasJsEntries = Object.keys(entries).length > 0;

		// Ambient types-only .d.ts exports are validated here (mixed-export + collision) and copied by the build.
		const ambient = extractAmbientDts({ exports: pkg.exports, bin: pkg.bin }, {});
		assertNoEntryCollisions(Object.keys(entries), ambient);
		// A condition-object export the manifest cannot point at built files is refused here, before any build work,
		// not from inside the JS pass's manifest plugin.
		assertBuildableConditionExports(pkg.exports, config.exe !== undefined ? { exeSource: exeEntrySource } : {});
		// A types-only package has nothing for the JS pass to build, and tsdown would throw an opaque "No input files".
		if (ambient.length > 0 && !hasJsEntries && config.exe === undefined) {
			throw new ConfigValidationError({
				path: "exports",
				reason:
					"a types-only package with only ambient .d.ts exports is not supported — add at least one JS entry (or an exe) alongside the ambient declarations",
			});
		}

		validateCopy(config, hasJsEntries);

		const { partitions, baseEntries, dualExports, subdirExports } = partitionOverrides(
			config,
			entries,
			exportsMap,
			sourceName,
		);
		const looseFiles = hasLooseFiles ? normalizeLooseFiles(config.looseFiles) : undefined;

		const { groups, resolution } = deriveProdGroups(publishTargets, packageName);
		// Advisory only: a valid target set no final release reaches. Attributed to the first group.
		const anchor = resolution.groups[0]?.id ?? "npm";
		for (const text of releaseWarnings(resolution)) {
			collector.recordWarning(anchor, { source: "config", level: "warn", code: "targets-no-final-release", text });
		}

		// A pure-binary (exe-only) package has no JS entries, and tsdown would throw "No input files". Its manifest is
		// emitted standalone in the exe step below.
		if (hasJsEntries || config.exe === undefined) {
			progress.phase = "js";
			await (seams.buildTargetGroups ?? realBuildTargetGroups)({
				cwd,
				version,
				entry: baseEntries,
				tsconfigPath,
				groups,
				devManifest: "preserve",
				externals: config.externals,
				// Always passed, the empty list included: the manifest's standard stripping runs only when it is set.
				drop: config.manifest.drop,
				...(Object.keys(config.manifest.set).length > 0 ? { set: config.manifest.set } : {}),
				format: config.format,
				emitDts: config.emitDts,
				emitDeclarations: true,
				collector,
				verbose,
				onPass: (pass) => {
					progress.phase = pass === "dts" ? "dts" : "js";
				},
				...(config.bundledPackages.length > 0 ? { bundledPackages: config.bundledPackages } : {}),
				...(config.dtsExternals.length > 0 ? { dtsExternals: config.dtsExternals } : {}),
				...(config.bundleNodeModules ? { bundleNodeModules: true } : {}),
				...(config.bundle.length > 0 ? { bundle: config.bundle } : {}),
				...(config.minify ? { minify: true } : {}),
				...(Object.keys(config.define).length > 0 ? { define: config.define } : {}),
				...(partitions.length > 0 ? { overrides: partitions } : {}),
				...(dualExports !== undefined ? { dualExports } : {}),
				...(subdirExports.size > 0 ? { subdirExports } : {}),
				...(looseFiles !== undefined ? { looseFiles } : {}),
				...(config.copy.length > 0 ? { copy: config.copy } : {}),
				...(options.plugins.length > 0 ? { extraPlugins: options.plugins } : {}),
				...(exeRewrite !== undefined ? { exeRewrite } : {}),
			});
		}

		// The target-to-group binding the release action reads.
		progress.phase = "manifest";
		const targetsPath = (seams.writeTargetsBinding ?? realWriteTargetsBinding)(cwd, resolution);

		// The meta bundle, for every group. An exe-only package has no declarations for API Extractor to read, and
		// `emitDts: false` skipped writing them.
		if (meta !== undefined && config.emitDts && (config.exe === undefined || hasJsEntries)) {
			progress.phase = "meta";
			const generate = await resolveConfiguredGenerator(options, packageName, groups, collector, seams);
			const bundleMeta = options.bundle !== undefined ? bundleMetaOptionsOf(options.bundle, generate) : undefined;
			await (seams.runMetaPass ?? defaultRunMetaPass)({
				cwd,
				packageName,
				tsconfigPath,
				groups,
				entries,
				exportsMap,
				overrides: config.overrides,
				meta: { ...meta, ...(bundleMeta !== undefined ? { bundle: bundleMeta } : {}) },
				collector,
				ci: options.ci,
				targets: resolution.targets,
				...(seams.generateMeta !== undefined ? { generateMeta: seams.generateMeta } : {}),
				...(packageName !== sourceName
					? { resolveNextVersions: aliasNextVersions(seams.resolveNextVersions, sourceName, packageName) }
					: seams.resolveNextVersions !== undefined
						? { resolveNextVersions: seams.resolveNextVersions }
						: {}),
			});
		}

		// Strip declaration source maps from the published dirs. The meta pass reads them for original-source
		// positions, so this runs after it, but they reference sources the tarball does not ship.
		progress.phase = "dts";
		for (const g of groups) removeDeclarationMaps(join(cwd, "dist", "prod", g.id, "pkg"));

		// The SEA step: compile the binary into each group's pkg/bin. It runs after the library build so that build's
		// clean cannot wipe the binary. An exe-only package ran no JS pass, so its manifest is emitted here.
		if (exeSpec !== undefined && exeRewrite !== undefined && exeFileName !== undefined) {
			for (const g of groups) {
				const outDir = join(cwd, "dist", "prod", g.id, "pkg");
				if (!hasJsEntries) {
					progress.phase = "manifest";
					const manifest = await buildEmittedManifest({
						pkg,
						cwd,
						targetGroup: { id: g.id, name: g.name, isProd: true },
						devManifest: "preserve",
						drop: config.manifest.drop,
						set: config.manifest.set,
						exeRewrite,
					});
					mkdirSync(outDir, { recursive: true });
					writeFileSync(join(outDir, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
					for (const file of ["LICENSE", "README.md"]) {
						try {
							copyFileSync(join(cwd, file), join(outDir, file));
						} catch {
							// optional file absent — skip
						}
					}
				}
				if (!noExe) {
					progress.phase = "exe";
					const binDir = join(outDir, "bin");
					await (seams.runExeBuild ?? defaultRunExeBuild)({
						cwd,
						outDir: binDir,
						specs: exeSpecs,
						collector,
						groupId: g.id,
						verbose,
					});
					// Drift guard: the manifest points at the computed name, so assert the compiler emitted it. An injected
					// compile writes nothing, so it is skipped then.
					if (seams.runExeBuild === undefined && !existsSync(join(binDir, exeFileName))) {
						throw new Error(
							`exe: expected compiled binary at ${join(binDir, exeFileName)} but it is missing — tsdown's emitted name may have drifted from computeExeFileName`,
						);
					}
				}
			}
		}

		// An export or bin target that nothing in the package matches, a `*` pattern or a literal path, resolves to nothing
		// for a consumer, and the build has no other reason to notice. The SEA's path is left out: `--no-exe` and an injected
		// compile write no binary, and the drift guard above already asserts a real compile emitted it.
		const exeExportPath = exeRewrite !== undefined ? `./${exeRewrite.dir}/${exeRewrite.fileName}` : undefined;
		for (const g of groups) {
			for (const { field, key, target } of unmatchedExportPatterns(join(cwd, "dist", "prod", g.id, "pkg"), {
				...(exeExportPath !== undefined ? { ignore: [exeExportPath] } : {}),
			})) {
				collector.recordWarning(g.id, {
					source: "config",
					level: "warn",
					code: "exports-pattern-unmatched",
					text:
						field === "bin"
							? `The bin "${key}" points at "${target}", which is not a file in the emitted package. Point it at a source the build emits, or ship the file from public/ or with [package.build] copy.`
							: target.includes("*")
								? `The exports pattern "${key}" points at "${target}", which matches no file in the emitted package. Ship the files from public/ or with [package.build] copy.`
								: `The export "${key}" points at "${target}", which is not a file in the emitted package. Point it at a source the build emits, or ship the file from public/ or with [package.build] copy.`,
				});
			}
		}

		// A built-condition target that names no file the build emitted for its export resolves to nothing for the
		// plain-Node consumer it exists for.
		if (builtTargets.length > 0) {
			const emitted = groups.map((g) => ({ groupId: g.id, exports: readEmittedExports(cwd, g.id) }));
			for (const { exportKey, target, expected } of mismatchedBuiltTargets(builtTargets, emitted)) {
				collector.recordWarning(anchor, {
					source: "config",
					level: "warn",
					code: "exports-built-condition-unmatched",
					text:
						expected !== undefined
							? `The export "${exportKey}" names "${target}" under the effected-built condition, which is not the file the build emits for it. Write "${expected}".`
							: `The export "${exportKey}" names "${target}" under the effected-built condition, but the build emits no JS file for that export.`,
				});
			}
		}

		writeIssuesBestEffort();
		return { issuesPath, targetsPath };
	} catch (err) {
		writeIssuesBestEffort(err);
		throw err;
	}
}

/**
 * Builds one package: the JS and declaration passes for every publish group, the emitted manifest,
 * `dist/prod/targets.json`, the API model, an optional SEA binary, and `dist/prod/issues.json`.
 *
 * @public
 */
export class Bundler {
	/**
	 * Runs a build of the package at `options.cwd`, writing into its `dist/prod`.
	 *
	 * @remarks
	 * It writes nothing to stdout; rendering the report belongs to the caller. A structurally invalid config fails
	 * {@link ConfigValidationError} before any build work, and anything thrown afterwards fails
	 * {@link BundlerError} naming the phase. Both paths write `issues.json` stamped `buildOk: false` first.
	 */
	static readonly build: (
		options: BundlerBuildOptions,
	) => Effect.Effect<BundlerBuildResult, BundlerError | ConfigValidationError> = Effect.fn("Bundler.build")(function* (
		options: BundlerBuildOptions,
	) {
		const collector = new BuildCollector();
		const progress: BuildProgress = { phase: "validate", packageName: "unknown" };
		const snapshot = (): BuildReport =>
			collector.snapshot(progress.packageName)[0] ??
			BuildReport.make({ package: progress.packageName, targetGroups: [] });
		const { issuesPath, targetsPath } = yield* Effect.tryPromise({
			try: () => runBuild(options, collector, progress),
			catch: (cause): BundlerError | ConfigValidationError =>
				cause instanceof ConfigValidationError
					? cause
					: BundlerError.make({
							phase: progress.phase,
							message: causeMessage(cause) ?? String(cause),
							cause,
							report: snapshot(),
						}),
		});
		return BundlerBuildResult.make({ report: snapshot(), issuesPath, targetsPath });
	});
}
