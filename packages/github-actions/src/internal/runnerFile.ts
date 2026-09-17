/**
 * The runner-file heredoc protocol — `GITHUB_OUTPUT`, `GITHUB_ENV` and
 * `GITHUB_STATE` all take `name<<DELIM\nvalue\nDELIM\n` — spelled once for
 * `ActionOutputs` and `ActionState`.
 *
 * @remarks
 * **Delimiters are derived, never random.** GitHub's own toolkit uses a
 * random UUID here and accepts the (tiny) chance of collision. Deriving the
 * delimiter instead makes collision **impossible** rather than improbable,
 * needs no randomness — so no `Crypto` in `R` and no unreproducible output —
 * and is trivially testable. A value that contains a delimiter would
 * terminate its block early and corrupt every entry after it, which is a
 * value-controlled injection into the runner's own file.
 *
 * @internal
 */

/** The base delimiter for a heredoc block. */
const BASE_DELIMITER = "EFFECTED_EOF";

/** A delimiter guaranteed absent from `value`. @internal */
export const delimiterFor = (value: string): string => {
	let delimiter = BASE_DELIMITER;
	while (value.includes(delimiter)) {
		delimiter = `${delimiter}_`;
	}
	return delimiter;
};

/**
 * Whether `name` can head a block without breaking the structure it lives
 * in: non-empty, and free of the line breaks that would end it early.
 *
 * @internal
 */
export const isUsableName = (name: string): boolean => name !== "" && !/[\r\n]/.test(name);

/**
 * One heredoc block, ready to append. The caller has checked the name with
 * {@link isUsableName}.
 *
 * @internal
 */
export const heredocBlock = (name: string, value: string): string => {
	const delimiter = delimiterFor(value);
	return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
};
