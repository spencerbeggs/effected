import type { FileSystem } from "effect";
import { Cause, Effect, Path } from "effect";
import { resolveNextVersions as realResolveNextVersions } from "../changesets/next-versions.js";
import { deriveExportPaths } from "../entries/export-paths.js";
import { createEntryName } from "../entries/extract.js";
import { BundleManifestEmitError } from "../errors.js";
import { declarationsDirFor } from "../passes/target-groups.js";
import type { BuildCollector } from "../report/collector.js";
import type { BundleManifestSources } from "./bundle-source.js";
import {
	BundleManifestSourceError,
	loadBundleManifestSources as realLoadBundleManifestSources,
} from "./bundle-source.js";
import type { MetaOptions } from "./config.js";
import { normalizeMetaOptions } from "./config.js";
import type { GenerateMetaOptions, MetaResult } from "./generate.js";
import { generateMeta as realGenerateMeta } from "./generate.js";
import { OgGenerateError } from "./og-image.js";
import { rewriteMetaVersions } from "./optimistic.js";

/**
 * Options for the meta-pass orchestrator.
 *
 * @public
 */
export interface RunMetaPassOptions {
	readonly cwd: string;
	readonly packageName: string;
	readonly tsconfigPath: string;
	readonly groups: ReadonlyArray<{ id: string; name: string }>;
	readonly entries: Record<string, string>;
	readonly exportsMap: Record<string, string> | undefined;
	readonly overrides?: ReadonlyArray<{ entries: ReadonlyArray<string>; outSubdir?: string | undefined }> | undefined;
	readonly meta: MetaOptions;
	readonly collector: BuildCollector;
	readonly ci: boolean;
	/** Injectable for tests; defaults to the real generateMeta. */
	readonly generateMeta?: (o: GenerateMetaOptions) => Promise<MetaResult>;
	/** Injectable for tests; defaults to the real resolveNextVersions. Only called when optimistic. */
	readonly resolveNextVersions?: (cwd: string) => Promise<{ versions: ReadonlyMap<string, string> }>;
	/**
	 * The resolved `targets.json` targets; each group's `bundle.json` derives its registries from the
	 * targets bound to that group. Omitted (an escape-hatch build with no resolution) means none.
	 */
	readonly targets?: ReadonlyArray<{ group: string; id: string; registry: string }> | undefined;
	/** Injectable for tests; defaults to the real loadBundleManifestSources. */
	readonly loadBundleManifestSources?: (cwd: string) => Promise<BundleManifestSources>;
}

/**
 * Meta-pass orchestrator: derives export paths, filters bin/ entries, resolves optimistic
 * next-versions, and calls generateMeta once per publish group.
 *
 * The injected `generateMeta`, `resolveNextVersions` and `loadBundleManifestSources` stay promise-returning, and a
 * rejection of one is a failure carrying the rejected value; the real ones are effects over `FileSystem` and `Path`.
 * @public
 */
export const runMetaPass: (o: RunMetaPassOptions) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =
	Effect.fnUntraced(function* (o: RunMetaPassOptions) {
		const { join } = yield* Path.Path;
		// Each injectable is either the real effect or a test's promise; a rejection fails with the rejected value.
		const fromPromise = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
			Effect.tryPromise({ try: run, catch: (e) => e });
		const gen = (
			options: GenerateMetaOptions,
		): Effect.Effect<MetaResult, unknown, FileSystem.FileSystem | Path.Path> =>
			o.generateMeta !== undefined
				? fromPromise(() => o.generateMeta?.(options) as Promise<MetaResult>)
				: realGenerateMeta(options);
		const norm = normalizeMetaOptions(o.meta);
		const canonical = o.groups.find((g) => g.name === o.packageName) ?? o.groups[0];
		const canonicalId = canonical?.id ?? "npm";
		const dtsBasenames: Record<string, string> = {};
		const nonBinEntries: Record<string, string> = {};
		for (const [name, src] of Object.entries(o.entries)) {
			if (!name.startsWith("bin/")) {
				dtsBasenames[name] = name;
				nonBinEntries[name] = src;
			}
		}
		const exportPaths = deriveExportPaths(nonBinEntries, o.exportsMap);
		applySubdirMetaEntries(o.overrides, dtsBasenames, exportPaths);

		const resolveNext = o.resolveNextVersions;
		const nextVersions = norm.optimistic
			? resolveNext !== undefined
				? yield* fromPromise(() => resolveNext(o.cwd))
				: yield* realResolveNextVersions(o.cwd)
			: undefined;
		const manifestTransform = nextVersions
			? (m: Record<string, unknown>) => rewriteMetaVersions(m, nextVersions.versions, o.packageName)
			: undefined;

		// The bundle.json source tiers are per package, not per group: load them once. A present but
		// invalid file fails the build here, before any group's meta bundle is written.
		const loadSources = o.loadBundleManifestSources;
		const load: Effect.Effect<BundleManifestSources, unknown, FileSystem.FileSystem | Path.Path> =
			loadSources !== undefined ? fromPromise(() => loadSources(o.cwd)) : realLoadBundleManifestSources(o.cwd);
		const sources = yield* load.pipe(
			Effect.tapCause((cause) =>
				Effect.sync(() => {
					const err = Cause.squash(cause);
					if (!(err instanceof BundleManifestSourceError)) return;
					for (const g of o.groups) {
						o.collector.recordError(g.id, {
							source: "meta",
							level: "error",
							code: "bundle-manifest-source-invalid",
							text: err.message,
							file: err.path,
						});
					}
				}),
			),
		);

		if (sources.discoveryFailure !== undefined) {
			for (const g of o.groups) {
				o.collector.recordWarning(g.id, {
					source: "meta",
					level: "warn",
					code: "bundle-manifest-workspace-discovery-failed",
					text: `Workspace discovery failed, so bundle.json has no project tier: ${sources.discoveryFailure}`,
				});
			}
		}

		for (const path of sources.retiredSources ?? []) {
			for (const g of o.groups) {
				o.collector.recordWarning(g.id, {
					source: "meta",
					level: "warn",
					code: "bundle-manifest-retired-source",
					text: `${path} is no longer read; rename it to bundle.json`,
					file: path,
				});
			}
		}

		for (const g of o.groups) {
			// The target's `id` (the publishConfig.targets key, e.g. "npm"/"github") is the human registry label;
			// its `name` is the resolved package name for that group, which the manifest already knows.
			const targets = (o.targets ?? [])
				.filter((t) => t.group === g.id)
				.map((t) => ({ name: t.id, registry: t.registry }));
			yield* gen({
				cwd: o.cwd,
				packageName: o.packageName,
				tsconfigPath: o.tsconfigPath,
				dtsDir: join(o.cwd, "dist", "prod", g.id, "pkg"),
				aeInputDir: declarationsDirFor(o.cwd, g.id),
				entries: dtsBasenames,
				exportPaths,
				outMetaDir: join(o.cwd, "dist", "prod", g.id, "meta"),
				localPaths: g.id === canonicalId ? norm.localPaths : [],
				tsdoc: norm.tsdoc,
				...(manifestTransform !== undefined ? { manifestTransform } : {}),
				ci: o.ci,
				bundle: { config: norm.bundle, leaf: sources.leaf, project: sources.project, targets },
				onMessage: (e) => (e.level === "error" ? o.collector.recordError(g.id, e) : o.collector.recordWarning(g.id, e)),
				onSuppressed: (e) => o.collector.recordSuppressed(g.id, e),
			} satisfies GenerateMetaOptions).pipe(
				// Route the sidecar failures into issues.json so the build report names the cause, then fail.
				Effect.tapCause((cause) =>
					Effect.sync(() => {
						const err = Cause.squash(cause);
						if (err instanceof OgGenerateError) {
							o.collector.recordError(g.id, {
								source: "meta",
								level: "error",
								code: "og-generate-failed",
								text: err.message,
							});
						} else if (err instanceof BundleManifestEmitError) {
							o.collector.recordError(g.id, {
								source: "meta",
								level: "error",
								code: "bundle-manifest-emit-failed",
								text: err.message,
								file: err.path,
							});
						}
					}),
				),
			);
		}
	});

/**
 * For each `outSubdir` override, point its meta entry at the isolated sub-package barrel.
 *
 * @public
 */
export function applySubdirMetaEntries(
	overrides: ReadonlyArray<{ entries: ReadonlyArray<string>; outSubdir?: string | undefined }> | undefined,
	dtsBasenames: Record<string, string>,
	exportPaths: Record<string, string>,
): void {
	if (overrides === undefined) return;
	for (const ov of overrides) {
		if (ov.outSubdir === undefined) continue;
		const exportPath = ov.entries[0];
		if (exportPath === undefined) continue;
		const flatName = createEntryName(exportPath, false);
		dtsBasenames[flatName] = `${ov.outSubdir}/index`;
		exportPaths[flatName] = exportPath;
	}
}
