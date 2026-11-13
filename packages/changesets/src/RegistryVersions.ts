import type { RegistryReadError } from "@effected/npm";
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
 * Reads the package's default registry (`NpmRegistry.versions` with no
 * target); a repository that publishes through a scoped registry provides its
 * own service answering for it.
 *
 * @public
 */
export class RegistryVersions extends Context.Service<RegistryVersions, RegistryVersionsShape>()(
	"@effected/changesets/RegistryVersions",
) {
	/**
	 * The service over `NpmRegistry`.
	 *
	 * Parameterless, so one reference: provide it where it is wanted without
	 * binding it again.
	 */
	static readonly layer: Layer.Layer<RegistryVersions, never, NpmRegistry> = Layer.effect(
		RegistryVersions,
		Effect.gen(function* () {
			const registry = yield* NpmRegistry;
			return {
				published: Effect.fn("RegistryVersions.published")(function* (name: string, version: string) {
					const versions = yield* registry.versions(name);
					return Option.isSome(versions) && versions.value.includes(version);
				}),
			};
		}),
	);
}
