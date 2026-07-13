/**
 * The shared vocabulary of resolution: what a resolver returns, and how it fails.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";
import { NodePhase } from "./NodeSchedule.js";

/**
 * The JavaScript runtime a resolver targets.
 *
 * @public
 */
export const Runtime = Schema.Literals(["node", "bun", "deno"]);

/**
 * The JavaScript runtime a resolver targets.
 *
 * @public
 */
export type Runtime = typeof Runtime.Type;

/**
 * Where a resolution's release data came from.
 *
 * - `api` — a live fetch of the upstream feed succeeded.
 * - `cache` — the bundled snapshot was used, either because the offline
 *   strategy was chosen or because the auto strategy fell back to it.
 *
 * This is honest provenance. In v3 the field existed, was advertised as a
 * headline feature, and was hardcoded to `"api"` by every resolver — so a
 * caller could not tell a live answer from a snapshot served after a silent
 * network failure.
 *
 * @public
 */
export const Source = Schema.Literals(["api", "cache"]);

/**
 * Where a resolution's release data came from.
 *
 * @public
 */
export type Source = typeof Source.Type;

/**
 * The granularity at which matching versions are grouped.
 *
 * - `latest` — the newest version of each major line.
 * - `minor` — the newest patch of each minor line.
 * - `patch` — every matching release.
 *
 * @public
 */
export const Increments = Schema.Literals(["latest", "minor", "patch"]);

/**
 * The granularity at which matching versions are grouped.
 *
 * @public
 */
export type Increments = typeof Increments.Type;

/**
 * What every resolver returns.
 *
 * @public
 */
export class ResolvedVersions extends Schema.Class<ResolvedVersions>("ResolvedVersions")({
	/** Whether this answer came from a live feed or the bundled snapshot. */
	source: Source,
	/** Every matching version, newest first. */
	versions: Schema.Array(Schema.String),
	/** The newest matching version. Always present — an empty match is an error, not an empty result. */
	latest: Schema.String,
	/** The newest matching LTS version. Node only, and only when one matches. */
	lts: Schema.optionalKey(Schema.String),
	/** The version the caller asked to treat as the default, resolved. */
	default: Schema.optionalKey(Schema.String),
}) {}

/**
 * No release matched the constraint.
 *
 * Distinct from an invalid constraint: `@effected/semver`'s `InvalidRangeError`
 * says the range is malformed, this says the range is fine and nothing matched.
 * v3 collapsed the former into the latter, so a typo in a range surfaced to the
 * user as "no versions found".
 *
 * @public
 */
export class NoMatchingVersionError extends Schema.TaggedErrorClass<NoMatchingVersionError>()(
	"NoMatchingVersionError",
	{
		/** The runtime that was searched. */
		runtime: Runtime,
		/** The semver range that matched nothing. */
		constraint: Schema.String,
		/** The lifecycle phases the search was restricted to. Node only. */
		phases: Schema.optionalKey(Schema.Array(NodePhase)),
	},
) {}

/**
 * An explicit `defaultVersion` was asked for and nothing matched it.
 *
 * Distinct from {@link NoMatchingVersionError}, which says the *main* range
 * matched nothing. Here the main range resolved fine and the caller's separate
 * default range did not.
 *
 * It has to be its own failure rather than a silently dropped field. `default`
 * is `optionalKey`, so an unresolvable default could simply be omitted — and for
 * Node, whose default falls back to the LTS pick, the caller would then be handed
 * the LTS version as though they had asked for it. Naming a default that does not
 * exist is a mistake, and it reaches the caller as one.
 *
 * @public
 */
export class UnresolvableDefaultError extends Schema.TaggedErrorClass<UnresolvableDefaultError>()(
	"UnresolvableDefaultError",
	{
		/** The runtime that was searched. */
		runtime: Runtime,
		/** The range the caller asked to treat as the default. */
		defaultVersion: Schema.String,
	},
) {}

/**
 * Fresh data was required and could not be obtained.
 *
 * Raised only by the `layerFresh` strategy, at layer construction: the caller
 * asked for live data and said, by choosing that strategy, that a snapshot is
 * not an acceptable substitute.
 *
 * @public
 */
export class FreshnessError extends Schema.TaggedErrorClass<FreshnessError>()("FreshnessError", {
	/** The runtime whose feed could not be reached. */
	runtime: Runtime,
	/** The underlying transport or parse failure. */
	cause: Schema.Defect(),
}) {}
