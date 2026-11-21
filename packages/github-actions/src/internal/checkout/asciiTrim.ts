const isAsciiWhitespace = (code: number): boolean => code === 0x20 || (code >= 0x09 && code <= 0x0d);

/**
 * Strips only the ASCII whitespace (`\t`, `\n`, `\v`, `\f`, `\r` and space) from both ends of a value. A BOM or an NBSP
 * is valid inside a git ref name, so a wider trim would reclassify a fork branch named `"<BOM><sha>"` as a bare commit
 * and slip past the unsafe pull request guard. A two-ended index scan, linear in the value's length.
 *
 * @internal
 */
export const asciiTrim = (value: string): string => {
	let start = 0;
	let end = value.length;
	while (start < end && isAsciiWhitespace(value.charCodeAt(start))) start++;
	while (end > start && isAsciiWhitespace(value.charCodeAt(end - 1))) end--;
	return start === 0 && end === value.length ? value : value.slice(start, end);
};
