/**
 * What the runner's string comparisons skip. The runner matches `::` and `##[` with .NET's culture-sensitive
 * `StartsWith` and `IndexOf` under ICU, which treat about 960 code points as if absent: controls, format characters,
 * most combining marks, variation selectors and tag characters. So `":\u200b:"` starts with `::` to the runner and
 * `"##\u200b["` contains `##[`. This class is a superset of the set ICU ignores (measured on .NET 8, the runner's
 * runtime, by scanning every code point): every control but the whitespace ones (tab, line breaks, U+0085), every
 * format character, mark and default-ignorable code point,
 * plus the five letters and separators ICU also ignores (U+0640, U+07FA, U+180A, U+1CD3, U+FE73). A superset only
 * neutralizes more lines than strictly needed, never fewer.
 */
const IGNORED_SET = String.raw`\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\p{Cf}\p{Mn}\p{Me}\p{Mc}\p{Default_Ignorable_Code_Point}\u0640\u07FA\u180A\u1CD3\uFE73`;
const IGNORED = `[${IGNORED_SET}]`;

/**
 * V2: after leading .NET whitespace (JavaScript's `\s` plus U+0085) and anything ICU skips, the line starts `::`. The
 * leading run is ONE character class, never an alternation of two: U+FEFF is both `\s` and `\p{Cf}`, and
 * `(?:[\s]|[\p{Cf}])*` over a run of a character both branches accept backtracks exponentially on a failed match.
 */
const V2 = new RegExp(String.raw`^[\s\u0085${IGNORED_SET}]*:${IGNORED}*:`, "u");

/** Legacy: `##[` anywhere, with anything ICU skips between its three characters. */
const LEGACY = new RegExp(String.raw`(#${IGNORED}*#${IGNORED}*)\[`, "gu");

/** The runner's line breaks: it splits at a lone CR as well as at LF and CRLF. */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * U+2800 BRAILLE PATTERN BLANK, written by code point so the source carries no invisible character. It is not .NET
 * whitespace (`TrimStart` keeps it), ICU gives it a weight of its own (so `StartsWith("::")` and `IndexOf("##[")` no
 * longer match across it), it is not a default-ignorable code point (so a renderer that drops those, Ink among them,
 * keeps it), and it draws as one blank cell.
 */
const MARKER = String.fromCodePoint(0x2800);

const neutralize = (line: string): string => {
	const legacy = line.replace(LEGACY, `$1${MARKER}[`);
	return V2.test(legacy) ? `${MARKER}${legacy}` : legacy;
};

/**
 * Make text safe to write to a GitHub Actions log: no line of it can be read by the runner as a workflow command.
 *
 * @remarks
 * The runner has TWO command parsers, and a line is a command if either accepts it
 * (`actions/runner`, `src/Runner.Common/ActionCommand.cs` and `src/Runner.Worker/ActionCommandManager.cs`, where
 * `TryProcessCommand` tries `TryParseV2` and then `TryParse`):
 *
 * - **V2** (`TryParseV2`): `message.TrimStart()` with .NET's whitespace, which includes U+0085, then
 *   `StartsWith("::")`. A line like that gets a braille pattern blank (U+2800) in front of it, so it no longer starts
 *   with `::`.
 * - **Legacy** (`TryParse`): `message.IndexOf("##[")`, so `##[` is a command WHEREVER it occurs in the line, not only
 *   at its start. Every occurrence gets a braille pattern blank before the `[`.
 *
 * Both comparisons are .NET's culture-sensitive ones, and the runner runs on ICU, which skips controls, format
 * characters, most combining marks and other default-ignorable code points as if they were absent. So a zero-width
 * space is NO defence: `"\u200b::add-mask::x"` is a command to the runner, and so is `":\u200b:add-mask::x"`. Lines are
 * matched with those characters skipped, and the marker is a character ICU does weigh. Text that already carries a
 * zero-width space in front of a command is a command, and is neutralized like any other.
 *
 * A bare `##` with no `[` straight after it is not a command and is left alone, so a markdown heading is untouched.
 * Input is split at CR, LF and CRLF, as the runner splits a stream, so a lone CR starts a line.
 *
 * The result is **idempotent**: a line this has neutralized matches neither rule, so neutralizing it again changes
 * nothing. That is what lets a renderer that neutralizes as it builds and a facade that neutralizes the finished text
 * both apply it without a second marker.
 *
 * The marker is one blank cell wide, so neutralized text is one column wider per marker: a line with a V2 prefix and
 * two `##[` occurrences gains three.
 *
 * Matching is linear in the line's length for any input, so a hostile line (a long run of BOMs, say) cannot stall the
 * job that logs it.
 *
 * This does not escape a command you mean to write: that is {@link WorkflowCommand}, whose message and property
 * escaping is a different protocol. There is no detector here either, on purpose: a function that decided what is a
 * command, shipped beside the code that neutralizes it, would be the implementation's own opinion, and a test using it
 * would pin the output as its own oracle.
 *
 * @example
 * ```ts
 * import { CommandNeutralizer } from "@effected/github-commands";
 *
 * CommandNeutralizer.text("note\n::add-mask::secret\nprefix ##[error]x");
 * // the `::` line starts with U+2800 and the `##[` has one before its `[`; "note" is untouched
 * ```
 *
 * @public
 */
export class CommandNeutralizer {
	private constructor() {}

	/**
	 * Split `text` at the runner's line breaks and neutralize each line.
	 *
	 * @param text - text that is data, not a command
	 * @returns one entry per line, in order
	 */
	static lines(text: string): ReadonlyArray<string> {
		return text.split(LINE_BREAK).map(neutralize);
	}

	/**
	 * Neutralize `text` and join the lines with a line feed.
	 *
	 * @remarks
	 * Line breaks come back as LF whatever they were, which is what the runner reads them as.
	 *
	 * @param text - text that is data, not a command
	 */
	static text(text: string): string {
		return CommandNeutralizer.lines(text).join("\n");
	}
}
