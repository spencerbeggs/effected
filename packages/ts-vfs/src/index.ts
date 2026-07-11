export {
	FetchError,
	PackageFetcher,
	type PackageFetcherShape,
	PackageManifest,
	PackageNotFoundError,
	type PackageVersions,
	VersionNotFoundError,
} from "./PackageFetcher.js";
export { PackageSpec } from "./PackageSpec.js";
export { RegistryEvent, RegistryObserver, type RegistryObserverShape } from "./RegistryEvent.js";
export { TsEnvironment, TsEnvironmentError, type TsEnvironmentOptions } from "./TsEnvironment.js";
export {
	type CachePruneResult,
	TypeCache,
	TypeCacheError,
	TypeCacheMetadata,
	type TypeCacheShape,
} from "./TypeCache.js";
export {
	BatchLoadError,
	type PackageVfsOptions,
	TypeRegistry,
	type TypeRegistryShape,
} from "./TypeRegistry.js";
export { ResolvedModule, TypeResolver } from "./TypeResolver.js";
export { type Vfs, type VirtualFileSystem, mergeVfs, prefixVfs } from "./Vfs.js";
export { VirtualPackage } from "./VirtualPackage.js";
