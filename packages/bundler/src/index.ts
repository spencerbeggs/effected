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
export { EffectedConfigError, EffectedConfigFile, ResolvedEffectedConfig } from "./config/EffectedConfigFile.js";
export { merge } from "./config/merge.js";
export { PluginLoadError, loadPlugins } from "./config/plugins.js";
