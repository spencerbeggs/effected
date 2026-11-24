// The display width markdownlint's MD060 measures a table row's text with: a
// port of string-width 8.3.0 (the version markdownlint 0.42.1 installs), its
// width rules over grapheme clusters, with get-east-asian-width 1.7.0's Wide
// and Fullwidth code point ranges (Unicode's EastAsianWidth W and F) as data.
// ANSI escape sequences are not stripped first, as string-width does: a
// Markdown table row holds none. Deliberately separate from cli-kit's
// internal `displayWidth` (a shorter table checked against string-width):
// this one is the exact port markdownlint parity needs.

// get-east-asian-width 1.7.0's `wideRanges` and `fullwidthRanges`: inclusive start, end pairs, sorted.
const WIDE: ReadonlyArray<number> = [
	0x1100, 0x115f, 0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ec, 0x23f0, 0x23f0, 0x23f3, 0x23f3, 0x25fd, 0x25fe,
	0x2614, 0x2615, 0x2630, 0x2637, 0x2648, 0x2653, 0x267f, 0x267f, 0x268a, 0x268f, 0x2693, 0x2693, 0x26a1, 0x26a1,
	0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26ce, 0x26d4, 0x26d4, 0x26ea, 0x26ea, 0x26f2, 0x26f3,
	0x26f5, 0x26f5, 0x26fa, 0x26fa, 0x26fd, 0x26fd, 0x2705, 0x2705, 0x270a, 0x270b, 0x2728, 0x2728, 0x274c, 0x274c,
	0x274e, 0x274e, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797, 0x27b0, 0x27b0, 0x27bf, 0x27bf, 0x2b1b, 0x2b1c,
	0x2b50, 0x2b50, 0x2b55, 0x2b55, 0x2e80, 0x2e99, 0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x2fff, 0x3001, 0x303e,
	0x3041, 0x3096, 0x3099, 0x30ff, 0x3105, 0x312f, 0x3131, 0x318e, 0x3190, 0x31e5, 0x31ef, 0x321e, 0x3220, 0x3247,
	0x3250, 0xa48c, 0xa490, 0xa4c6, 0xa960, 0xa97c, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe10, 0xfe19, 0xfe30, 0xfe52,
	0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0x16fe0, 0x16fe4, 0x16ff0, 0x16ff6, 0x17000, 0x18cda, 0x18cff, 0x18d20, 0x18d80,
	0x18df2, 0x18e00, 0x19191, 0x191a0, 0x191d2, 0x1aff0, 0x1aff3, 0x1aff5, 0x1affb, 0x1affd, 0x1affe, 0x1b000, 0x1b128,
	0x1b132, 0x1b132, 0x1b150, 0x1b152, 0x1b155, 0x1b155, 0x1b164, 0x1b168, 0x1b170, 0x1b2fb, 0x1d300, 0x1d356, 0x1d360,
	0x1d376, 0x1f004, 0x1f004, 0x1f0cf, 0x1f0cf, 0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f1ae, 0x1f1ae, 0x1f200, 0x1f202,
	0x1f210, 0x1f23b, 0x1f240, 0x1f248, 0x1f250, 0x1f251, 0x1f260, 0x1f265, 0x1f300, 0x1f320, 0x1f32d, 0x1f335, 0x1f337,
	0x1f37c, 0x1f37e, 0x1f393, 0x1f3a0, 0x1f3ca, 0x1f3cf, 0x1f3d3, 0x1f3e0, 0x1f3f0, 0x1f3f4, 0x1f3f4, 0x1f3f8, 0x1f43e,
	0x1f440, 0x1f440, 0x1f442, 0x1f4fc, 0x1f4ff, 0x1f53d, 0x1f54b, 0x1f54e, 0x1f550, 0x1f567, 0x1f57a, 0x1f57a, 0x1f595,
	0x1f596, 0x1f5a4, 0x1f5a4, 0x1f5fb, 0x1f64f, 0x1f680, 0x1f6c5, 0x1f6cc, 0x1f6cc, 0x1f6d0, 0x1f6d2, 0x1f6d5, 0x1f6d9,
	0x1f6dc, 0x1f6df, 0x1f6eb, 0x1f6ec, 0x1f6f4, 0x1f6fc, 0x1f7da, 0x1f7da, 0x1f7e0, 0x1f7eb, 0x1f7f0, 0x1f7f0, 0x1f90c,
	0x1f93a, 0x1f93c, 0x1f945, 0x1f947, 0x1f9ff, 0x1fa70, 0x1fa7c, 0x1fa80, 0x1fac6, 0x1fac8, 0x1fac8, 0x1facc, 0x1fadd,
	0x1fadf, 0x1faeb, 0x1faef, 0x1fafa, 0x20000, 0x2fffd, 0x30000, 0x3fffd,
];
const FULLWIDTH: ReadonlyArray<number> = [0x3000, 0x3000, 0xff01, 0xff60, 0xffe0, 0xffe6];

const inRanges = (ranges: ReadonlyArray<number>, codePoint: number): boolean => {
	let low = 0;
	let high = ranges.length / 2 - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (codePoint < (ranges[mid * 2] as number)) high = mid - 1;
		else if (codePoint > (ranges[mid * 2 + 1] as number)) low = mid + 1;
		else return true;
	}
	return false;
};

// get-east-asian-width's `eastAsianWidth`, ambiguous characters narrow.
const eastAsianWidth = (codePoint: number): number =>
	inRanges(FULLWIDTH, codePoint) || inRanges(WIDE, codePoint) ? 2 : 1;

const visibleCharacter =
	/[^\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Nonspacing_Mark}\p{Enclosing_Mark}\p{Surrogate}]/v;
const spacingMark = /\p{Spacing_Mark}/v;
const rgiEmoji = /^\p{RGI_Emoji}$/v;
const unqualifiedKeycap = /^[\d#*]\u20E3$/;
const extendedPictographic = /\p{Extended_Pictographic}/gu;

let segmenter: Intl.Segmenter | undefined;

const isDoubleWidthNonRgiEmojiSequence = (segment: string): boolean => {
	if (segment.length > 50) return false;
	if (unqualifiedKeycap.test(segment)) return true;
	if (segment.includes("\u200D")) return (segment.match(extendedPictographic)?.length ?? 0) >= 2;
	return false;
};

const isLeadingJamo = (codePoint: number): boolean =>
	(codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0xa960 && codePoint <= 0xa97c);
const isVowelJamo = (codePoint: number | undefined): boolean =>
	codePoint !== undefined &&
	((codePoint >= 0x1160 && codePoint <= 0x11a7) || (codePoint >= 0xd7b0 && codePoint <= 0xd7c6));
const isTrailingJamo = (codePoint: number | undefined): boolean =>
	codePoint !== undefined &&
	((codePoint >= 0x11a8 && codePoint <= 0x11ff) || (codePoint >= 0xd7cb && codePoint <= 0xd7fb));
const isJamo = (codePoint: number): boolean =>
	isLeadingJamo(codePoint) || isVowelJamo(codePoint) || isTrailingJamo(codePoint);

const hangulClusterWidth = (visible: string): number | undefined => {
	const codePoints: Array<number> = [];
	for (const character of visible) {
		if (visibleCharacter.test(character)) codePoints.push(character.codePointAt(0) as number);
	}
	if (codePoints.length === 0) return undefined;
	let width = 0;
	for (let index = 0; index < codePoints.length; index++) {
		const codePoint = codePoints[index] as number;
		if (!isJamo(codePoint)) {
			if (width === 0) return undefined;
			for (let remaining = index; remaining < codePoints.length; remaining++) {
				width += eastAsianWidth(codePoints[remaining] as number);
			}
			return width;
		}
		if (isLeadingJamo(codePoint) && isVowelJamo(codePoints[index + 1])) {
			width += 2;
			index += isTrailingJamo(codePoints[index + 2]) ? 2 : 1;
			continue;
		}
		width += eastAsianWidth(codePoint);
	}
	return width;
};

const trailingWidth = (visible: string): number => {
	let extra = 0;
	let first = true;
	for (const character of visible) {
		if (first) {
			first = false;
			continue;
		}
		if (spacingMark.test(character) || (character >= "\uFF00" && character <= "\uFFEF")) {
			extra += eastAsianWidth(character.codePointAt(0) as number);
		}
	}
	return extra;
};

// The columns one grapheme cluster takes, by string-width's rules.
const segmentWidth = (segment: string): number => {
	const index = segment.search(visibleCharacter);
	if (index === -1) return 0;
	const visible = segment.slice(index);
	if (rgiEmoji.test(segment) || isDoubleWidthNonRgiEmojiSequence(segment)) return 2;
	const hangul = hangulClusterWidth(visible);
	if (hangul !== undefined) return hangul;
	return eastAsianWidth(visible.codePointAt(0) as number) + trailingWidth(visible);
};

const printableAscii = /^[\u0020-\u007E]*$/;

/** string-width's `stringWidth(text)`: the columns `text` takes in a terminal. @internal */
export const stringWidth = (text: string): number => {
	if (text.length === 0) return 0;
	if (printableAscii.test(text)) return text.length;
	segmenter ??= new Intl.Segmenter();
	let width = 0;
	for (const { segment } of segmenter.segment(text)) width += segmentWidth(segment);
	return width;
};

/**
 * `stringWidth(text.slice(0, offset))` for each of `offsets`, with `text`
 * segmented once rather than once per prefix. A prefix ending on a grapheme
 * boundary of `text` segments as `text` does up to there (a boundary depends
 * only on the characters around it), so its width is the running sum at that
 * boundary; a prefix of printable ASCII is its length, as `stringWidth`'s own
 * fast path reads it; any other prefix is measured on its own.
 * @internal
 */
export const prefixWidths = (text: string, offsets: ReadonlyArray<number>): Array<number> => {
	const firstNonAscii = text.search(/[^\u0020-\u007E]/);
	if (firstNonAscii === -1) return offsets.map((offset) => Math.min(offset, text.length));
	segmenter ??= new Intl.Segmenter();
	const atBoundary = new Map<number, number>([[0, 0]]);
	let width = 0;
	for (const { segment, index } of segmenter.segment(text)) {
		width += segmentWidth(segment);
		atBoundary.set(index + segment.length, width);
	}
	return offsets.map((offset) =>
		offset <= firstNonAscii ? offset : (atBoundary.get(offset) ?? stringWidth(text.slice(0, offset))),
	);
};
