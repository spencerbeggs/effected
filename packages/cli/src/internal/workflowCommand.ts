/**
 * Escape a workflow command's data (its message): `%`, then CR, then LF.
 *
 * The percent sign goes first. Doing it last would escape the `%` of an escape this function just wrote, turning
 * `%0A` into `%250A`. A raw line break would end the command and let the text after it be read as a new one.
 *
 * @see https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions
 *
 * @internal
 */
export const escapeData = (value: string): string =>
	value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/**
 * Escape a workflow command's property value: everything data escapes, plus `:` and `,`, the characters that
 * delimit the property list.
 *
 * @internal
 */
export const escapeProperty = (value: string): string =>
	escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
