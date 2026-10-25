import { Schema } from "effect";

/**
 * Apply the desired value: there is no baseline yet, or the desired value
 * changed and the live value still matches what was last applied.
 *
 * @public
 */
export class DriftApply extends Schema.TaggedClass<DriftApply>()("Apply", {}) {}

/**
 * Leave the resource alone: the live value matches the baseline, and the
 * desired value is the one that was applied.
 *
 * @public
 */
export class DriftUnchanged extends Schema.TaggedClass<DriftUnchanged>()("Unchanged", {}) {}

/**
 * Somebody else changed the resource: its live fingerprint no longer matches
 * the one last applied.
 *
 * @remarks
 * This wins over a changed desired value: when both moved, the decision is
 * still `Drift`, because that is the case where a user most wants to be told
 * before anything is overwritten.
 *
 * @public
 */
export class DriftDetected extends Schema.TaggedClass<DriftDetected>()("Drift", {
	/** The fingerprint last applied: the baseline. */
	applied: Schema.String,
	/** The live fingerprint that departed from it. */
	live: Schema.String,
}) {}

/**
 * The outcome of a three-way drift comparison: `Apply`, `Unchanged` or
 * `Drift`, as returned by `Fingerprint.decide`.
 *
 * @remarks
 * A decision rather than two booleans, because two booleans cannot express
 * "changed out of band and our desired value also changed". The tags are the
 * plain words `Apply`, `Unchanged` and `Drift`; match on `_tag`. A schema, so
 * a decision can be logged or persisted and decoded back.
 *
 * @public
 */
export const DriftDecision = Schema.Union([DriftApply, DriftUnchanged, DriftDetected]);

/**
 * The decoded type of {@link (DriftDecision:variable)}.
 *
 * @public
 */
export type DriftDecision = typeof DriftDecision.Type;
