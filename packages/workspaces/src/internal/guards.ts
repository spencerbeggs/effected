// Shared shape guards for parsed JSON. `Predicate.isObject` is the object
// test; this module adds only what core does not ship.
//
// Private implementation module — never re-exported from `index.ts`.

import { Predicate } from "effect";

/**
 * Whether `value` is a plain object (not `null`, not an array) whose every own
 * enumerable value is a string — the shape of a dependency or catalog map.
 *
 * @internal
 */
export const isStringRecord = (value: unknown): value is Record<string, string> =>
	Predicate.isObject(value) && Object.values(value).every(Predicate.isString);
