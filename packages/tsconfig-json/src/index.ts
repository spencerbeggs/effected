/**
 * Composable tsconfig.json handling for Effect: schemas, extends-chain
 * resolution, and config discovery.
 *
 * @packageDocumentation
 */

export {
	CompilerOptions,
	Jsx,
	Lib,
	Module,
	ModuleDetection,
	ModuleResolution,
	NewLine,
	Target,
} from "./CompilerOptions.js";
export { JsxConfig } from "./JsxConfig.js";
export { PortableTsconfig } from "./PortableTsconfig.js";
export { ResolvedTsconfig } from "./ResolvedTsconfig.js";
export type { FindNearestOptions } from "./TsconfigDiscovery.js";
export { TsconfigDiscovery } from "./TsconfigDiscovery.js";
export {
	FallbackPolling,
	Reference,
	TsconfigJson,
	TsconfigJsonFromString,
	TsconfigParseError,
	TypeAcquisition,
	WatchDirectory,
	WatchFile,
	WatchOptions,
} from "./TsconfigJson.js";
export { TsconfigExtendsError, TsconfigLoader } from "./TsconfigLoader.js";
export type { SyncFileSystem, SyncPath, TsconfigLoaderSyncOptions } from "./TsconfigLoaderSync.js";
export { TsconfigLoaderSync } from "./TsconfigLoaderSync.js";
export type {
	EnumFamily,
	ProgrammaticCompilerOptions,
	ProgrammaticCompilerOptionsValue,
} from "./TsEnumCodec.js";
export { TsEnumCodec } from "./TsEnumCodec.js";
