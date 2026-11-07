/**
 * Which release versions a target receives: every version, only final versions, or only prereleases.
 *
 * @remarks
 * A prerelease is any version carrying a SemVer prerelease suffix (`1.2.0-beta.1`). The filter is
 * applied per target at publish time, never at build time, so a `from` target that shares a group
 * with a differently-filtered target still reuses the same bytes.
 *
 * @public
 */
export type ReleaseChannel = "all" | "stable" | "prerelease";

/**
 * Every {@link ReleaseChannel} value, in declaration order.
 *
 * @public
 */
export const RELEASE_CHANNELS: ReadonlyArray<ReleaseChannel> = ["all", "stable", "prerelease"];

/**
 * A single object-form publish target. Uses `from` XOR `name` (never both).
 *
 * @public
 */
export interface PublishTargetObject {
	/** Registry endpoint. Required for custom keys; defaulted for `npm`/`github`. */
	readonly registry?: string | undefined;
	/** Name override for this target's own group. Mutually exclusive with `from`. */
	readonly name?: string | undefined;
	/** Reuse another target's group bytes (deploy them to this registry). Mutually exclusive with `name`. */
	readonly from?: string | undefined;
	/** Which release versions this target receives. Defaults to `"all"`. */
	readonly releases?: ReleaseChannel | undefined;
	/** Force the provenance attestation on or off, overriding the registry-derived default. */
	readonly provenance?: boolean | undefined;
}

/**
 * A `publishConfig.targets` value: `true` (well-known registry, base name), a string (name override), or an object.
 *
 * @public
 */
export type PublishTargetValue = true | string | PublishTargetObject;

/**
 * The `publishConfig.targets` map, keyed by target id (`npm`, `github`, or a custom key).
 *
 * @public
 */
export type PublishTargets = Record<string, PublishTargetValue>;

/**
 * A distinct byte-variant build group (one per distinct resolved name).
 *
 * @public
 */
export interface ResolvedGroup {
	/** Folder id; the group's output dir nests this id under dist/prod, with a pkg subfolder. */
	readonly id: string;
	/** The `package.json.name` this group's manifest carries. */
	readonly name: string;
	/** The group's pkg output dir, relative to the package root. */
	readonly dir: string;
}

/**
 * A resolved registry target (one per `publishConfig.targets` key).
 *
 * @public
 */
export interface ResolvedTarget {
	/** The `publishConfig.targets` key. */
	readonly id: string;
	/** The group id whose bytes this target deploys. */
	readonly group: string;
	/** The resolved name for that group. */
	readonly name: string;
	/** The resolved registry endpoint. */
	readonly registry: string;
	/** Which release versions this target receives; always written, `"all"` when undeclared. */
	readonly releases: ReleaseChannel;
	/** The declared provenance override; absent when the target leaves it to the registry default. */
	readonly provenance?: boolean;
}

/**
 * The full resolution of `publishConfig.targets`: the distinct groups to build, and every target bound to one.
 *
 * @public
 */
export interface TargetResolution {
	readonly groups: ReadonlyArray<ResolvedGroup>;
	readonly targets: ReadonlyArray<ResolvedTarget>;
}

/**
 * True when a target value is the object form (carries registry/name/from).
 *
 * @public
 */
export function isTargetObject(value: PublishTargetValue): value is PublishTargetObject {
	return typeof value === "object" && value !== null;
}
