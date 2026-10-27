// Trailing-run trimming as a backwards index loop. The regex form, `/x+$/`, is unanchored at its start: on a run of
// `x` that is not at the end it retries from every character of the run, which is quadratic in the run's length.
// No imports, so a subprocess can load this file directly to time it.

/**
 * `text` without its trailing run of characters `isTrailing` accepts, in time linear in the run.
 *
 * @internal
 */
export const trimTrailing = (text: string, isTrailing: (character: string) => boolean): string => {
	let end = text.length;
	while (end > 0 && isTrailing(text.charAt(end - 1))) end -= 1;
	return end === text.length ? text : text.slice(0, end);
};
