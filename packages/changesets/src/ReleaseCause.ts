import { Schema } from "effect";

/**
 * Why a release is in a plan, pnpm's `ReleaseCause`
 * (`crates/versioning/src/plan.rs:56-68`): `intent`, a changeset naming it;
 * `dependencies`, a dependency it ripples from; `fixed`, a fixed group it
 * belongs to; `epic`, its epic lead crossing a major. The literals are listed
 * in pnpm's report order, the derived `Ord`, which is alphabetical.
 *
 * @public
 */
export const ReleaseCause = Schema.Literals(["dependencies", "epic", "fixed", "intent"]);

/**
 * The type of a `ReleaseCause` value.
 *
 * @public
 */
export type ReleaseCause = typeof ReleaseCause.Type;

/**
 * Causes in pnpm's report order, each once: the order of
 * `ReleaseCause.literals`, so the schema is the one source of it.
 *
 * @internal
 */
export const sortCauses = (causes: Iterable<ReleaseCause>): Array<ReleaseCause> => {
	const present = new Set(causes);
	return ReleaseCause.literals.filter((cause) => present.has(cause));
};
