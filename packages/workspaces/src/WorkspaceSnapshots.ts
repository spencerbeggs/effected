// "What did this workspace look like at that moment": `at(ref)` reads workspace
// state at a git ref with NO checkout, `worktree()` reads the live tree.
//
// `at(ref)` runs entirely through `@effected/git`'s `Git` service — no
// filesystem enumeration, only the live root walk (the one place it touches the
// working tree, because you need a repository to run git against). Package
// discovery reuses the compiled `@effected/glob` set, matched against
// `Git.lsTree` output rather than a directory descent — the promise glob.md
// recorded when at-ref discovery was deferred. Catalogs assemble from the inline
// config source at the ref plus the detected manager's own lockfile at the ref,
// and BOTH pnpm and bun carry catalogs, so the lockfile read is PM-aware.
//
// `worktree()` reuses `WorkspaceDiscovery` and `WorkspaceCatalogs` — the ONE
// shared read path, never a second manifest/lockfile read.

import type { GitCommandError, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import { GlobSet } from "@effected/glob";
import { Lockfile as LockfileModel, filenameFor } from "@effected/lockfiles";
import { Yaml } from "@effected/yaml";
import { Context, Duration, Effect, Exit, Layer, Option } from "effect";
import { CatalogAssemblyError } from "./CatalogAssemblyError.js";
import { manifestPatternsOf, pnpmPatternsOf } from "./internal/patterns.js";
import { CatalogSet, WorkspaceCatalogs } from "./WorkspaceCatalogs.js";
import type { WorkspaceDiscoveryFailure } from "./WorkspaceDiscovery.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";
import type { WorkspaceRootNotFoundError } from "./WorkspaceRoot.js";
import { WorkspaceRoot } from "./WorkspaceRoot.js";
import { PackageStateSnapshot, WorkspaceStateSnapshot } from "./WorkspaceStateSnapshot.js";

/**
 * Every failure `WorkspaceSnapshots.at` can surface: git's own typed
 * errors, a catalog-assembly failure from the inline config source at the ref,
 * or an unfindable workspace root.
 *
 * @remarks
 * Narrow by design. `at` reads through git and never enumerates the live
 * filesystem, so no `WorkspaceDiscoveryError` / `WorkspacePatternError` appears —
 * and a malformed *lockfile* at the ref degrades to no catalogs (a lockfile is a
 * record, not a source of truth), so only the inline source raises
 * {@link CatalogAssemblyError}.
 *
 * @public
 */
export type WorkspaceSnapshotAtFailure =
	| GitCommandError
	| NotARepositoryError
	| UnknownRefError
	| CatalogAssemblyError
	| WorkspaceRootNotFoundError;

/**
 * Every failure `WorkspaceSnapshots.worktree` can surface: the discovery
 * failures plus a catalog-assembly failure.
 *
 * @remarks
 * `worktree` never invokes git — it reads the live tree over
 * {@link WorkspaceDiscovery} and {@link WorkspaceCatalogs} — so no git error is
 * reachable.
 *
 * @public
 */
export type WorkspaceSnapshotWorktreeFailure = WorkspaceDiscoveryFailure | CatalogAssemblyError;

/**
 * Options for the {@link WorkspaceSnapshots} layer.
 *
 * @public
 */
export interface WorkspaceSnapshotsOptions {
	/**
	 * The directory `at(ref)` resolves the workspace root from.
	 *
	 * @defaultValue `process.cwd()`, read lazily on first use inside
	 *   `Effect.suspend`, so a `process.chdir` between providing the layer and the
	 *   first call is honoured.
	 */
	readonly cwd?: string;
}

/**
 * The {@link WorkspaceSnapshots} service shape.
 *
 * @public
 */
export interface WorkspaceSnapshotsShape {
	/** The workspace state at a git ref, read with no checkout. Cached per `(root, ref)`. */
	readonly at: (ref: string) => Effect.Effect<WorkspaceStateSnapshot, WorkspaceSnapshotAtFailure>;
	/** The live workspace state, over discovery and catalog assembly. Uncached. */
	readonly worktree: () => Effect.Effect<WorkspaceStateSnapshot, WorkspaceSnapshotWorktreeFailure>;
}

/** Whether `value` is a non-null, non-array object. */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether every value in a record is a string — a usable dependency map. */
const isStringRecord = (value: unknown): value is Record<string, string> =>
	isObject(value) && Object.values(value).every((entry) => typeof entry === "string");

/**
 * Parse JSON tolerantly into a plain object. At-ref content is not ours to fix:
 * a corrupt or non-object manifest degrades to `{}` rather than failing the
 * whole snapshot, matching the tolerant projection discovery already uses.
 */
const parseJsonObject = (text: string): Record<string, unknown> => {
	try {
		const parsed = JSON.parse(text) as unknown;
		return isObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
};

/**
 * Project one `package.json` text (as read at a ref) into a
 * {@link PackageStateSnapshot}. An absent path, unparseable content, or a
 * manifest with no usable name is skipped — never an error.
 */
const snapshotOf = (content: Option.Option<string>, relativePath: string): Option.Option<PackageStateSnapshot> => {
	if (Option.isNone(content)) return Option.none();
	const parsed = parseJsonObject(content.value);
	const name = parsed.name;
	if (typeof name !== "string" || name.length === 0) return Option.none();
	const version = typeof parsed.version === "string" ? parsed.version : "";
	return Option.some(
		PackageStateSnapshot.make({
			name,
			version,
			relativePath,
			...(isStringRecord(parsed.dependencies) ? { dependencies: parsed.dependencies } : {}),
			...(isStringRecord(parsed.devDependencies) ? { devDependencies: parsed.devDependencies } : {}),
			...(isStringRecord(parsed.peerDependencies) ? { peerDependencies: parsed.peerDependencies } : {}),
			...(isStringRecord(parsed.optionalDependencies) ? { optionalDependencies: parsed.optionalDependencies } : {}),
		}),
	);
};

/**
 * bun's inline catalogs from the root manifest's `workspaces.catalog` /
 * `.catalogs`, read **tolerantly** — at-ref content is not ours to fix, so a
 * malformed block degrades rather than failing the snapshot. (The live
 * {@link WorkspaceCatalogs} reader hard-fails the same shape; the difference is
 * deliberate.) Normalization is the shared {@link CatalogSet.fromBunBlocks}.
 */
const bunInlineCatalogs = (manifest: Record<string, unknown>): CatalogSet => {
	const workspaces = manifest.workspaces;
	if (!isObject(workspaces)) return CatalogSet.empty();
	return CatalogSet.fromBunBlocks({ catalog: workspaces.catalog, catalogs: workspaces.catalogs });
};

/**
 * Reads workspace state at a git ref with no checkout, and the live worktree.
 *
 * @remarks
 * `at(ref)` is cached per `(resolved root, ref)` via
 * `Effect.cachedInvalidateWithTTL` at `Duration.infinity`, invalidated on any
 * non-success exit — never bare `Effect.cached`, which would memoize an
 * interrupt. A failed `at(ref)` init is therefore retried on the next call, not
 * memoized.
 *
 * @example
 * ```ts
 * import { WorkspaceSnapshots } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const snapshots = yield* WorkspaceSnapshots;
 *   const before = yield* snapshots.at("origin/main");
 *   const after = yield* snapshots.worktree();
 *   return { before: before.versions, after: after.versions };
 * });
 * ```
 *
 * @public
 */
export class WorkspaceSnapshots extends Context.Service<WorkspaceSnapshots, WorkspaceSnapshotsShape>()(
	"@effected/workspaces/WorkspaceSnapshots",
) {
	/** Builds the service over `Git`, {@link WorkspaceRoot}, {@link WorkspaceDiscovery} and {@link WorkspaceCatalogs}. */
	static readonly make = (
		options?: WorkspaceSnapshotsOptions,
	): Effect.Effect<WorkspaceSnapshotsShape, never, Git | WorkspaceRoot | WorkspaceDiscovery | WorkspaceCatalogs> =>
		Effect.gen(function* () {
			const git = yield* Git;
			const roots = yield* WorkspaceRoot;
			const discovery = yield* WorkspaceDiscovery;
			const catalogsService = yield* WorkspaceCatalogs;

			/** The catalog set a manager's lockfile records at the ref, or empty when absent/malformed. */
			const lockfileCatalogs = (
				root: string,
				ref: string,
				format: "pnpm" | "bun",
			): Effect.Effect<CatalogSet, GitCommandError | NotARepositoryError | UnknownRefError> =>
				git.show(root, ref, filenameFor(format)).pipe(
					Effect.flatMap((content) =>
						Option.match(content, {
							onNone: () => Effect.succeed(CatalogSet.empty()),
							onSome: (text) =>
								LockfileModel.parse(text, { format }).pipe(
									Effect.map(CatalogSet.fromLockfile),
									// A malformed lockfile at the ref is a broken RECORD, not a
									// broken source of truth — degrade to no catalogs, exactly as
									// the live WorkspaceCatalogs does for an unreadable lockfile.
									Effect.catch(() => Effect.succeed(CatalogSet.empty())),
								),
						}),
					),
				);

			const computeAt = (
				root: string,
				ref: string,
			): Effect.Effect<WorkspaceStateSnapshot, WorkspaceSnapshotAtFailure> =>
				Effect.gen(function* () {
					const pnpmWorkspaceText = yield* git.show(root, ref, "pnpm-workspace.yaml");
					const rootManifestText = yield* git.show(root, ref, "package.json");
					const rootManifest = Option.match(rootManifestText, {
						onNone: () => ({}) as Record<string, unknown>,
						onSome: parseJsonObject,
					});

					let patterns: ReadonlyArray<string>;
					let inline: CatalogSet;
					let fromLockfile: CatalogSet;

					if (Option.isSome(pnpmWorkspaceText)) {
						const document = yield* Yaml.parse(pnpmWorkspaceText.value).pipe(
							Effect.mapError(
								(cause) => new CatalogAssemblyError({ source: "manifest", path: "pnpm-workspace.yaml", cause }),
							),
						);
						const pnpmPatterns = pnpmPatternsOf(document);
						// c594ff1: a `pnpm-workspace.yaml` with no `packages:` falls back to
						// the root manifest's `workspaces` field, matching live `readPatterns`.
						patterns = pnpmPatterns.length > 0 ? pnpmPatterns : manifestPatternsOf(rootManifest);
						inline = yield* CatalogSet.fromWorkspaceYaml(pnpmWorkspaceText.value);
						fromLockfile = yield* lockfileCatalogs(root, ref, "pnpm");
					} else {
						// c594ff1: with no `pnpm-workspace.yaml`, the workspace globs come
						// from the root `package.json` `workspaces` field. WITHOUT this, a
						// bun or npm workspace collapses to the root package alone at a ref,
						// and a consumer diffing two snapshots sees every declared dependency
						// as newly added.
						patterns = manifestPatternsOf(rootManifest);
						const bunLockText = yield* git.show(root, ref, "bun.lock");
						if (Option.isSome(bunLockText)) {
							inline = bunInlineCatalogs(rootManifest);
							fromLockfile = yield* lockfileCatalogs(root, ref, "bun");
						} else {
							inline = CatalogSet.empty();
							fromLockfile = CatalogSet.empty();
						}
					}

					// Precedence follows the live assembler: lockfile record first, inline
					// declaration wins.
					const catalogs = CatalogSet.merge(fromLockfile, inline);

					const globs = yield* GlobSet.compile(patterns).pipe(
						Effect.mapError(
							(error) => new CatalogAssemblyError({ source: "manifest", path: error.pattern, cause: error }),
						),
					);

					// Package directories come from the tree listing at the ref, matched
					// against the compiled glob set — no directory descent, because
					// `ls-tree -r` already enumerates every path (globstar included).
					const entries = yield* git.lsTree(root, ref);
					const memberDirs: Array<string> = [];
					let hasRootManifest = false;
					for (const entry of entries) {
						if (entry.type !== "blob") continue;
						if (entry.path === "package.json") {
							hasRootManifest = true;
							continue;
						}
						if (!entry.path.endsWith("/package.json")) continue;
						const dir = entry.path.slice(0, entry.path.length - "/package.json".length);
						if (globs.matches(dir)) memberDirs.push(dir);
					}
					memberDirs.sort();

					const members = yield* Effect.forEach(
						memberDirs,
						(dir) => git.show(root, ref, `${dir}/package.json`).pipe(Effect.map((content) => snapshotOf(content, dir))),
						{ concurrency: 10 },
					);

					const rootPackage = hasRootManifest ? snapshotOf(rootManifestText, ".") : Option.none<PackageStateSnapshot>();
					const packages: Array<PackageStateSnapshot> = [];
					if (Option.isSome(rootPackage)) packages.push(rootPackage.value);
					for (const member of members) {
						if (Option.isSome(member)) packages.push(member.value);
					}

					return WorkspaceStateSnapshot.make({ packages, catalogs });
				});

			// Per-`(root, ref)` memo of the success-only invalidating cell. A failed
			// init invalidates its cell, so the next call recomputes rather than
			// replaying the failure.
			const atCaches = new Map<string, Effect.Effect<WorkspaceStateSnapshot, WorkspaceSnapshotAtFailure>>();

			const at = Effect.fn("WorkspaceSnapshots.at")(function* (ref: string) {
				// `Effect.suspend` so the ambient cwd is read at call time, not layer build.
				const root = yield* Effect.suspend(() => roots.find(options?.cwd ?? process.cwd()));
				const key = `${root} ${ref}`;
				let memo = atCaches.get(key);
				if (memo === undefined) {
					const [resolveOnce, invalidate] = yield* Effect.cachedInvalidateWithTTL(
						computeAt(root, ref),
						Duration.infinity,
					);
					const built = Effect.onExit(resolveOnce, (exit) => (Exit.isSuccess(exit) ? Effect.void : invalidate));
					// Re-check under the benign concurrent-miss race: keep whichever cell
					// landed first so callers dedupe onto one.
					const existing = atCaches.get(key);
					if (existing !== undefined) {
						memo = existing;
					} else {
						memo = built;
						atCaches.set(key, memo);
					}
				}
				return yield* memo;
			});

			const worktree = Effect.fn("WorkspaceSnapshots.worktree")(function* () {
				// The ONE shared read path: discovery's memo and the catalog memo, no
				// second manifest/lockfile read.
				const packages = yield* discovery.listPackages();
				const catalogs = yield* catalogsService.set();
				const snapshotPackages = packages.map((pkg) =>
					PackageStateSnapshot.make({
						name: pkg.name,
						version: pkg.version,
						relativePath: pkg.relativePath,
						dependencies: pkg.dependencies,
						devDependencies: pkg.devDependencies,
						peerDependencies: pkg.peerDependencies,
						optionalDependencies: pkg.optionalDependencies,
					}),
				);
				return WorkspaceStateSnapshot.make({ packages: snapshotPackages, catalogs });
			});

			return { at, worktree };
		});

	/**
	 * The live layer.
	 *
	 * @remarks
	 * Parameterized, so it mints a fresh reference per call — bind it to a
	 * `const` and reuse it, or layer memoization does not apply.
	 */
	static readonly layer = (
		options?: WorkspaceSnapshotsOptions,
	): Layer.Layer<WorkspaceSnapshots, never, Git | WorkspaceRoot | WorkspaceDiscovery | WorkspaceCatalogs> =>
		Layer.effect(WorkspaceSnapshots, WorkspaceSnapshots.make(options));
}
