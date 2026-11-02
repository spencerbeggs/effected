// Guarded reads of an unknown failure value: whatever was thrown or failed with, read without ever throwing.
//
// The failure report reads a value String-first (`failureText`), so an `Error` keeps its name ("TypeError: boom"),
// which says what went wrong. `Fmt.describe` is the public, message-first read for data a program prints, where the
// `Error:` prefix is noise. The two differ on purpose: one names a failure, the other shows a value.

/** The value's `_tag` when it is a string; `undefined` otherwise, and when reading it throws. */
export const tagOf = (value: unknown): string | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	try {
		const tag = (value as { readonly _tag?: unknown })._tag;
		return typeof tag === "string" ? tag : undefined;
	} catch {
		return undefined;
	}
};

/**
 * A failure value as report text: `String(value)`, except that a plain object whose `String` says only
 * `[object Object]` is its string `message` when it has one. `String(value)` throws for an object with no prototype or
 * a hostile `toString`: that value is `unprintable`.
 */
export const failureText = (value: unknown, unprintable = "[unprintable value]"): string => {
	try {
		const text = String(value);
		if (text !== "[object Object]") return text;
		const message = (value as { readonly message?: unknown } | null)?.message;
		return typeof message === "string" ? message : text;
	} catch {
		return unprintable;
	}
};

/**
 * A property of a failure value, or `undefined` when it has none or reading it throws: a report must never fail on a
 * hostile getter. An `Error`'s `stack` counts, since V8 formats it on first read and the formatting reads `message`.
 */
export const readProperty = (value: unknown, key: string): unknown => {
	if (typeof value !== "object" || value === null) return undefined;
	try {
		return (value as Readonly<Record<string, unknown>>)[key];
	} catch {
		return undefined;
	}
};
