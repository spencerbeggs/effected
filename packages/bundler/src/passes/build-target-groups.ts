// packages/bundler/src/passes/build-target-groups.ts
import type { DescendError } from "@effected/walker";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import type { Plugin } from "rolldown";
import type { CopyEntry } from "../config/BuildConfig.js";
import { packageNameOf, resolveBundledSiblings, siblingPaths } from "../dts/bundled-siblings.js";
import { analyzeReexportBarrel, collectExportNames, renderReexportStub } from "../dts/reexport-stub.js";
import { writeDtsEmitTsconfig } from "../dts/resolved-tsconfig.js";
import { extractAmbientDts } from "../entries/ambient-dts.js";
import type { PackageJsonLike } from "../entries/extract.js";
import type { ConfigValidationError } from "../errors.js";
import type { TargetGroupRef } from "../manifest/emit-manifest.js";
import { emitManifest } from "../manifest/emit-manifest.js";
import type { DualExports, ExeRewrite } from "../manifest/transform.js";
import type { BuildCollector, PassKind } from "../report/collector.js";
import { buildMetricsPlugin } from "../report/metrics-plugin.js";
import { createTimer } from "../report/timer.js";
import { createTsdownLogger } from "../report/tsdown-logger.js";
import { bundlePatterns, bundledEverywhere } from "./bundled-deps.js";
import { cjsDefaultInterop } from "./cjs-default-interop.js";
import type { NormalizedLooseFile } from "./loose-files.js";
import { nodeBuiltinDefaultInterop } from "./node-builtin-default-interop.js";
import { stampVersions } from "./stamp-versions.js";
import { copyAmbientDts, copyPublicDir } from "./sync-public.js";
import type { BuildFormat, BuildGroupSpec, BuildPlatform } from "./target-groups.js";
import {
	deriveDeclarationsPassOptions,
	deriveDtsPassOptions,
	deriveTargetGroupOptions,
	outDirFor,
} from "./target-groups.js";
import type { InlinedPackage } from "./third-party-licenses.js";
import { THIRD_PARTY_LICENSES, renderThirdPartyLicenses, thirdPartyLicenses } from "./third-party-licenses.js";

/**
 * Signature compatible with tsdown's `build(inlineConfig)`.
 *
 * @public
 */
export type TsdownBuild = (config: Record<string, unknown>) => Promise<unknown>;

/**
 * CSS handling for a partition's JS pass, forwarded VERBATIM to tsdown's `css` option (consumed
 * by `@tsdown/css`). Structurally typed so tsdown-plugins takes no dependency on `@tsdown/css`.
 * The package whose runtime is built must install `@tsdown/css`; tsdown loads it lazily.
 * @public
 */
export interface CssOptions {
	readonly modules?:
		| boolean
		| { readonly localsConvention?: string; readonly namedExport?: boolean; readonly [k: string]: unknown };
	readonly [k: string]: unknown;
}

/**
 * One entry partition built with its own format + bundling posture, layered into the
 * SAME outDir as the base build (clean:false). Each partition is built from ITS OWN values
 * only — an option this override omits is simply absent for this partition, not inherited
 * from the base build (partition 0 in `buildTargetGroups`). Callers that want a base-build
 * value to also apply to an override must pass it again explicitly. An override can
 * therefore depend on NOT inheriting the base build's externals. `entry` is a subset of the package's
 * entries (`entryName -> source path`).
 * @public
 */
export interface EntryOverride {
	readonly entry: Record<string, string>;
	readonly format?: ReadonlyArray<BuildFormat> | undefined;
	readonly externals?: ReadonlyArray<string> | undefined;
	readonly bundle?: ReadonlyArray<string> | undefined;
	readonly bundleNodeModules?: boolean | undefined;
	readonly bundledPackages?: ReadonlyArray<string> | undefined;
	readonly dtsExternals?: ReadonlyArray<string> | undefined;
	/** JS-pass platform for this partition. Defaults to the base "node". Use "browser" for a web runtime. */
	readonly platform?: BuildPlatform | undefined;
	/** CSS handling forwarded to tsdown's `css` option (JS pass only). Enables `@tsdown/css`. */
	readonly css?: CssOptions | undefined;
	/**
	 * Build this partition into `<groupOutDir>/<outSubdir>/` instead of the shared group root.
	 * Isolates a sub-package (e.g. an RSPress `./runtime`) so its bundleless per-file output cannot
	 * collide with the base partition's output and its barrel path is deterministic. The partition's
	 * entry should be `{ index: <barrel source> }` so it emits `<outSubdir>/index.js` + `<outSubdir>/index.d.ts`.
	 */
	readonly outSubdir?: string | undefined;
}

/** @public */
export interface BuildTargetGroupsOptions {
	readonly cwd: string;
	readonly version: string;
	readonly entry: Record<string, string>;
	readonly tsconfigPath: string;
	readonly groups: ReadonlyArray<BuildGroupSpec>;
	readonly devManifest: "preserve" | "resolve";
	readonly externals?: ReadonlyArray<string>;
	/**
	 * Packages externalized in the dts pass ONLY — emitted as `import ... from "..."`
	 * references in the `.d.ts` rather than inlined — while the JS pass still bundles
	 * them per `bundleNodeModules`. The dts pass `neverBundle` becomes the union of
	 * `externals` and `dtsExternals`. Use when a dependency's types cannot be safely
	 * inlined into a single bundled declaration file (e.g. effect's cross-module
	 * `declare module` augmentations, which inline into conflicting interface
	 * extensions in consumers). The JS pass is unaffected.
	 */
	readonly dtsExternals?: ReadonlyArray<string> | undefined;
	/**
	 * External packages whose declarations are inlined into the bundled dts
	 * (rslib `dtsBundledPackages` equivalent). Forwarded to the dts pass as
	 * `deps.dts.alwaysBundle` alongside `deps.neverBundle: true`; unlike
	 * `deps.onlyBundle` this does not enable tsdown's strict-mode check that
	 * errors on every unlisted transitive dependency. The JS pass is unaffected.
	 */
	readonly bundledPackages?: ReadonlyArray<string> | undefined;
	/**
	 * Force-bundle node_modules (and workspace) JS dependencies that are not
	 * externalized, restoring the rslib bundle-everything-except-externals
	 * behavior. Acts through the JS pass's `unbundle: false` posture, NOT through a
	 * `deps` flag: bundling node_modules is already tsdown's default for anything the
	 * manifest does not declare as a production dependency. The dts pass mirrors it by
	 * likewise leaving that default in place, so the bundled declarations are also
	 * self-contained. Defaults to false (current behavior).
	 */
	readonly bundleNodeModules?: boolean | undefined;
	/**
	 * Force-bundle (inline) these packages into the JS output (tsdown `deps.alwaysBundle`),
	 * even declared deps that would otherwise be auto-externalized. The inverse of
	 * `externals`. Forwarded to the JS pass AND, identically, to the dts pass and the
	 * prod-only per-module declarations pass — the dts pass RE-EMITS the dual-format `.cjs`
	 * chunk (see `buildTargetGroups`'s class doc), so a force-bundled dependency must stay
	 * inlined there too, or the re-emitted `.cjs` re-externalizes it.
	 */
	readonly bundle?: ReadonlyArray<string> | undefined;
	/** Output formats to emit. Defaults to esm-only when unset. */
	readonly format?: ReadonlyArray<BuildFormat> | undefined;
	/**
	 * Minify the JS output of PROD groups only (dev is never minified). Defaults to
	 * false — this builder targets Node libraries where readable output is preferred.
	 */
	readonly minify?: boolean | undefined;
	/** Top-level `package.json` keys deleted from every emitted manifest, after the standard stripping. */
	readonly drop?: ReadonlyArray<string> | undefined;
	/** Top-level string keys written over every emitted manifest after `drop`; `name` is carried by each group. */
	readonly set?: Readonly<Record<string, string>> | undefined;
	/**
	 * Extra rolldown plugins, forwarded to BOTH the JS pass and the dts-only pass. A plugin
	 * with JS-lifecycle side effects (asset emitters, banner injectors) runs in both passes;
	 * the dts pass is declarations-only, so for esm-only builds it produces no JS chunks and most
	 * rolldown hooks are no-ops there. For DUAL (esm+cjs) builds, however, tsdown's dts pass
	 * still RE-EMITS the `.cjs` JS chunk and overwrites the JS pass's `.cjs` output — so a
	 * `renderChunk`/`generateBundle` plugin that must persist onto the final `.cjs` (e.g. the
	 * built-in cjs-default-interop) has to run in the dts pass too. A caller relying on a hook
	 * firing exactly once should guard the second invocation.
	 */
	readonly extraPlugins?: ReadonlyArray<Plugin>;
	/**
	 * Compile-time global replacements forwarded to BOTH the JS and dts passes' `define`.
	 * Build-wide (shared by every entry partition); merged after the auto-injected
	 * `process.env.__PACKAGE_VERSION__` so a user key of the same name wins.
	 */
	readonly define?: Record<string, string> | undefined;
	/**
	 * Entry partitions with their own format/bundling, built into the same outDir after
	 * the base entries. Used for per-entry format overrides (e.g. one CJS entry in an
	 * otherwise ESM-only package). The base `entry` must already EXCLUDE these entries.
	 */
	readonly overrides?: ReadonlyArray<EntryOverride> | undefined;
	/**
	 * Standalone bundled output files emitted at literal paths into each group's pkg/ dir,
	 * outside the exports/dts/meta graph (e.g. pnpm config-dependency pnpmfiles). Each runs as
	 * one extra single-entry, bundled (unbundle:false), no-dts, no-manifest pass per group,
	 * inheriting the group's bundleNodeModules/bundle/externals posture so the file is
	 * self-contained. Caller passes the normalized form (see normalizeLooseFiles).
	 */
	readonly looseFiles?: ReadonlyArray<NormalizedLooseFile> | undefined;
	/**
	 * Non-module assets for each group's pkg/ dir, handed to tsdown's `copy` on the base partition's JS pass, after its
	 * clean. A `to` is taken relative to the group's pkg/ dir, where tsdown alone would read it against `cwd` and write
	 * every group's copy to one place.
	 */
	readonly copy?: ReadonlyArray<string | CopyEntry> | undefined;
	/**
	 * Which export keys get a CJS `require` condition in the emitted manifest. Pass a Set
	 * when overrides give different entries different formats; omit for the uniform
	 * `format`-includes-cjs behavior.
	 */
	readonly dualExports?: DualExports | undefined;
	/** Export keys built into a `<key>/index.*` subdir (e.g. an RSPress `./runtime`). */
	readonly subdirExports?: ReadonlySet<string> | undefined;
	/** When set, rewrite the emitted manifest's exports/bin values equal to the exe source to the SEA path and add it to `files`. */
	readonly exeRewrite?: ExeRewrite | undefined;
	/** Injectable for tests; defaults to tsdown's build. */
	readonly build?: TsdownBuild;
	/** Told when a pass starts, so a caller can name the pass a thrown error came from. */
	readonly onPass?: ((pass: PassKind) => void) | undefined;
	/** When set, muzzle tsdown (silent + customLogger) and capture metrics/timing into this collector. */
	readonly collector?: BuildCollector | undefined;
	/** Compute gzip sizes for emitted files (verbose render). Forwarded to the metrics plugin. */
	readonly verbose?: boolean | undefined;
	/**
	 * Emit a per-module (`unbundle: true`) declaration tree into `dist/prod/<id>/declarations/` per
	 * group, in addition to the bundled dts in `pkg/`. API Extractor's diagnostics-run input for the
	 * meta pass. Prod-only; the bundler sets it for `--target prod`. Absent → no third pass
	 * (byte-identical to the two-pass default). Not captured by the collector. Has no effect when
	 * `emitDts` is `false` — the declarations pass exists only to feed the dts-derived meta pass.
	 */
	readonly emitDeclarations?: boolean | undefined;
	/**
	 * When `false`, skip BOTH the bundled per-entry dts pass (Pass 2) and the prod per-module
	 * declarations pass (Pass 3) — no TypeScript compiler load. The JS pass (Pass 1) and
	 * `copyPublicDir` still run. Defaults to `true` (current two/three-pass behavior).
	 */
	readonly emitDts?: boolean | undefined;
}

/**
 * Entry name of the conventional primary (".") export, which `createEntryName` maps to "index". It is
 * the re-export-stub base: a secondary entry that re-exports a subset of it gets a thin stub pointing
 * here instead of a self-contained rollup.
 */
const STUB_BASE_ENTRY = "index";

/** The configured copy entries as tsdown takes them for one group, with each `to` anchored to that group's outDir. */
const copyEntriesFor = (
	entries: ReadonlyArray<string | CopyEntry>,
	outDir: string,
	join: Path.Path["join"],
): ReadonlyArray<unknown> =>
	entries.map((entry) => {
		if (typeof entry === "string") return entry;
		return {
			from: entry.from,
			...(entry.to !== undefined ? { to: join(outDir, entry.to) } : {}),
			...(entry.flatten !== undefined ? { flatten: entry.flatten } : {}),
		};
	});

/**
 * Run tsdown.build() per TargetGroup. Composable so the escape hatch gets multi-group too.
 *
 * Each group runs TWO passes to the SAME outDir:
 *  1. JS pass — per-module JS (`unbundle: true`, `dts: false`), with the `emitManifest` plugin
 *     and the `public/` copy. Default `clean: true` gives it a fresh outDir.
 *  2. dts pass — bundled declarations only (`unbundle: false`, `dts: { dtsOnly: true }` (`emitDtsOnly` below rolldown-plugin-dts 0.30),
 *     `clean: false`). No manifest plugin, no copy, no sourcemaps. `clean: false` is load-bearing:
 *     it must NOT wipe the JS the first pass just wrote.
 *
 * Why two passes: tsdown's `unbundle` maps to rolldown `output.preserveModules` for the whole
 * build (JS and the dts plugin share it), so a single pass cannot give per-module JS + bundled
 * dts. Per-module dts breaks type portability (TS2883); bundling the JS re-bundles workspace
 * consumers. The split keeps per-module JS AND rolled-up, self-contained declarations.
 *
 * **The JS pass's `unbundle` flips to `false` for a `bundleNodeModules` partition** (see
 * `DerivedTsdownOptions` in `target-groups.ts`), so that partition's JS pass ALSO bundles
 * instead of preserving modules — a per-module preserveModules JS pass writes every inlined
 * node_modules dependency to its own sibling file (mirroring its `node_modules/...` path),
 * which `npm pack` then strips, breaking the "self-contained" promise `bundleNodeModules`
 * already makes. Scoped to that flag alone; every other build's JS pass is unaffected.
 *
 * The bundler's own reads and writes (the manifest, the tsconfigs, the stubs, `public/`) go through `FileSystem` and
 * `Path`; tsdown always works on the host disk. A tsdown rejection is a defect, carrying the thrown value.
 * @public
 */
export const buildTargetGroups: (
	options: BuildTargetGroupsOptions,
) => Effect.Effect<
	void,
	ConfigValidationError | PlatformError.PlatformError | DescendError,
	FileSystem.FileSystem | Path.Path
> = Effect.fnUntraced(function* (options: BuildTargetGroupsOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const { dirname, isAbsolute, join } = path;
	const build: TsdownBuild =
		options.build ?? ((yield* Effect.promise(() => import("tsdown"))).build as unknown as TsdownBuild);
	const publicDir = join(options.cwd, "public");

	// Zero-config ambient .d.ts exports (types-only hand-authored declarations): extracted from the
	// package manifest ONCE and copied into every resolved group's own pkg dir below, alongside
	// copyPublicDir. Running the copy HERE — inside buildTargetGroups rather than only in runBuild —
	// means every build path, including the self-hosting escape hatches that call this function
	// directly and never reach runBuild, gets its ambient exports copied. A synthetic/test cwd with
	// no real package.json (or one with no ambient exports) yields an empty array and no-ops below.
	const pkgForAmbient: PackageJsonLike = yield* fs.readFileString(join(options.cwd, "package.json")).pipe(
		Effect.flatMap((text) => Effect.try(() => JSON.parse(text) as PackageJsonLike)),
		// synthetic cwd (tests) or unreadable manifest — no ambient exports to copy
		Effect.orElseSucceed((): PackageJsonLike => ({})),
	);
	const ambient = extractAmbientDts(pkgForAmbient, {});

	// The dts/declarations EMIT passes run on this package's TypeScript (7.1+, the tsgo API) and use a
	// `stableTypeOrdering` variant of the resolved tsconfig so union/type member ordering is
	// deterministic across builds (#156). This is SEPARATE from the api-extractor tsconfig
	// (`options.tsconfigPath`, consumed by the later runMetaPass): api-extractor compiles with its OWN
	// bundled TypeScript 6, which predates the flag and would hard-error on the unknown compiler option.
	// Derived once; falls back to the original path when it cannot be read (synthetic test paths).
	const dtsEmitTsconfigPath = yield* writeDtsEmitTsconfig(options.tsconfigPath);

	// A bundled workspace sibling resolves to source, which tsgo cannot declare, so a partition inlining one gets a
	// tsconfig mapping it to the sibling's built declarations. Resolved before any pass runs, so a sibling that has not
	// been built fails the build here. Only a partition's own siblings reach its map. With declarations off, no pass
	// reads them, so a sibling's build is not required.
	const bundledSiblings =
		options.emitDts === false
			? []
			: yield* resolveBundledSiblings(options.cwd, [
					...(options.bundledPackages ?? []),
					...(options.overrides ?? []).flatMap((override) => override.bundledPackages ?? []),
				]);
	const emitTsconfigFor = (
		bundled: ReadonlyArray<string> | undefined,
	): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> => {
		const packages = new Set(bundled?.map(packageNameOf));
		const siblings = bundledSiblings.filter((sibling) => packages.has(sibling.name));
		return siblings.length > 0
			? writeDtsEmitTsconfig(options.tsconfigPath, { paths: siblingPaths(siblings, path) })
			: Effect.succeed(dtsEmitTsconfigPath);
	};

	const collector = options.collector;
	const verbose = options.verbose ?? false;

	// Build a partial config that muzzles tsdown and records into the collector for one pass.
	// Returns {} when there is no collector, preserving the raw-tsdown path.
	const instrument = (groupId: string): Record<string, unknown> =>
		collector === undefined ? {} : { logLevel: "silent", customLogger: createTsdownLogger(collector, groupId) };

	const metricsPlugins = (groupId: string, pass: PassKind, suppressMixedExports = false): Plugin[] =>
		collector === undefined ? [] : [buildMetricsPlugin(collector, groupId, pass, verbose, suppressMixedExports)];

	// PLUGIN_TIMINGS is rolldown's plugin-performance diagnostic. The builder's own always-on
	// plugins (savvy:emit-manifest, metrics) trip it on virtually every build, so in normal runs
	// it is unactionable noise; verbose keeps it available for profiling sessions.
	const timingChecks = { checks: { pluginTimings: verbose } };

	// Run a build pass under a timer, recording elapsed into the collector.
	const timed = <E, R>(groupId: string, pass: PassKind, run: Effect.Effect<unknown, E, R>): Effect.Effect<void, E, R> =>
		Effect.suspend(() => {
			options.onPass?.(pass);
			const timer = createTimer();
			return run.pipe(
				Effect.asVoid,
				Effect.ensuring(
					Effect.sync(() => {
						if (collector !== undefined) collector.recordPassTiming(groupId, pass, timer.elapsed());
					}),
				),
			);
		});
	// tsdown is promise-returning: a rejection is a defect carrying the thrown value, as an awaited throw was.
	const tsdown = (config: Record<string, unknown>): Effect.Effect<unknown> => Effect.promise(() => build(config));

	// An inlined module of another package keeps that package's version, which `define` would overwrite with this one's.
	const stampPlugin = yield* stampVersions({ cwd: options.cwd });
	// A package inlined only by `bundle` everywhere leaves the emitted manifest; the JS pass holds its code.
	const bundled = bundledEverywhere(options.bundle, options.overrides ?? []);

	for (const group of options.groups) {
		// One set per group: every partition writes into the group's pkg/, and the last pass writes the whole set.
		const licensesFound = new Map<string, InlinedPackage>();
		if (collector !== undefined) collector.registerGroup(group.id, Object.keys(options.entry));

		// Partition 0 is the base (options-level config); the rest come from options.overrides.
		const partitions: ReadonlyArray<EntryOverride> = [
			{
				entry: options.entry,
				...(options.format !== undefined ? { format: options.format } : {}),
				...(options.externals !== undefined ? { externals: options.externals } : {}),
				...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
				...(options.bundleNodeModules !== undefined ? { bundleNodeModules: options.bundleNodeModules } : {}),
				...(options.bundledPackages !== undefined ? { bundledPackages: options.bundledPackages } : {}),
				...(options.dtsExternals !== undefined ? { dtsExternals: options.dtsExternals } : {}),
			},
			...(options.overrides ?? []),
		];

		for (let p = 0; p < partitions.length; p++) {
			const part = partitions[p];
			if (part === undefined) continue;
			const isBase = p === 0;
			const partExternals = part.externals;
			const partBundle = part.bundle;
			const partBundleNodeModules = part.bundleNodeModules;
			const partBundledPackages = part.bundledPackages;
			const partDtsExternals = part.dtsExternals;

			const deriveInput = {
				group: group.id,
				cwd: options.cwd,
				version: options.version,
				entry: part.entry,
				tsconfigPath: yield* emitTsconfigFor(partBundledPackages),
				devManifest: options.devManifest,
				...(partExternals !== undefined ? { externals: partExternals } : {}),
				...(partBundleNodeModules !== undefined ? { bundleNodeModules: partBundleNodeModules } : {}),
				...(partBundledPackages !== undefined ? { bundledPackages: partBundledPackages } : {}),
				...(part.format !== undefined ? { format: part.format } : {}),
				...(options.minify !== undefined ? { minify: options.minify } : {}),
				...(options.define !== undefined ? { define: options.define } : {}),
				...(part.platform !== undefined ? { platform: part.platform } : {}),
			};
			const js = deriveTargetGroupOptions(deriveInput);
			const dts = deriveDtsPassOptions(deriveInput);
			const decl = deriveDeclarationsPassOptions(deriveInput);
			const partOutDir = part.outSubdir !== undefined ? join(js.outDir, part.outSubdir) : js.outDir;
			const targetGroup: TargetGroupRef = { id: group.id, name: group.name, isProd: js.isProd };

			// For an outSubdir partition (an isolated bundleless sub-package, e.g. an RSPress
			// `./runtime`), the JS pass must emit the WHOLE source subtree as a per-file glob, NOT
			// just the modules reachable from the barrel's import graph. Real RSPress plugins
			// reference some runtime components ONLY by file path — via `globalUIComponents` and
			// `resolve.alias` — and never import them from the barrel, so a barrel-only (unbundle)
			// pass would drop those files and the consuming site fails with "Module not found" /
			// broken alias targets. Globbing over the barrel's source directory ships every file.
			// The barrel source is the single value in `part.entry` (e.g. `./src/runtime/index.tsx`);
			// its `dirname` is the sub-package root (`./src/runtime`). The dts pass below keeps the
			// single named barrel entry so it still rolls up one bundled `<subdir>/index.d.ts`.
			//
			// Test/declaration files are excluded so they do not emit into the runtime output.
			const srcDir = dirname(Object.values(part.entry)[0] ?? "");
			const jsEntry =
				part.outSubdir !== undefined
					? [
							`${srcDir}/**/*.{ts,tsx,mts,cts}`,
							`!${srcDir}/**/*.{test,spec}.{ts,tsx,mts,cts}`,
							`!${srcDir}/**/*.d.{ts,cts,mts}`,
						]
					: js.entry;

			// Manifest is emitted ONCE per group, by the base partition's JS pass, covering the
			// whole package's exports with per-entry dual conditions.
			const manifestPlugin = isBase
				? yield* emitManifest({
						targetGroup,
						devManifest: options.devManifest,
						drop: options.drop,
						...(options.set !== undefined ? { set: options.set } : {}),
						sourceDir: options.cwd,
						dual: options.dualExports ?? js.format.includes("cjs"),
						emitDts: options.emitDts !== false,
						bundled,
						...(options.subdirExports !== undefined ? { subdirExports: options.subdirExports } : {}),
						...(options.exeRewrite !== undefined ? { exeRewrite: options.exeRewrite } : {}),
					})
				: undefined;

			const licensesPlugin = yield* thirdPartyLicenses({
				cwd: options.cwd,
				packageName: group.name,
				found: licensesFound,
			});

			// Pass 1: per-module JS. clean only on the very first partition (it owns the outDir).
			yield* timed(
				group.id,
				"js",
				tsdown({
					config: false,
					cwd: options.cwd,
					entry: jsEntry,
					outDir: partOutDir,
					format: js.format,
					platform: js.platform,
					sourcemap: js.sourcemap,
					minify: js.minify,
					unbundle: js.unbundle,
					clean: isBase ? js.clean : false,
					fixedExtension: js.fixedExtension,
					dts: js.dts,
					define: js.define,
					...timingChecks,
					...instrument(group.id),
					...(part.css !== undefined ? { css: part.css } : {}),
					...(isBase && options.copy?.length ? { copy: copyEntriesFor(options.copy, partOutDir, join) } : {}),
					...(partExternals?.length || partBundle?.length
						? {
								deps: {
									...(partExternals?.length ? { neverBundle: partExternals } : {}),
									// alwaysBundle force-inlines these packages (inverse of neverBundle), even
									// declared deps tsdown would auto-externalize.
									...(partBundle?.length ? { alwaysBundle: bundlePatterns(partBundle) } : {}),
								},
							}
						: {}),
					...(js.cjsDefault !== undefined ? { cjsDefault: js.cjsDefault } : {}),
					// nodeBuiltinDefaultInterop rewrites default imports of node: builtins to namespace
					// form so rolldown's CJS codegen emits correct interop (it otherwise accesses
					// `.default` on a bare `require("node:x")`, which is undefined). cjsDefaultInterop
					// promotes a default+named CJS entry chunk to module.exports = <default> (rslib
					// cjsInterop parity). Both are cjs-only and no-ops for esm.
					plugins: [
						stampPlugin,
						licensesPlugin,
						...(manifestPlugin ? [manifestPlugin] : []),
						...(js.format.includes("cjs") ? [nodeBuiltinDefaultInterop(), cjsDefaultInterop()] : []),
						...(options.extraPlugins ?? []),
						// The cjs branch above installs cjsDefaultInterop(), which makes rolldown's
						// MIXED_EXPORTS warning moot for this pass — suppress it wherever that footer
						// lands (here, the dts pass, and a cjs loose file) and nowhere else.
						...metricsPlugins(group.id, "js", js.format.includes("cjs")),
					],
				}),
			);

			const dtsNeverBundle = [...(partExternals ?? []), ...(partDtsExternals ?? [])];

			// Pass 2: bundled dts for this partition's entries. Always clean:false.
			//
			// Skip entirely when every entry was filtered out by deriveDtsPassOptions (e.g. a
			// hypothetical bin-only partition with no export entries) OR when the caller opted out
			// via `emitDts: false` (issue #198) — no TypeScript compiler load, JS pass unaffected.
			// This also skips Pass 3 below (per-module declarations), which only feeds the
			// dts-derived meta pass and has nothing to do once the dts pass itself is off. An empty
			// entry map would otherwise cause tsdown to throw "No input files".
			if (options.emitDts === false || Object.keys(dts.entry).length === 0) continue;

			// The dts pass's bundling posture tracks the JS pass's. There are three cases:
			//
			//  1. bundleNodeModules — the JS pass force-bundles all node_modules (rslib
			//     bundle-everything-except-externals). The dts must match: INLINE every
			//     node_modules type into the declarations, so the published package is
			//     self-contained and consumers need no extra declared deps for the inlined
			//     types. That is tsdown's DEFAULT dts posture, so this branch contributes no
			//     deps flag of its own; it only adds `dts.alwaysBundle` when bundledPackages
			//     is also set (belt-and-suspenders — already-inlined types stay inlined).
			//  2. bundledPackages without bundleNodeModules — "inline ONLY these declarations,
			//     externalize the rest" (rslib dtsBundledPackages parity). onlyBundle would
			//     put tsdown's dts pass into strict mode (it errors on every reachable
			//     node_modules type dep not in onlyBundle), unworkable when transitive type
			//     deps cannot all be enumerated. Instead externalize everything
			//     (`neverBundle: true`) and force-bundle only the listed packages via
			//     `deps.dts.alwaysBundle`, which tsdown consults FIRST in its external
			//     strategy, so the listed declarations still inline. `neverBundle: true`
			//     supersedes the dtsNeverBundle array — it is a strict superset of it.
			//  3. neither — the existing leaf bundled-dts behavior; only neverBundle applies.
			//
			// Across ALL three branches the dts pass `neverBundle` is the UNION of `externals`
			// and `dtsExternals`: dtsExternals are externalized in the dts pass only (emitted as
			// import references in the .d.ts) while the JS pass still bundles them. The JS pass
			// neverBundle (above) carries `externals` only — never dtsExternals.
			// Per-entry dts rollups (#185): run one SINGLE-entry dts build per entry, NOT one bundled
			// pass over all of `dts.entry`. A multi-entry rollup makes rolldown code-split the
			// declarations shared between entries into a content-hashed sibling chunk
			// (`<name>-<hash>.d.ts`) whose constituent-module naming AND split layout are
			// non-deterministic across builds, so the emitted `.d.ts` (and the `.api.json` that follows
			// it) flip bytes between otherwise-identical builds (#156). A single-entry rollup has no
			// shared chunk and is byte-stable by construction (proven: single-entry packages build
			// 4/4 byte-identical). Each per-entry build appends to the shared outDir (clean:false); the
			// JS pass already emitted per-module JS for every entry. The bundling posture (neverBundle /
			// bundleNodeModules / bundledPackages) is identical for every entry, so compute it once.
			const dtsDeps =
				dtsNeverBundle.length > 0 || dts.bundledPackages || partBundle?.length
					? {
							deps: {
								...(dtsNeverBundle.length > 0 ? { neverBundle: dtsNeverBundle } : {}),
								// The dts pass RE-EMITS the dual-format `.cjs` chunk (see the class doc above),
								// so it must carry the SAME `alwaysBundle` as the JS pass — otherwise a
								// force-bundled declared dependency is re-externalized in that re-emitted
								// `.cjs`. Forwarded exactly as the JS pass does.
								...(partBundle?.length ? { alwaysBundle: bundlePatterns(partBundle) } : {}),
								...(dts.bundledPackages
									? partBundleNodeModules
										? { dts: { alwaysBundle: dts.bundledPackages } }
										: { neverBundle: true as const, dts: { alwaysBundle: dts.bundledPackages } }
									: {}),
							},
						}
					: {};
			// Re-export-stub optimization (#185): a SECONDARY entry that is a pure named re-export
			// barrel whose every re-exported name is also exported by the primary `index` entry is
			// emitted as a thin `export { … } from "./index.js"` stub instead of a second self-contained
			// rollup that re-inlines the shared surface. This keeps a re-export-heavy multi-entry package
			// (e.g. `.` + a curated `./testing` subset) compact without reintroducing a shared chunk —
			// API Extractor follows the stub's cross-entry re-export to resolve the symbols from index's
			// already-self-contained `.d.ts`. Gated to FLAT entry names (so the specifier is a sibling
			// `./index.js`) and to packages exposing the conventional `index` (".") entry whose full
			// export-name set is statically enumerable (no `export * from`). A non-eligible entry
			// (distinct surface, local declarations, star re-export, or a name not in index) falls
			// through to a self-contained per-entry rollup.
			const stubEntries = new Map<string, { valueNames: ReadonlyArray<string>; typeNames: ReadonlyArray<string> }>();
			const readSource = (src: string): Effect.Effect<string | undefined> =>
				fs.readFileString(isAbsolute(src) ? src : join(options.cwd, src)).pipe(Effect.orElseSucceed(() => undefined));
			const baseSrc = dts.entry[STUB_BASE_ENTRY];
			if (baseSrc !== undefined && Object.keys(dts.entry).length > 1) {
				const baseSource = yield* readSource(baseSrc);
				const base = baseSource !== undefined ? collectExportNames(baseSource) : undefined;
				if (base?.complete === true) {
					for (const [entryName, entrySource] of Object.entries(dts.entry)) {
						if (entryName === STUB_BASE_ENTRY || entryName.includes("/")) continue;
						const source = yield* readSource(entrySource);
						if (source === undefined) continue;
						const analysis = analyzeReexportBarrel(source);
						if (!analysis.isPureNamedReexportBarrel) continue;
						const all = [...analysis.valueNames, ...analysis.typeNames];
						if (all.length === 0 || !all.every((n) => base.names.has(n))) continue;
						stubEntries.set(entryName, { valueNames: analysis.valueNames, typeNames: analysis.typeNames });
					}
				}
			}

			yield* timed(
				group.id,
				"dts",
				Effect.gen(function* () {
					for (const [entryName, entrySource] of Object.entries(dts.entry)) {
						const stub = stubEntries.get(entryName);
						if (stub !== undefined) {
							// Thin re-export stub instead of a self-contained rollup. The ESM `.d.ts` points at the
							// base's published `./index.js`; for dual format the CJS `.d.cts` points at `./index.cjs`.
							// Each appends to the shared outDir like the per-entry builds do.
							const variants = [{ file: `${entryName}.d.ts`, spec: `./${STUB_BASE_ENTRY}.js` }];
							if (dts.format.includes("cjs")) {
								variants.push({ file: `${entryName}.d.cts`, spec: `./${STUB_BASE_ENTRY}.cjs` });
							}
							for (const variant of variants) {
								const content = renderReexportStub({
									valueNames: stub.valueNames,
									typeNames: stub.typeNames,
									baseSpecifier: variant.spec,
								});
								yield* fs.writeFileString(join(partOutDir, variant.file), content);
								collector?.recordEmitted(group.id, "dts", { path: variant.file, bytes: Buffer.byteLength(content) });
							}
							continue;
						}
						yield* tsdown({
							config: false,
							cwd: options.cwd,
							entry: { [entryName]: entrySource },
							outDir: partOutDir,
							format: dts.format,
							platform: dts.platform,
							sourcemap: dts.sourcemap,
							unbundle: dts.unbundle,
							clean: false,
							fixedExtension: dts.fixedExtension,
							dts: dts.dts,
							define: dts.define,
							...timingChecks,
							...instrument(group.id),
							...dtsDeps,
							// The dts pass runs declarations-only, but for dual format tsdown still RE-EMITS the
							// `.cjs` JS chunk in this pass, overwriting the JS pass's footer'd `.cjs` with a
							// footer-less one (verified). Re-attach the interop plugins here so the footer lands on
							// the FINAL `.cjs` (this is the chunk that inlines vendor deps like vfile). Fresh plugin
							// instances per entry-build — rolldown plugin factories are not safe to reuse across builds.
							plugins: [
								...(dts.format.includes("cjs") ? [nodeBuiltinDefaultInterop(), cjsDefaultInterop()] : []),
								...(options.extraPlugins ?? []),
								...metricsPlugins(group.id, "dts", dts.format.includes("cjs")),
							],
						});
					}
				}),
			);

			// Pass 3 (prod-only, opt-in): per-module declarations for API Extractor's diagnostics run.
			// unbundle:true gives 1:1 source positions. Into the declarations/ sibling of pkg/ (never
			// published, kept for inspection). Deliberately NOT instrumented/timed — internal artifact,
			// not part of the build report. Mirrors the dts pass's deps posture; logLevel:silent keeps
			// this internal pass out of the unified build output.
			//
			// Best-effort: pkg/ (the published artifact) and the api-model (built from the bundled dts in
			// the meta pass's Run A) do NOT depend on this pass, so a failure must not abort the build —
			// it only costs accurate diagnostic locations for this group, and the meta pass's Run B then
			// fails soft on the missing/partial declarations. Record a warning when a collector is present.
			// Prod-only: `emitDeclarations` is a build-level option, but the declarations tree (and the
			// meta diagnostics run that reads it) only exists for prod targets. Gate on `js.isProd` so a
			// caller that sets the flag alongside a dev group cannot emit a dev `declarations/` tree.
			if (js.isProd && options.emitDeclarations === true && Object.keys(decl.entry).length > 0) {
				const partDeclDir = part.outSubdir !== undefined ? join(decl.outDir, part.outSubdir) : decl.outDir;
				yield* Effect.promise(async () => {
					try {
						await build({
							config: false,
							cwd: options.cwd,
							entry: decl.entry,
							outDir: partDeclDir,
							format: decl.format,
							platform: decl.platform,
							sourcemap: decl.sourcemap,
							unbundle: decl.unbundle,
							clean: isBase,
							fixedExtension: decl.fixedExtension,
							dts: decl.dts,
							define: decl.define,
							...timingChecks,
							logLevel: "silent",
							...(dtsNeverBundle.length > 0 || decl.bundledPackages || partBundle?.length
								? {
										deps: {
											...(dtsNeverBundle.length > 0 ? { neverBundle: dtsNeverBundle } : {}),
											// Mirrors the dts pass's deps posture (see there): forward the partition's
											// `bundle` so this pass's declarations stay consistent with the JS pass too.
											...(partBundle?.length ? { alwaysBundle: bundlePatterns(partBundle) } : {}),
											...(decl.bundledPackages
												? partBundleNodeModules
													? { dts: { alwaysBundle: decl.bundledPackages } }
													: { neverBundle: true as const, dts: { alwaysBundle: decl.bundledPackages } }
												: {}),
										},
									}
								: {}),
							// Forward the user's plugins for type-resolution parity with the JS and dts passes,
							// so the per-module declarations resolve the same types API Extractor reads.
							...(options.extraPlugins !== undefined ? { plugins: [...options.extraPlugins] } : {}),
						});
					} catch (err) {
						collector?.recordWarning(group.id, {
							source: "tsdown",
							level: "warn",
							text: `Could not emit per-module declarations for API Extractor diagnostics: ${String(err)}`,
						});
					}
				});
			}
		}

		// Loose files: one extra single-entry, bundled, no-dts, no-manifest pass each, into the
		// same pkg/ outDir. They are outside the exports graph (no manifest entry, no dts, no
		// meta). clean:false always — the base partition already owns/cleaned the outDir.
		const looseOutDir = outDirFor(options.cwd, group.id);
		const isProdGroup = group.id !== "dev";
		const looseDeps = {
			...(options.externals?.length ? { neverBundle: options.externals } : {}),
			// Widened as every other pass's are: a package bundled everywhere has left the manifest, so a loose file's
			// subpath import of it must inline too.
			...(options.bundle?.length ? { alwaysBundle: bundlePatterns(options.bundle) } : {}),
		};
		for (const lf of options.looseFiles ?? []) {
			const hasCjs = lf.format === "cjs";
			const looseLicenses = yield* thirdPartyLicenses({
				cwd: options.cwd,
				packageName: group.name,
				found: licensesFound,
			});
			yield* timed(
				group.id,
				"loose",
				tsdown({
					config: false,
					cwd: options.cwd,
					entry: { [lf.entryName]: lf.source },
					outDir: looseOutDir,
					format: [lf.format],
					platform: "node",
					sourcemap: !isProdGroup,
					minify: isProdGroup && (options.minify ?? false),
					// Bundle the whole module graph into the single literal output file.
					unbundle: false,
					clean: false,
					fixedExtension: lf.fixedExtension,
					dts: false,
					define: {
						"process.env.__PACKAGE_VERSION__": JSON.stringify(options.version),
						...options.define,
					},
					...timingChecks,
					...instrument(group.id),
					...(Object.keys(looseDeps).length > 0 ? { deps: looseDeps } : {}),
					...(hasCjs ? { cjsDefault: true } : {}),
					plugins: [
						stampPlugin,
						looseLicenses,
						...(hasCjs ? [nodeBuiltinDefaultInterop(), cjsDefaultInterop()] : []),
						...(options.extraPlugins ?? []),
						...metricsPlugins(group.id, "loose", hasCjs),
					],
				}),
			);
		}

		const groupOutDir = outDirFor(options.cwd, group.id);
		// The notice beside the group's manifest names every package any pass inlined. A pass emits the set it has seen
		// into its own outDir, so an outSubdir partition's packages would otherwise reach only its subdirectory's copy.
		if (licensesFound.size > 0) {
			yield* fs.makeDirectory(groupOutDir, { recursive: true });
			yield* fs.writeFileString(
				join(groupOutDir, THIRD_PARTY_LICENSES),
				renderThirdPartyLicenses(group.name, [...licensesFound.values()]),
			);
		}

		// Flatten public/ into the group's package root, after every pass (JS, dts, declarations,
		// looseFiles) has written its outputs. Additive with a byte-collision guard — see copyPublicDir.
		yield* copyPublicDir(publicDir, groupOutDir);

		// Copy ambient .d.ts exports into this group's pkg dir. The manifest already points at
		// "./<outName>" (transformExports) — this is what makes that path resolve on disk. Runs for
		// every group, every build path (dev/prod, front door AND self-hosting escape hatches).
		if (ambient.length > 0) yield* copyAmbientDts({ ambient, srcCwd: options.cwd, outDir: groupOutDir });
	}
});
