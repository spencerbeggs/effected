import { Schema } from "effect";

/**
 * What a caller — usually an agent — should do after a failure.
 *
 * @remarks
 * The superset of two shapes consumers built independently: the folded-message
 * shape `{ hint, suggestedTool? }` and the structured-data shape
 * `{ suggestedTool, suggestedArgs, humanHint }`. `humanHint` maps to `hint`.
 * Keys are `optionalKey`, so an explicit `undefined` is rejected rather than
 * silently encoded.
 *
 * @public
 */
export const Remediation = Schema.Struct({
	hint: Schema.String,
	suggestedTool: Schema.optionalKey(Schema.String),
	suggestedArgs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/**
 * A decoded {@link (Remediation:variable)}.
 *
 * @public
 */
export type Remediation = typeof Remediation.Type;
