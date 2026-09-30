// A short display-width implementation checked against `string-width` by a differential test; see
// okf/decisions/own-display-width.md. It embeds a hand-kept East Asian Width table that will drift from Unicode, and
// `__test__/displayWidth.oracle.test.ts` is what catches the drift.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// biome-ignore lint/suspicious/noControlCharactersInRegex: an ANSI escape starts with ESC and an OSC ends with BEL
const ANSI = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]/g;
const EMOJI = /^\p{RGI_Emoji}$/v;

const WIDE2 =
	/[\p{Emoji_Presentation}ᄀ-ᅞ〈〉☰-☷⚊-⚏⺀-⺙⺛-⻳⼀-⿕⿰-〾ぁ-ゖ゙-ヿㄅ-ㄯㄱ-ㅣㅥ-ㆎ㆐-㇥㇯-㈞㈠-㉇㉐-䶿䷀-ꒌ꒐-꓆ꥠ-ꥼ가-힣豈-﫿︐-︙︰-﹒﹔-﹦﹨-﹫！-｠￠-￦\u{16FE0}-\u{16FF6}\u{17000}-\u{191FF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1D300}-\u{1D376}\u{1F200}-\u{1F265}\u{20000}-\u{3FFFD}]/u;
const ZERO2 = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}ᅟᅠㅤﾠ]+$/u;

/**
 * The text without its ANSI escape sequences: CSI (including SGR colour) and OSC (including OSC-8 hyperlinks).
 *
 * @internal
 */
export const stripAnsi = (input: string): string => input.replace(ANSI, "");

/**
 * The display width of `input` in terminal columns: graphemes, wide East Asian characters and emoji count two,
 * combining marks, control characters and ANSI escapes count none.
 *
 * @internal
 */
export const displayWidth = (input: string): number => {
	let width = 0;
	for (const { segment } of segmenter.segment(stripAnsi(input))) {
		if (ZERO2.test(segment)) continue;
		width += EMOJI.test(segment) || /^\p{RI}{2}/u.test(segment) || WIDE2.test(Array.from(segment)[0] ?? "") ? 2 : 1;
	}
	return width;
};

/**
 * The grapheme clusters of `input`, in order; a cluster is never split.
 *
 * @internal
 */
export const graphemes = (input: string): ReadonlyArray<string> =>
	Array.from(segmenter.segment(input), (s) => s.segment);
