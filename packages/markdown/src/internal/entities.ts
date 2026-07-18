// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Character-reference decoding. Upstream delegates the whole job to the
// `entities` package's `decodeHTMLStrict`; this package owns its engine, so
// the named-entity table is generated data that lands in Task 8
// (`entityMap.ts`). Until then the numeric forms — which need no table at all
// — decode here, and a named reference is left as literal text.
//
// TASK 8: replace the `undefined` branch below with the generated map lookup.
// Nothing else in the engine changes; every caller goes through this function.
//
// Leaf module: imports nothing.

/** The largest code point Unicode defines. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Decode one character reference, brackets included (`&#35;`, `&amp;`).
 *
 * Returns `undefined` when the reference is not one this engine can decode,
 * which the caller must render as the literal source text — never as an
 * empty string.
 */
export const decodeEntity = (entity: string): string | undefined => {
	if (!entity.startsWith("&") || !entity.endsWith(";")) {
		return undefined;
	}

	const body = entity.slice(1, -1);
	if (!body.startsWith("#")) {
		// A named reference. Task 8 resolves these against the generated map.
		return undefined;
	}

	const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
	const digits = hex ? body.slice(2) : body.slice(1);
	if (digits.length === 0 || !(hex ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(digits)) {
		return undefined;
	}

	const code = Number.parseInt(digits, hex ? 16 : 10);
	// The spec: U+0000, an out-of-range value and a surrogate all decode to
	// the replacement character rather than failing.
	if (code === 0 || code > MAX_CODE_POINT || (code >= 0xd800 && code <= 0xdfff)) {
		return "�";
	}
	return String.fromCodePoint(code);
};
