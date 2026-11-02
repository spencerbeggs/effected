/**
 * What the GitHub Actions runner reads as a workflow command, written from the runner's own source and imported by
 * nothing in `src/`: `actions/runner`, `src/Runner.Common/ActionCommand.cs` and
 * `src/Runner.Worker/ActionCommandManager.cs` (`TryProcessCommand`). The runner tries two parsers on every line:
 *
 * - V2 (`TryParseV2`): `message.TrimStart()` with .NET's whitespace, then `StartsWith("::")`.
 * - legacy (`TryParse`): `message.IndexOf("##[")`, the `Prefix` constant, so `##[` is a command WHEREVER it occurs in
 *   the line. A bare `##`, with no `[` straight after it, is not a command.
 *
 * Both comparisons are .NET's culture-sensitive ones, and the runner runs on ICU (it installs libicu and does not set
 * invariant globalization), where they skip the code points in {@link ICU_IGNORED} as if absent. Lines are what .NET
 * reading a stream gives: split at CRLF, CR or LF.
 *
 * It errs only towards "command": a combining mark that follows a character attaches to it in ICU, so the runner does
 * not read `"::\u0301"` as starting with `::`, but this does. Checked against .NET 8 on 20,000 random lines over the
 * characters that make, hide or break a command: it never missed a line the runner reads as a command.
 */

/** The runner's line breaks. */
export const LINE_BREAK = /\r\n|\r|\n/;

/**
 * .NET's `Char.IsWhiteSpace`, which is what `TrimStart` removes. Note U+0085 is in it and U+200B and U+FEFF are not.
 */
export const isDotNetWhitespace = (ch: string): boolean => {
	const code = ch.codePointAt(0) ?? 0;
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0x85 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000
	);
};

/**
 * The code points .NET 8's culture-sensitive `StartsWith` and `IndexOf` skip under ICU, as inclusive ranges, less CR and
 * LF (which split lines first). Measured, not derived: a probe on .NET 8 (the runner's `net8.0`) tested every code
 * point with `(c + "::x").TrimStart().StartsWith("::")`, `(":" + c + ":x")`, `("#" + c + "#[x]").IndexOf("##[")` and
 * `("##" + c + "[x]")`; all four positions skip the same set. No single code point compares equal to `:`, `#` or `[`.
 */
export const ICU_IGNORED: ReadonlyArray<readonly [number, number]> = [
	[0x0000, 0x0008],
	[0x000e, 0x001f],
	[0x007f, 0x0084],
	[0x0086, 0x009f],
	[0x00ad, 0x00ad],
	[0x034f, 0x034f],
	[0x0488, 0x0489],
	[0x0591, 0x05af],
	[0x05bd, 0x05bd],
	[0x05c4, 0x05c5],
	[0x0600, 0x0605],
	[0x0610, 0x061a],
	[0x061c, 0x061c],
	[0x0640, 0x0640],
	[0x06d6, 0x06dd],
	[0x06df, 0x06e4],
	[0x06e7, 0x06e8],
	[0x06ea, 0x06ed],
	[0x070f, 0x070f],
	[0x0740, 0x0740],
	[0x0743, 0x0744],
	[0x0747, 0x074a],
	[0x07fa, 0x07fa],
	[0x0890, 0x0891],
	[0x0898, 0x089d],
	[0x08ca, 0x08e2],
	[0x08ea, 0x08ef],
	[0x08f3, 0x08f3],
	[0x0951, 0x0952],
	[0x0f18, 0x0f19],
	[0x0f35, 0x0f35],
	[0x0f37, 0x0f37],
	[0x0f3e, 0x0f3f],
	[0x0f86, 0x0f87],
	[0x0fc6, 0x0fc6],
	[0x17b4, 0x17b5],
	[0x17d3, 0x17d3],
	[0x180a, 0x180f],
	[0x1a7f, 0x1a7f],
	[0x1b6b, 0x1b73],
	[0x1cd0, 0x1ce8],
	[0x1cf4, 0x1cf4],
	[0x1cf7, 0x1cf9],
	[0x200b, 0x200f],
	[0x202a, 0x202e],
	[0x2060, 0x2064],
	[0x2066, 0x206f],
	[0x2d7f, 0x2d7f],
	[0xa670, 0xa672],
	[0xa8e0, 0xa8f1],
	[0xfe00, 0xfe0f],
	[0xfe21, 0xfe21],
	[0xfe23, 0xfe26],
	[0xfe28, 0xfe28],
	[0xfe2a, 0xfe2d],
	[0xfe2f, 0xfe2f],
	[0xfe73, 0xfe73],
	[0xfeff, 0xfeff],
	[0xfff9, 0xfffb],
	[0x102e0, 0x102e0],
	[0x10efd, 0x10eff],
	[0x110bd, 0x110bd],
	[0x110cd, 0x110cd],
	[0x11366, 0x1136c],
	[0x11370, 0x11374],
	[0x13430, 0x13440],
	[0x13447, 0x13455],
	[0x16fe4, 0x16fe4],
	[0x1bca0, 0x1bca3],
	[0x1cf00, 0x1cf2d],
	[0x1cf30, 0x1cf46],
	[0x1d165, 0x1d169],
	[0x1d16d, 0x1d182],
	[0x1d185, 0x1d18b],
	[0x1d1aa, 0x1d1ad],
	[0x1d242, 0x1d244],
	[0x1da00, 0x1da36],
	[0x1da3b, 0x1da6c],
	[0x1da75, 0x1da75],
	[0x1da84, 0x1da84],
	[0x1da9b, 0x1da9f],
	[0x1daa1, 0x1daaf],
	[0x1e8d0, 0x1e8d6],
	[0xe0001, 0xe0001],
	[0xe0020, 0xe007f],
	[0xe0100, 0xe01ef],
];

const isIcuIgnored = (ch: string): boolean => {
	const code = ch.codePointAt(0) ?? 0;
	return ICU_IGNORED.some(([from, to]) => code >= from && code <= to);
};

/** The line as the runner's comparisons see it: every code point ICU skips removed. */
const asCompared = (text: string): string =>
	Array.from(text)
		.filter((ch) => !isIcuIgnored(ch))
		.join("");

/** Would the runner read this one line as a command, by either parser. */
export const isCommand = (line: string): boolean => {
	let i = 0;
	while (i < line.length && isDotNetWhitespace(line.charAt(i))) i++;
	return asCompared(line.slice(i)).startsWith("::") || asCompared(line).includes("##[");
};

/**
 * Would the runner's legacy parser read this one line as a command: `##[` anywhere in it, as ICU compares. The V2
 * test alone, for a line that is meant to be a command, whose data must still carry no legacy one.
 */
export const hasLegacyCommand = (line: string): boolean => asCompared(line).includes("##[");

/** The lines of `text` the runner would read as a command. */
export const commandLines = (text: string): ReadonlyArray<string> => text.split(LINE_BREAK).filter(isCommand);
