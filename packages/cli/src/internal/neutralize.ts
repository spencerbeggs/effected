/**
 * A line the runner reads as a command: after its leading whitespace it starts with `::`, or with `##`, the legacy
 * prefix of `##[error]` and `##vso[...]`. The whitespace is .NET's, which is JavaScript's `\s` plus U+0085.
 */
const COMMAND = /^[\s\u0085]*(?:::|##)/;

/** The runner's line breaks: it splits at a lone CR as well as at LF and CRLF. */
const LINE_BREAK = /\r\n|\r|\n/;

/** U+200B, written by code point so the source carries no invisible character. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/**
 * Make a line of text safe to put in a log: a line that would be read as a command gets a zero-width space in front,
 * which the runner does not count as whitespace, so it is no longer at the start of the line.
 */
const neutralize = (line: string): string => (COMMAND.test(line) ? `${ZERO_WIDTH_SPACE}${line}` : line);

/**
 * Split text at the runner's line breaks and neutralize each line that would be read as a command.
 *
 * @remarks
 * Applying it twice changes nothing more: the zero-width space is not whitespace to the pattern, so a neutralized line
 * no longer starts with a command. That is what lets `Render.githubLog`, which neutralizes as it builds, and the
 * facade, which neutralizes every format when the runner is GitHub Actions, both apply it without a second marker.
 *
 * @internal
 */
export const neutralizeLines = (text: string): ReadonlyArray<string> => text.split(LINE_BREAK).map(neutralize);
