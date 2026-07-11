/**
 * Monorepo workspace tooling as Effect services: find the workspace root,
 * enumerate its packages, walk the dependency graph, detect the package
 * manager, resolve pnpm catalogs, read the lockfile, and work out which
 * packages a git range touches.
 *
 * The pure halves live in siblings — `@effected/lockfiles` parses lockfile
 * text, `@effected/glob` matches patterns, `@effected/walker` ascends
 * directories. This package is the part that needs a filesystem and a package
 * manager under it, and it is where `@effected/npm`'s `CatalogResolver` and
 * `WorkspaceResolver` contracts are finally implemented.
 *
 * @example
 * ```ts
 * import { WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const WorkspacesLayer = Workspaces.layer();
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   const packages = yield* discovery.listPackages();
 *   return packages.map((pkg) => pkg.name);
 * });
 * ```
 *
 * @packageDocumentation
 */

export {
	ChangeDetectionError,
	type ChangeDetectionFailure,
	ChangeDetectionOptions,
	ChangeDetector,
	type ChangeDetectorShape,
} from "./ChangeDetector.js";
export { CyclicDependencyError, DependencyGraph } from "./DependencyGraph.js";
export { GitCommandError, GitReader } from "./GitReader.js";
export {
	LockfileReadError,
	type LockfileReadFailure,
	LockfileReader,
	type LockfileReaderOptions,
	type LockfileReaderShape,
} from "./LockfileReader.js";
export {
	DetectedPackageManager,
	PackageManagerDetectionError,
	PackageManagerDetector,
	PackageManagerName,
} from "./PackageManagerName.js";
export { PublishTarget, PublishabilityDetector } from "./Publishability.js";
export {
	CatalogAssemblyError,
	type CatalogAssemblyFailure,
	CatalogSet,
	WorkspaceCatalogs,
	type WorkspaceCatalogsOptions,
	type WorkspaceCatalogsShape,
} from "./WorkspaceCatalogs.js";
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
export { type DependencyDiff, PublishConfig, WorkspaceManifestError, WorkspacePackage } from "./WorkspacePackage.js";
export { WORKSPACE_MARKERS, WorkspaceRoot, WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
export { Workspaces, type WorkspacesOptions, type WorkspacesServices } from "./Workspaces.js";
export { findWorkspaceRootSync, getWorkspacePackagesSync } from "./WorkspacesSync.js";
