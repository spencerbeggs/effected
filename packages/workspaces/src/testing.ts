/**
 * Repo-shape checks for a monorepo's own test suite: `SourceBoundary` keeps
 * `process`, `node:` imports and console writes out of modules meant to be
 * free of them, `WorkspaceLayering` holds the package graph to a committed
 * `LayerPolicy`, and `PackedInstall` proves a carrier's bins install from its
 * packed tarballs under every available package manager.
 *
 * @remarks
 * A separate subpath, never re-exported from `.`, so the main entry's
 * consumers never load a scanner, a policy decoder or package-manager
 * orchestration they do not use (the second-published-entrypoint decision).
 *
 * @packageDocumentation
 */

// This module is an ENTRY POINT: api-extractor models it as its own surface,
// so every kit type its signatures name is re-exported here. That includes
// the discovery closure WorkspaceLayering's signatures reach (edgesOf's
// parameter, checkWorkspace's requirement and error channel): the
// WorkspaceDiscovery service's shape, options and failures, the WorkspaceRoot
// service its layer requires, and WorkspacePackage's field and method types
// (the second-published-entrypoint decision).
export { LayerPolicy, LayerPolicyError } from "./LayerPolicy.js";
export { PackageManagerName } from "./PackageManagerName.js";
export {
	type BinCommandOptions,
	type BinProvenance,
	InstalledConsumer,
	type PackSource,
	PackedInstall,
	type PackedInstallBudget,
	type PackedInstallClosureOptions,
	PackedInstallError,
	type PackedInstallOptions,
	PackedInstallResult,
	type RunBinOptions,
} from "./PackedInstall.js";
export {
	type BoundaryFixture,
	type BoundaryRule,
	Offence,
	type OffenceRule,
	type ReferenceOptions,
	type ScanOptions,
	SourceBoundary,
	SourceScan,
} from "./SourceBoundary.js";
export {
	PackageNotFoundError,
	WorkspaceDiscovery,
	WorkspaceDiscoveryError,
	type WorkspaceDiscoveryFailure,
	type WorkspaceDiscoveryOptions,
	type WorkspaceDiscoveryShape,
	WorkspaceInfo,
	type WorkspaceLookupFailure,
	WorkspacePatternError,
} from "./WorkspaceDiscovery.js";
export { LayerEdge, type LayeringGraph, LayeringReport, WorkspaceLayering } from "./WorkspaceLayering.js";
export { type DependencyDiff, PublishConfig, WorkspaceManifestError, WorkspacePackage } from "./WorkspacePackage.js";
export {
	type FindWorkspaceRootOptions,
	WorkspaceRoot,
	WorkspaceRootNotFoundError,
	type WorkspaceRootShape,
} from "./WorkspaceRoot.js";
