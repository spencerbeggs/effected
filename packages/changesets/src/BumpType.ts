import { Schema } from "effect";

/**
 * A semver bump a changeset can request: `patch`, `minor` or `major`.
 *
 * @public
 */
export const BumpType = Schema.Literals(["patch", "minor", "major"]);

/**
 * The type of a `BumpType` value.
 *
 * @public
 */
export type BumpType = typeof BumpType.Type;

/**
 * What a changeset can say about a package: a {@link (BumpType:variable)}, or `none`, which names the package and
 * moves no version.
 *
 * @public
 */
export const ReleaseType = Schema.Literals(["patch", "minor", "major", "none"]);

/**
 * The type of a `ReleaseType` value.
 *
 * @public
 */
export type ReleaseType = typeof ReleaseType.Type;
