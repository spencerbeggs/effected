import type { NpmConfig, RegistryReadError } from "@effected/npm";
import { NpmRegistry } from "@effected/npm";
import { Context, Effect, Layer, Option } from "effect";

/**
 * The {@link RegistryVersions} service shape.
 *
 * @public
 */
export interface RegistryVersionsShape {
	/**
	 * Whether the registry has exactly `name@version`.
	 *
	 * @remarks
	 * `false` is the registry answering 404 for the package, or a version list
	 * without `version`. A transport or status failure is the error, never
	 * `false`: reading an outage as "unpublished" would plan a debut release of
	 * a version that exists.
	 */
	readonly published: (name: string, version: string) => Effect.Effect<boolean, RegistryReadError>;
}

/**
 * The registry seam of first releases: is a project's manifest version
 * already published?
 *
 * @remarks
 * pnpm decides a first release by probing the registry for exactly the
 * manifest version (`package.versions.contains_key(current)`,
 * `crates/cli/src/cli_args/changelog.rs:322`), where only a 404 means
 * unpublished and any other failure propagates. {@link ReleasePlan.read} asks
 * this service for each public release when it is provided, and plans without
 * it, treating nothing as a first release, when it is not.
 *
 * A project that renames itself with `publishConfig.name` is probed under
 * that name, as pnpm does, so `ReleasePlan.read` passes the published name.
 *
 * @public
 */
export class RegistryVersions extends Context.Service<RegistryVersions, RegistryVersionsShape>()(
	"@effected/changesets/RegistryVersions",
) {
	/**
	 * The service over `NpmRegistry`, each package read from the registry and
	 * with the credential `config` routes it to.
	 *
	 * @remarks
	 * `NpmConfig.targetFor(name)` picks the package's own registry (`@scope:registry`)
	 * and the credential npm would send for it, as pnpm's `registry_for` and
	 * `auth_header_for_package` do (`changelog.rs:298-308`). Reading the default
	 * registry anonymously instead would answer 404 for a scoped package on a
	 * private registry, which reads as unpublished and debuts a version that
	 * exists.
	 *
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference: bind the result to a `const` once, or the layer
	 * builds twice.
	 *
	 * @param config - The resolved npm configuration, usually `NpmConfig.load`'s.
	 */
	static readonly layerFrom = (config: NpmConfig): Layer.Layer<RegistryVersions, never, NpmRegistry> =>
		Layer.effect(
			RegistryVersions,
			Effect.gen(function* () {
				const registry = yield* NpmRegistry;
				return {
					published: Effect.fn("RegistryVersions.published")(function* (name: string, version: string) {
						const versions = yield* registry.versions(name, config.targetFor(name));
						return Option.isSome(versions) && versions.value.includes(version);
					}),
				};
			}),
		);
}
