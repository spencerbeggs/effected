// How pnpm 12 reads a scalar setting value, shared by `PnpmSettings`' typed
// accessors and the `./settings` catalog's codecs so the two cannot drift.
// Settings files go through serde_saphyr, which coerces a scalar before it
// type-checks; the environment goes through serde_json or the text as written.

/** A canonical unsigned integer, the only text pnpm 12 reads for an unsigned setting. */
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/;

/** A canonical signed integer: an optional `-`, no leading zero, no `+`. */
const SIGNED = /^-?(?:0|[1-9][0-9]*)$/;

/** The strings pnpm 12 coerces to a boolean in a settings file, compared trimmed and case-insensitively. */
const TRUTHY: ReadonlySet<string> = new Set(["true", "yes", "y", "on"]);
const FALSY: ReadonlySet<string> = new Set(["false", "no", "n", "off"]);

/** A trimmed canonical unsigned integer string, within the safe-integer range, or `undefined`. */
export const unsignedFromText = (text: string): number | undefined => {
	const trimmed = text.trim();
	if (!UNSIGNED.test(trimmed)) return undefined;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) ? value : undefined;
};

/**
 * A file value as a non-negative safe integer: a number or a canonical unsigned
 * string. Never `-0`: pnpm 12 refuses `-0` for an unsigned setting
 * (`invalid u32`).
 */
export const unsignedFromValue = (value: unknown): number | undefined =>
	typeof value === "number"
		? Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
			? value
			: undefined
		: typeof value === "string"
			? unsignedFromText(value)
			: undefined;

/**
 * A file value as a safe integer: a number or a canonical signed string. `-0`
 * reads as `0`, as pnpm 12 reads it for a signed setting.
 */
export const integerFromValue = (value: unknown): number | undefined => {
	if (typeof value === "number") return Number.isSafeInteger(value) ? value + 0 : undefined;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!SIGNED.test(trimmed)) return undefined;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) ? parsed + 0 : undefined;
};

/** An environment value as a boolean: exactly `true` or `false` once trimmed, as pnpm 12 reads it. */
export const booleanFromText = (text: string): boolean | undefined => {
	const trimmed = text.trim();
	return trimmed === "true" ? true : trimmed === "false" ? false : undefined;
};

/** A file value as a boolean: a YAML boolean, or one of the strings pnpm 12 coerces. */
export const booleanFromValue = (value: unknown): boolean | undefined => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const word = value.trim().toLowerCase();
	return TRUTHY.has(word) ? true : FALSY.has(word) ? false : undefined;
};
