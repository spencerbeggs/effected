/** Plain objects only — arrays and `null` are values, not merge targets. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively merge `source` into `target`; keys already present on `target`
 * win. Nested plain objects merge; every other value is atomic.
 */
export const deepMerge = (
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> => {
	const result: Record<string, unknown> = { ...target };
	for (const key of Object.keys(source)) {
		if (FORBIDDEN.has(key)) continue;
		const sourceValue = source[key];
		const targetValue = result[key];
		if (key in result && isPlainObject(targetValue) && isPlainObject(sourceValue)) {
			result[key] = deepMerge(targetValue, sourceValue);
		} else if (!(key in result)) {
			result[key] = sourceValue;
		}
	}
	return result;
};
