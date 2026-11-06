import { join } from "node:path";
import { resolveNextVersions as realResolveNextVersions } from "../changesets/next-versions.js";
import { deriveExportPaths } from "../entries/export-paths.js";
import { createEntryName } from "../entries/extract.js";
import { TsdoctorEmitError } from "../errors.js";
import { declarationsDirFor } from "../passes/target-groups.js";
import type { BuildCollector } from "../report/collector.js";
import type { MetaOptions } from "./config.js";
import { normalizeMetaOptions } from "./config.js";
import type { GenerateMetaOptions, MetaResult } from "./generate.js";
import { generateMeta as realGenerateMeta } from "./generate.js";
import { OgGenerateError } from "./og-image.js";
import { rewriteMetaVersions } from "./optimistic.js";
import type { TsdoctorSources } from "./tsdoctor-source.js";
import { TsdoctorSourceError, loadTsdoctorSources as realLoadTsdoctorSources } from "./tsdoctor-source.js";

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
	 * The resolved `targets.json` targets; each group's `tsdoctor.json` derives its registries from the
	 * targets bound to that group. Omitted (an escape-hatch build with no resolution) means none.
	 */
	readonly targets?: ReadonlyArray<{ group: string; id: string; registry: string }> | undefined;
	/** Injectable for tests; defaults to the real loadTsdoctorSources. */
	readonly loadTsdoctorSources?: (cwd: string) => Promise<TsdoctorSources>;
}

/**
 * Meta-pass orchestrator: derives export paths, filters bin/ entries, resolves optimistic
 * next-versions, and calls generateMeta once per publish group.
 * @public
 */
export async function runMetaPass(o: RunMetaPassOptions): Promise<void> {
	const gen = o.generateMeta ?? realGenerateMeta;
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

	const resolveNext = o.resolveNextVersions ?? realResolveNextVersions;
	const nextVersions = norm.optimistic ? await resolveNext(o.cwd) : undefined;
	const manifestTransform = nextVersions
		? (m: Record<string, unknown>) => rewriteMetaVersions(m, nextVersions.versions, o.packageName)
		: undefined;

	// The tsdoctor.json source tiers are per package, not per group: load them once. A present but
	// invalid file fails the build here, before any group's meta bundle is written.
	const loadSources = o.loadTsdoctorSources ?? realLoadTsdoctorSources;
	let sources: TsdoctorSources;
	try {
		sources = await loadSources(o.cwd);
	} catch (err) {
		if (err instanceof TsdoctorSourceError) {
			for (const g of o.groups) {
				o.collector.recordError(g.id, {
					source: "meta",
					level: "error",
					code: "tsdoctor-source-invalid",
					text: err.message,
					file: err.path,
				});
			}
		}
		throw err;
	}

	if (sources.discoveryFailure !== undefined) {
		for (const g of o.groups) {
			o.collector.recordWarning(g.id, {
				source: "meta",
				level: "warn",
				code: "tsdoctor-workspace-discovery-failed",
				text: `Workspace discovery failed, so tsdoctor.json has no project tier: ${sources.discoveryFailure}`,
			});
		}
	}

	for (const g of o.groups) {
		// The target's `id` (the publishConfig.targets key, e.g. "npm"/"github") is the human registry label;
		// its `name` is the resolved package name for that group, which the manifest already knows.
		const targets = (o.targets ?? [])
			.filter((t) => t.group === g.id)
			.map((t) => ({ name: t.id, registry: t.registry }));
		try {
			await gen({
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
				tsdoctor: { config: norm.tsdoctor, leaf: sources.leaf, project: sources.project, targets },
				onMessage: (e) => (e.level === "error" ? o.collector.recordError(g.id, e) : o.collector.recordWarning(g.id, e)),
				onSuppressed: (e) => o.collector.recordSuppressed(g.id, e),
			} satisfies GenerateMetaOptions);
		} catch (err) {
			// Route the sidecar failures into issues.json so the build report names the cause, then fail.
			if (err instanceof OgGenerateError) {
				o.collector.recordError(g.id, {
					source: "meta",
					level: "error",
					code: "og-generate-failed",
					text: err.message,
				});
			} else if (err instanceof TsdoctorEmitError) {
				o.collector.recordError(g.id, {
					source: "meta",
					level: "error",
					code: "tsdoctor-emit-failed",
					text: err.message,
					file: err.path,
				});
			}
			throw err;
		}
	}
}

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
