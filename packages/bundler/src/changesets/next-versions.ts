import { ReleasePlan } from "@effected/changesets";
import { WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";

/**
 * Result of resolving next release versions for a workspace.
 *
 * @public
 */
export interface NextVersions {
	/** Monorepo root containing `.changeset/` (or `cwd` when no workspace was found). */
	readonly root: string;
	/** Canonical package name `->` next release version (current version when unbumped). */
	readonly versions: ReadonlyMap<string, string>;
}

/**
 * Resolve the next release version of every workspace package from pending changesets.
 *
 * Walks up from `cwd` to the monorepo root via `@effected/workspaces`' `WorkspaceDiscovery`,
 * seeds the map with each package's CURRENT version, then overlays `newVersion` for
 * changeset-affected packages via `ReleasePlan.read`, including pre-release versions in pre
 * mode and fixed or linked groups. Never fails: any failure (not a workspace, missing
 * `.changeset/config.json`, an invalid config or `pre.json`, parse error) degrades to current
 * versions (or an empty map). So does a pnpm-native plan that releases two same-named projects,
 * which a name-keyed map cannot hold: `ReleasePlan.releasesByName` refuses it.
 * @public
 */
export const resolveNextVersions = (
	cwd: string,
): Effect.Effect<NextVersions, never, FileSystem.FileSystem | Path.Path> => {
	// A fresh composite layer per call: `cwd` differs per invocation and layers
	// memoize by reference, so root discovery must not be shared across calls.
	const workspace = Workspaces.layer({ cwd });
	return Effect.gen(function* () {
		const packages = yield* Effect.flatMap(WorkspaceDiscovery, (discovery) => discovery.listPackages()).pipe(
			Effect.provide(workspace),
		);
		// listPackages is root-first; the root package's path is the monorepo root.
		const rootDir = packages[0]?.isRootWorkspace ? packages[0].path : cwd;
		const versions = new Map<string, string>();
		for (const p of packages) {
			// Parity with the previous @manypkg/get-packages behavior: the root package was
			// never part of packages[] and therefore never seeded into the versions map.
			if (p.isRootWorkspace) continue;
			// A manifest with no `version` is a legal member (`@effected/workspaces` 0.19.0 retired
			// its `missingVersion` failure), and there is no current version to seed. The plan does not
			// list it either, even when a changeset names it, so the package is simply not in the map —
			// which is what an unknown version means to every consumer.
			if (p.version === undefined) continue;
			versions.set(p.name, p.version);
		}
		yield* ReleasePlan.read(rootDir).pipe(
			Effect.provide(workspace),
			// The map is keyed by name, so a pnpm plan releasing two same-named projects is refused
			// (AmbiguousPackageError) rather than letting one twin's version stand for both; like every
			// other failure here, the refusal leaves the current versions.
			Effect.flatMap((plan) => Effect.fromResult(ReleasePlan.releasesByName(plan))),
			// The plan includes type:"none" entries (unbumped dependents) whose newVersion equals the
			// current version, so overlaying every release is safe.
			Effect.tap((byName) =>
				Effect.sync(() => {
					for (const [name, r] of byName) versions.set(name, r.newVersion);
				}),
			),
			// No `.changeset/config.json`, an invalid config or pre.json, or unreadable: keep current versions.
			Effect.orElseSucceed(() => undefined),
			Effect.catchDefect(() => Effect.void),
		);
		return { root: rootDir, versions } satisfies NextVersions;
	}).pipe(
		// Not a workspace / cannot enumerate packages: optimistic becomes a full no-op.
		Effect.orElseSucceed((): NextVersions => ({ root: cwd, versions: new Map() })),
		Effect.catchDefect(() => Effect.succeed<NextVersions>({ root: cwd, versions: new Map() })),
	);
};
