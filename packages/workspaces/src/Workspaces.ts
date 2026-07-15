// The composite layers.
//
// v3 split its two composites on PLATFORM REQUIREMENTS — `WorkspacesLive`
// (FileSystem + Path) versus `WorkspacesFullLive` (+ a subprocess runner) — and
// the review called that a great consumer story because the requirement set,
// not a feature flag, is the split axis. The axis survives: `layer` needs a
// filesystem, `layerWithGit` additionally needs core's `ChildProcessSpawner`
// (behind `@effected/git`'s `Git` service) to run git.

import { Git } from "@effected/git";
import type { CatalogResolver, WorkspaceResolver } from "@effected/npm";
import type { FileSystem, Path } from "effect";
import { Layer } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChangeDetector } from "./ChangeDetector.js";
import { LockfileReader } from "./LockfileReader.js";
import { PackageManagerDetector } from "./PackageManagerName.js";
import { PublishabilityDetector } from "./Publishability.js";
import { WorkspaceCatalogs } from "./WorkspaceCatalogs.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";
import { WorkspaceSnapshots } from "./WorkspaceSnapshots.js";

/**
 * Options shared by the composite layers.
 *
 * @public
 */
export interface WorkspacesOptions {
	/**
	 * The directory every root-consuming service resolves the workspace root
	 * from — one explicit concern, applied uniformly.
	 *
	 * @defaultValue `process.cwd()`, read lazily on first use.
	 */
	readonly cwd?: string;
	/** Descent cap for segment-crossing `packages:` patterns. Defaults to 32. */
	readonly maxDepth?: number;
}

/**
 * Every service the git-free composite layer provides.
 *
 * @public
 */
export type WorkspacesServices =
	| WorkspaceRoot
	| PackageManagerDetector
	| WorkspaceDiscovery
	| LockfileReader
	| WorkspaceCatalogs
	| PublishabilityDetector;

/**
 * Every service that needs only a filesystem: root, package-manager detection,
 * discovery, lockfile reading, catalogs and publishability.
 *
 * @remarks
 * Requires core `FileSystem` and `Path`, which the consumer provides at the
 * edge (`@effect/platform-node`, `@effect/platform-bun`, or a test's
 * `FileSystem.layerNoop`).
 *
 * **Bind the result to a `const`.** This is a parameterized factory and layers
 * memoize by reference, so calling it twice builds everything twice.
 *
 * @example
 * ```ts
 * import { Workspaces } from "@effected/workspaces";
 * import { Layer } from "effect";
 *
 * const WorkspacesLayer = Workspaces.layer();
 * const AppLayer = Layer.provide(WorkspacesLayer, PlatformLayer);
 * ```
 *
 * @public
 */
const layer = (
	options?: WorkspacesOptions,
): Layer.Layer<WorkspacesServices, never, FileSystem.FileSystem | Path.Path> => {
	const roots = WorkspaceRoot.layer;
	const detector = PackageManagerDetector.layer;
	const discovery = WorkspaceDiscovery.layer(options).pipe(Layer.provide(roots));
	const lockfiles = LockfileReader.layer(options).pipe(
		Layer.provide(roots),
		Layer.provide(detector),
		Layer.provide(discovery),
	);
	const catalogs = WorkspaceCatalogs.layer(options).pipe(Layer.provide(roots), Layer.provide(lockfiles));

	return Layer.mergeAll(roots, detector, discovery, lockfiles, catalogs, PublishabilityDetector.layer);
};

/**
 * The git-free composite plus {@link ChangeDetector} and
 * {@link WorkspaceSnapshots}, over `@effected/git`'s `Git` service.
 *
 * @remarks
 * The extra requirement is core's `ChildProcessSpawner` (behind `Git`), which
 * is why it is a separate layer rather than a flag: a consumer that never
 * detects changes or reads at a ref should not have to be able to spawn a
 * subprocess. The consumer provides `ChildProcessSpawner` once at the edge
 * (`@effect/platform-node`'s `NodeServices.layer`); a test provides
 * `Layer.succeed(Git, …)` and needs no repository on disk.
 *
 * @public
 */
const layerWithGit = (
	options?: WorkspacesOptions,
): Layer.Layer<
	WorkspacesServices | ChangeDetector | WorkspaceSnapshots | Git,
	never,
	FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> => {
	const core = layer(options);
	const git = Git.layer;
	return Layer.mergeAll(
		core,
		git,
		ChangeDetector.layer.pipe(Layer.provide(git), Layer.provide(core)),
		WorkspaceSnapshots.layer(options).pipe(Layer.provide(git), Layer.provide(core)),
	);
};

/**
 * The two `@effected/npm` resolver contracts, implemented for real.
 *
 * @remarks
 * Provide this alongside `@effected/package-json`'s `Package.resolve` and a
 * manifest's `catalog:` and `workspace:` specifiers resolve against the actual
 * workspace instead of the no-op layers' `Option.none()`.
 *
 * @example
 * ```ts
 * import { Package } from "@effected/package-json";
 * import { Workspaces } from "@effected/workspaces";
 * import { Layer } from "effect";
 *
 * const WorkspacesLayer = Workspaces.layer();
 * const Resolvers = Workspaces.resolvers.pipe(Layer.provide(WorkspacesLayer));
 * ```
 *
 * @public
 */
const resolvers: Layer.Layer<CatalogResolver | WorkspaceResolver, never, WorkspaceCatalogs | WorkspaceDiscovery> =
	Layer.mergeAll(WorkspaceCatalogs.catalogResolver, WorkspaceDiscovery.workspaceResolver);

/**
 * The composite layers.
 *
 * @public
 */
export const Workspaces = { layer, layerWithGit, resolvers } as const;
