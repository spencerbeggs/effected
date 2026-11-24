// Rule settings: a reader that falls back to markdownlint's default on a
// wrong-typed value, and the guards it takes.

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

/** @internal */
export const isNumber = (value: unknown): value is number => typeof value === "number";

/** @internal */
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** @internal */
export const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

/** @internal */
export const isString = (value: unknown): value is string => typeof value === "string";
