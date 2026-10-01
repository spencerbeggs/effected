// The GitHub Actions runner reads a workflow command by TWO parsers, and a line is a command if either accepts it.
// From `actions/runner`, `src/Runner.Common/ActionCommand.cs` and `src/Runner.Worker/ActionCommandManager.cs`
// (`TryProcessCommand` tries `TryParseV2`, then `TryParse`):
//
// - V2 (`TryParseV2`): `message.TrimStart()` with .NET's whitespace (which includes U+0085), then `StartsWith("::")`.
// - legacy (`TryParse`): `message.IndexOf("##[")`, the `Prefix` constant, so `##[` is a command WHEREVER it occurs in
//   the line, not only at its start. A bare `##` with no `[` straight after it is not a command, so a markdown
//   `## Heading` is safe and must be left alone.
//
// Neutralizing therefore puts a zero-width space (U+200B, which .NET does not count as whitespace) in front of a line
// that starts with `::` after its whitespace, and between `##` and `[` at EVERY occurrence of `##[`.

/** V2: after leading .NET whitespace, which is JavaScript's `\s` plus U+0085, the line starts with `::`. */
const V2 = /^[\s\u0085]*::/;

/** Legacy: `##[` anywhere. */
const LEGACY = /##\[/g;

/** The runner's line breaks: it splits at a lone CR as well as at LF and CRLF. */
const LINE_BREAK = /\r\n|\r|\n/;

/** U+200B, written by code point so the source carries no invisible character. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/**
 * Make a line of text safe to put in a log: neither runner parser can read it as a command any more.
 */
const neutralize = (line: string): string => {
	const legacy = line.replace(LEGACY, `##${ZERO_WIDTH_SPACE}[`);
	return V2.test(legacy) ? `${ZERO_WIDTH_SPACE}${legacy}` : legacy;
};

/**
 * Split text at the runner's line breaks and neutralize each line a runner parser would read as a command.
 *
 * @remarks
 * Applying it twice changes nothing more: the zero-width space is not whitespace to the V2 pattern, so a line it has
 * neutralized no longer starts with `::`, and no `##[` is left for the legacy pattern. That is what lets
 * `Render.githubLog`, which neutralizes as it builds, and the facade, which neutralizes every format when the runner
 * is GitHub Actions, both apply it without a second marker.
 *
 * @internal
 */
export const neutralizeLines = (text: string): ReadonlyArray<string> => text.split(LINE_BREAK).map(neutralize);
