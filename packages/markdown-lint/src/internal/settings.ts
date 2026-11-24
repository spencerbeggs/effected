// Rule settings: a reader that falls back to markdownlint's default on a
// wrong-typed value, and the one guard `effect`'s `Predicate` lacks.

import { Predicate } from "effect";

/** Read setting `name`, or `fallback` when it is absent or fails `guard`. @internal */
export const setting = <A>(
	config: Readonly<Record<string, unknown>>,
	name: string,
	guard: (value: unknown) => value is A,
	fallback: A,
): A => {
	const value = config[name];
	return guard(value) ? value : fallback;
};

/** A setting that is an array of strings; the scalar guards are `effect`'s `Predicate`s. @internal */
export const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(Predicate.isString);
