export type { ManifestLike } from "./catalog/resolve-catalogs.js";
export { resolveManifest } from "./catalog/resolve-catalogs.js";
export {
	BuildFormat,
	BuildPlatform,
	EffectedConfig,
	EntryOverride,
	ExeConfig,
	ExeSeaConfig,
	ExeTargetConfig,
	JsxConfig,
	LooseFileSpec,
	ManifestConfig,
	MetaConfig,
	PackageBuildConfig,
	PackageConfig,
	TsdocConfig,
	TsdocTagDefinition,
	TsdoctorConfig,
	TsdoctorOpenGraphConfig,
	TsdoctorOpenGraphImage,
	TsdoctorRegistryRef,
	WarningSuppressionRule,
} from "./config/BuildConfig.js";
export {
	EffectedConfigError,
	EffectedConfigFile,
	ResolvedConfig,
	ResolvedEffectedConfig,
} from "./config/EffectedConfigFile.js";
export { merge } from "./config/merge.js";
export { PluginLoadError, loadPlugins } from "./config/plugins.js";
export type { AmbientDtsEntry, DtsExportClass, ExtractAmbientOptions } from "./entries/ambient-dts.js";
export {
	ambientOutName,
	assertNoEntryCollisions,
	classifyDtsExport,
	declarationExt,
	extractAmbientDts,
	mixedDtsExportError,
} from "./entries/ambient-dts.js";
export type { ExtractOptions, ExtractResult, PackageJsonLike } from "./entries/extract.js";
export { createEntryName, extractEntries } from "./entries/extract.js";
export type { PackageJsonEntriesOptions } from "./entries/package-json-entries.js";
export { packageJsonEntries } from "./entries/package-json-entries.js";
export { ConfigValidationError } from "./errors.js";
export type { BuildEmittedManifestOptions, EmitManifestOptions, TargetGroupRef } from "./manifest/emit-manifest.js";
export { buildEmittedManifest, emitManifest, manifestNeedsCatalogResolution } from "./manifest/emit-manifest.js";
export type { DualExports, ExeRewrite, Json, TransformManifestOptions } from "./manifest/transform.js";
export {
	defaultManifestTransform,
	normalizeBinPaths,
	transformBin,
	transformExports,
	transformManifest,
} from "./manifest/transform.js";
export { renderCiAnnotations } from "./report/ci-annotations.js";
export type { DiagnosticInput, PassKind } from "./report/collector.js";
export { BuildCollector, BuildCollectorTag } from "./report/collector.js";
export type { BuildIssues, PlainDiagnostic } from "./report/issues-artifact.js";
export { flattenIssues, serializeIssues, writeIssuesArtifact } from "./report/issues-artifact.js";
export { buildMetricsPlugin } from "./report/metrics-plugin.js";
export {
	BuildReport,
	DiagnosticEntry,
	EmittedFile,
	PassReport,
	ReportTimings,
	TargetGroupReport,
} from "./report/schema.js";
export type { Timer } from "./report/timer.js";
export { createTimer, formatTime } from "./report/timer.js";
export type { TsdownLogger } from "./report/tsdown-logger.js";
export { createTsdownLogger } from "./report/tsdown-logger.js";
export { writeTargetsBinding } from "./targets/binding.js";
export type {
	PublishTargetObject,
	PublishTargetValue,
	PublishTargets,
	ReleaseChannel,
	ResolvedGroup,
	ResolvedTarget,
	TargetResolution,
} from "./targets/config.js";
export { RELEASE_CHANNELS, isTargetObject } from "./targets/config.js";
export { releaseWarnings, resolveTargets } from "./targets/resolve-targets.js";
