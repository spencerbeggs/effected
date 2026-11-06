import { Schema } from "effect";

/**
 * A semver bump a changeset can request: `patch`, `minor` or `major`.
 *
 * @public
 */
export const BumpType = Schema.Literals(["patch", "minor", "major"]);

/**
 * The type of a {@link BumpType} value.
 *
 * @public
 */
export type BumpType = typeof BumpType.Type;
