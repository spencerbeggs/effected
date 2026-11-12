import type {
	CatalogAssemblyError,
	DependencyResolutionError,
	ManifestDecodeError,
	UnresolvedDependencyError,
} from "@effected/npm";
import { Manifest } from "@effected/npm";
import { Workspaces } from "@effected/workspaces";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";

/**
 * Minimal shape of a `package.json` manifest needed to resolve catalog and
 * workspace specifiers.
 *
 * @public
 */
export interface ManifestLike {
	readonly name: string;
	readonly version: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	[k: string]: unknown;
}

/**
 * The failures of {@link resolveManifest}.
 *
 * @public
 */
export type ResolveManifestError =
	| ManifestDecodeError
	| CatalogAssemblyError
	| DependencyResolutionError
	| UnresolvedDependencyError;

/**
 * Resolve every `catalog:`/`workspace:` specifier in a manifest to a concrete spec,
 * delegating to `@effected/workspaces`' one-shot `Workspaces.resolveManifest`. The
 * resolver re-discovers the workspace root from `cwd` on every call, never from the
 * process directory, and assembles catalogs durably (inline +
 * config-dependency hook-replay + lockfile), so no transient
 * `.pnpm-workspace-state-v1.json` is required.
 *
 * Fails with `ManifestDecodeError` when a dependency field is not a string-to-string
 * record, `UnresolvedDependencyError` on a specifier the workspace cannot answer, or
 * `CatalogAssemblyError`/`DependencyResolutionError` when catalog assembly or the
 * resolution mechanism itself fails.
 * @public
 */
export const resolveManifest = (
	pkg: ManifestLike,
	cwd: string,
): Effect.Effect<ManifestLike, ResolveManifestError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const manifest = yield* Manifest.decode(pkg);
		const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest, { cwd }) : manifest;
		return resolved.toRecord() as ManifestLike;
	});
