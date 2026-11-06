import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Manifest } from "@effected/npm";
import { Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

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

/** Bound once: the platform layer is stateless and layers memoize by reference. */
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/**
 * Resolve every `catalog:`/`workspace:` specifier in a manifest to a concrete spec,
 * delegating to `@effected/workspaces`' one-shot `Workspaces.resolveManifest`. The
 * resolver re-discovers the workspace root from `process.cwd()` on every call (run
 * this from inside the target workspace) and assembles catalogs durably (inline +
 * config-dependency hook-replay + lockfile), so no transient
 * `.pnpm-workspace-state-v1.json` is required.
 *
 * Rejects with `ManifestDecodeError` when a dependency field is not a string-to-string
 * record, `UnresolvedDependencyError` on a specifier the workspace cannot answer, or
 * `CatalogAssemblyError`/`DependencyResolutionError` when catalog assembly or the
 * resolution mechanism itself fails.
 * @public
 */
export function resolveManifest(pkg: ManifestLike): Promise<ManifestLike> {
	const program = Effect.gen(function* () {
		const manifest = yield* Manifest.decode(pkg);
		const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest) : manifest;
		return resolved.toRecord() as ManifestLike;
	});
	return Effect.runPromise(program.pipe(Effect.provide(platform)));
}
