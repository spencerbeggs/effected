export type {
	BundlerBuildOptions,
	BundlerPackageJson,
	BundlerSeams,
} from "./Bundler.js";
export { Bundler, BundlerBuildResult } from "./Bundler.js";
export { BundlerError, BundlerPhase } from "./BundlerError.js";
export type { ManifestLike } from "./catalog/resolve-catalogs.js";
export { resolveManifest } from "./catalog/resolve-catalogs.js";
export type { NextVersions } from "./changesets/next-versions.js";
export { resolveNextVersions } from "./changesets/next-versions.js";
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
export type { ValidationInput } from "./config-validation/ConfigValidator.js";
export { ConfigValidator } from "./config-validation/ConfigValidator.js";
export type { ModuleExportNames, ReexportBarrelAnalysis } from "./dts/reexport-stub.js";
export { analyzeReexportBarrel, collectExportNames, renderReexportStub } from "./dts/reexport-stub.js";
export { findRelativeSpecifiers } from "./dts/relative-imports.js";
export type { ResolvedTsconfig, ResolvedTsconfigOptions } from "./dts/resolved-tsconfig.js";
export { buildResolvedTsconfig, writeDtsEmitTsconfig, writeResolvedTsconfig } from "./dts/resolved-tsconfig.js";
export type { AmbientDtsEntry, DtsExportClass, ExtractAmbientOptions } from "./entries/ambient-dts.js";
export {
	ambientOutName,
	assertNoEntryCollisions,
	classifyDtsExport,
	declarationExt,
	extractAmbientDts,
	mixedDtsExportError,
} from "./entries/ambient-dts.js";
export { deriveExportPaths } from "./entries/export-paths.js";
export type { ExtractOptions, ExtractResult, PackageJsonLike } from "./entries/extract.js";
export { createEntryName, extractEntries } from "./entries/extract.js";
export type { PackageJsonEntriesOptions } from "./entries/package-json-entries.js";
export { packageJsonEntries } from "./entries/package-json-entries.js";
export { ConfigValidationError, MetaGenerationError, TsdoctorEmitError } from "./errors.js";
export type { ExeBuild, RunExeBuildOptions } from "./exe/build.js";
export { runExeBuild } from "./exe/build.js";
export type {
	ExeConfig as ExeOptions,
	ExeSeaConfig as ExeSeaOptions,
	ExeTarget,
	ExeTargetInput,
	NormalizedExe,
	PkgOsCpu,
} from "./exe/config.js";
export { DEFAULT_EXE_NODE_VERSION, normalizeExeOptions } from "./exe/config.js";
export { computeExeFileName } from "./exe/filename.js";
export type { JsxConfig as ResolvedJsxConfig, TsconfigJsx } from "./jsx/config.js";
export { readTsconfigJsx, resolveJsxConfig } from "./jsx/config.js";
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
export type { KnownRegistryType } from "./meta/BundleManifest.js";
export {
	BundleManifest,
	BundleManifestError,
	KNOWN_REGISTRY_TYPES,
	MANIFEST_SPEC,
	OpenGraphConfig,
	OpenGraphImage,
	ProjectIdentity,
	RegistryRef,
	SbomRef,
	TSDOCTOR_MANIFEST_FILENAME,
	decodeBundleManifest,
	encodeBundleManifest,
	isKnownRegistryType,
} from "./meta/BundleManifest.js";
export type {
	MetaOptions,
	NormalizedMeta,
	TsdocOptions,
	TsdocTagDefinition as MetaTsdocTagDefinition,
	WarningSuppressionRule as MetaWarningSuppressionRule,
} from "./meta/config.js";
export { normalizeMetaOptions } from "./meta/config.js";
export type { GenerateMetaOptions, MetaResult } from "./meta/generate.js";
export { ManifestSource, decodeManifestSource } from "./meta/ManifestSource.js";
export type { OgImageCacheOptions, WriteGeneratedOgImageOptions } from "./meta/og-image.js";
export { OgGenerateError, resolveOgCacheSalt, resolveOgGenerator, writeGeneratedOgImage } from "./meta/og-image.js";
export { rewriteMetaVersions } from "./meta/optimistic.js";
export type { RunMetaPassOptions } from "./meta/run-pass.js";
export type { PortableTsconfig, ResolvedCompilerOptions } from "./meta/tsconfig-resolver.js";
export { resolvePortableTsconfig } from "./meta/tsconfig-resolver.js";
export type { OgImageGenerator, OgImageInfo, TsdoctorMetaOptions } from "./meta/tsdoctor-config.js";
export type { ComposeManifestInput, ManifestRepository, ManifestTarget } from "./meta/tsdoctor-manifest.js";
export {
	composeTsdoctorManifest,
	githubOwnerRepo,
	ogImageInfoOf,
	registriesFromTargets,
} from "./meta/tsdoctor-manifest.js";
export type { TsdoctorSources } from "./meta/tsdoctor-source.js";
export { TsdoctorSourceError, loadTsdoctorSources } from "./meta/tsdoctor-source.js";
export type {
	BuildTargetGroupsOptions,
	CssOptions,
	EntryOverride as EntryOverrideOptions,
	TsdownBuild,
} from "./passes/build-target-groups.js";
export { buildTargetGroups } from "./passes/build-target-groups.js";
export { cjsDefaultInterop } from "./passes/cjs-default-interop.js";
export type { LooseFileSpec as LooseFileOptions, LooseFiles, NormalizedLooseFile } from "./passes/loose-files.js";
export { normalizeLooseFiles } from "./passes/loose-files.js";
export { nodeBuiltinDefaultInterop } from "./passes/node-builtin-default-interop.js";
export { removeDeclarationMaps } from "./passes/strip-maps.js";
export type { CopyAmbientDtsOptions } from "./passes/sync-public.js";
export { copyAmbientDts, copyPublicDir } from "./passes/sync-public.js";
export type {
	BuildFormat as BuildFormatOption,
	BuildGroupSpec,
	BuildPlatform as BuildPlatformOption,
	DeriveOptions,
	DerivedDeclarationsPassOptions,
	DerivedDtsPassOptions,
	DerivedTsdownOptions,
	DtsPassDtsOptions,
	TargetGroupId,
} from "./passes/target-groups.js";
export {
	declarationsDirFor,
	deriveDeclarationsPassOptions,
	deriveDtsPassOptions,
	deriveTargetGroupOptions,
	dtsPassDtsOptions,
	outDirFor,
} from "./passes/target-groups.js";
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
