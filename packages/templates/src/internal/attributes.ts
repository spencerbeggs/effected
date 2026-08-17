// The marker attribute grammar, shared by the renderer and the scanner so the
// two can never disagree about what an attribute run is.
//
// A BEGIN marker may carry `name="value"` pairs between the phrase and the
// closing rule. Names are `[A-Za-z][A-Za-z0-9_-]*`; values are double-quoted
// and may not contain `"` or any line break — there is no escaping mechanism,
// by design: an escape grammar is a second parser hiding inside the first, and
// every value this package refuses is one it could not have read back
// verbatim.

/** The attribute name grammar. No leading digit, underscore or dash. */
export const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * A whole attribute run, fully anchored: one or more `name="value"` pairs
 * separated by whitespace. The scanner captures the run as a single loose
 * group and validates it here — a repeated capture group in the marker regex
 * would keep only its last match.
 */
const ATTRIBUTE_RUN = /^[A-Za-z][A-Za-z0-9_-]*="[^"\r\n]*"(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*="[^"\r\n]*")*$/;

/** One pair, for extraction after {@link parseAttributeRun} has validated the run. */
const ATTRIBUTE_PAIR = /([A-Za-z][A-Za-z0-9_-]*)="([^"\r\n]*)"/g;

/** True when a value can appear inside an attribute's double quotes verbatim. */
export const isValidAttributeValue = (value: string): boolean =>
	!value.includes('"') && !value.includes("\n") && !value.includes("\r");

/**
 * Parse a captured attribute run, or refuse it.
 *
 * @remarks
 * `undefined` means the run is not a valid attribute run and the line carrying
 * it is **not a marker** — it is ordinary content. That covers a mangled pair
 * and a name declared twice: two values for one name is two intentions for one
 * attribute, and any choice between them would be a guess.
 *
 * Document order is preserved: the returned record's insertion order is the
 * order the pairs appear in the marker.
 */
export const parseAttributeRun = (run: string): Record<string, string> | undefined => {
	if (!ATTRIBUTE_RUN.test(run)) {
		return undefined;
	}
	const attributes: Record<string, string> = {};
	// `matchAll` clones the regex internally, so the shared `lastIndex` of the
	// `g`-flagged pattern never leaks between calls.
	for (const match of run.matchAll(ATTRIBUTE_PAIR)) {
		const name = match[1] ?? "";
		if (Object.hasOwn(attributes, name)) {
			return undefined;
		}
		attributes[name] = match[2] ?? "";
	}
	return attributes;
};
