// The composite layers.
//
// v3 split its two composites on PLATFORM REQUIREMENTS — `WorkspacesLive`
// (FileSystem + Path) versus `WorkspacesFullLive` (+ a subprocess runner) — and
// the review called that a great consumer story because the requirement set,
// not a feature flag, is the split axis. The axis survives: `layer` needs a
// filesystem, `layerWithGit` additionally needs core's `ChildProcessSpawner`
// (behind `@effected/git`'s `Git` service) to run git.

import { Git } from "@effected/git";
import type {
	CatalogAssemblyError,
	CatalogResolver,
	DependencyResolutionError,
	Manifest,
	UnresolvedDependencyError,
	WorkspaceResolver,
} from "@effected/npm";
import type { FileSystem, Path } from "effect";
import { Effect, Layer } from "effect";
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
const compose = (
	options: WorkspacesOptions | undefined,
	catalogsFactory: (
		options?: WorkspacesOptions,
	) => Layer.Layer<WorkspaceCatalogs, never, WorkspaceRoot | LockfileReader | FileSystem.FileSystem | Path.Path>,
): Layer.Layer<WorkspacesServices, never, FileSystem.FileSystem | Path.Path> => {
	const roots = WorkspaceRoot.layer;
	const detector = PackageManagerDetector.layer;
	const discovery = WorkspaceDiscovery.layer(options).pipe(Layer.provide(roots));
	const lockfiles = LockfileReader.layer(options).pipe(
		Layer.provide(roots),
		Layer.provide(detector),
		Layer.provide(discovery),
	);
	const catalogs = catalogsFactory(options).pipe(Layer.provide(roots), Layer.provide(lockfiles));

	return Layer.mergeAll(roots, detector, discovery, lockfiles, catalogs, PublishabilityDetector.layer);
};

const layer = (
	options?: WorkspacesOptions,
): Layer.Layer<WorkspacesServices, never, FileSystem.FileSystem | Path.Path> =>
	compose(options, WorkspaceCatalogs.layer);

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
 * The git-free composite, but with catalog assembly that **replays config
 * dependency `pnpmfile.cjs` hooks** — {@link WorkspaceCatalogs.layerWithConfigDependencies}
 * in place of the default no-op catalogs layer.
 *
 * @remarks
 * Identical requirement set to {@link Workspaces.layer}; the only difference is
 * that config-dependency code is executed in process. Opt in deliberately — the
 * default {@link Workspaces.layer} never executes config-dependency code.
 *
 * **Bind the result to a `const`.**
 *
 * @public
 */
const layerWithConfigDependencies = (
	options?: WorkspacesOptions,
): Layer.Layer<WorkspacesServices, never, FileSystem.FileSystem | Path.Path> =>
	compose(options, WorkspaceCatalogs.layerWithConfigDependencies);

/**
 * The one-call resolver factory: {@link Workspaces.resolvers} pre-wired over
 * {@link Workspaces.layerWithConfigDependencies}, so the two `@effected/npm`
 * contracts (`CatalogResolver`, `WorkspaceResolver`) need only a platform
 * (`FileSystem` + `Path`) from the consumer.
 *
 * @remarks
 * This is deliberately a **parameterized layer function, and the fresh layer
 * per call is the feature**: layers memoize by reference, so each call mints
 * an unmemoized layer whose root discovery re-runs — including a per-call
 * `process.cwd()` read when `options.cwd` is omitted. A build tool that
 * changes directory between manifests gets a correct re-discovery each time
 * precisely because nothing is shared across calls. When you *want* sharing,
 * bind one call's result to a `const` and provide that; the memoization rule
 * is unchanged, this factory just refuses to hide it.
 *
 * Catalog assembly replays config-dependency `pnpmfile` hooks (the
 * `layerWithConfigDependencies` path) — the semantics a real pnpm install
 * has. Compose {@link Workspaces.resolvers} with {@link Workspaces.layer}
 * yourself if config-dependency code must not run in process.
 *
 * @example
 * ```ts
 * import { Workspaces } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = doSomethingWithResolvers.pipe(
 *   Effect.provide(Workspaces.resolverLayer()),
 * );
 * ```
 *
 * @public
 */
const resolverLayer = (
	options?: WorkspacesOptions,
): Layer.Layer<CatalogResolver | WorkspaceResolver, never, FileSystem.FileSystem | Path.Path> =>
	resolvers.pipe(Layer.provide(layerWithConfigDependencies(options)));

/**
 * Resolve every `catalog:` and `workspace:` specifier in one `Manifest`
 * against the real workspace, in one call — the 90% path. Decode stays at the
 * consumer's edge: build the `Manifest` with `Manifest.decode` (from
 * `@effected/npm`), hand it here, and get a new `Manifest` back with concrete
 * ranges; `toRecord()` returns to the wire shape.
 *
 * @remarks
 * Composes `manifest.resolve()` with a fresh {@link Workspaces.resolverLayer}
 * per call, so the workspace root is re-discovered from `options.cwd` (or the
 * current `process.cwd()`) on every invocation. Consumers processing many
 * manifests should check `manifest.needsResolution` first and skip the call
 * entirely when no dependency field carries a `catalog:`/`workspace:`
 * specifier — that predicate is pure and avoids catalog assembly altogether.
 *
 * A specifier the workspace cannot answer fails typed as
 * `UnresolvedDependencyError`; assembly and mechanism failures surface as
 * `CatalogAssemblyError` / `DependencyResolutionError`.
 *
 * @example
 * ```ts
 * import { Manifest } from "@effected/npm";
 * import { Workspaces } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const manifest = yield* Manifest.decode({ dependencies: { effect: "catalog:" } });
 *   const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest) : manifest;
 *   return resolved.toRecord();
 * });
 * ```
 *
 * @public
 */
const resolveManifest: (
	manifest: Manifest,
	options?: WorkspacesOptions,
) => Effect.Effect<
	Manifest,
	CatalogAssemblyError | DependencyResolutionError | UnresolvedDependencyError,
	FileSystem.FileSystem | Path.Path
> = Effect.fn("Workspaces.resolveManifest")(function* (manifest: Manifest, options?: WorkspacesOptions) {
	return yield* manifest.resolve().pipe(Effect.provide(resolverLayer(options)));
});

/**
 * The composite layers.
 *
 * @public
 */
export const Workspaces = {
	layer,
	layerWithConfigDependencies,
	layerWithGit,
	resolveManifest,
	resolverLayer,
	resolvers,
} as const;
