// Ported from @isaacs/nonrecursive-glob-match@1.1.0 (https://github.com/isaacs/nonrecursive-glob-match)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
// Port notes: src/numeric-range.ts, the range items minimatch 11.0.5's matcher
// tests a numeric brace range of 100 or more values with. One change: the
// items are built by the caller (`lit` and `digits`), so the matcher builds
// each digit class through its own `compile` (compileOrFail, at construction)
// and GlobSet can write the same alternatives as pattern text.

/**
 * The strings that the bash brace expansion `{lo..hi}` makes, as the
 * alternatives of an `@(...)` extglob. Each one is a sequence of digits and
 * digit classes, so there are only a few of them, even for a large range.
 * `lit` makes one char (a digit, or the `-` sign) and `digits` the class of
 * the digits from a to b.
 *
 * If either end has a leading zero, such as `{01..10}`, each number has
 * leading zeros to make it as long as the longer end, counting a `-` sign. So
 * `{-05..3}` makes `-05` to `-01`, then `000` to `003`.
 *
 * Returns undefined if either end is not a safe integer.
 */
export const numericRange = <I>(
	loStr: string,
	hiStr: string,
	lit: (ch: string) => I,
	digits: (a: number, b: number) => I,
): Array<Array<I>> | undefined => {
	// One digit, or a class of digits from a to b.
	const digit = (a: number, b: number): I => (a === b ? lit(String(a)) : digits(a, b));
	const prefix = (d: number, alts: Array<Array<I>>): Array<Array<I>> => alts.map((s) => [digit(d, d), ...s]);
	// The digit strings from a to b, which have the same length.
	const fixed = (a: string, b: string): Array<Array<I>> => {
		if (!a) return [[]];
		let lo = +(a[0] as string);
		let hi = +(b[0] as string);
		const ra = a.slice(1);
		const rb = b.slice(1);
		if (lo === hi) return prefix(lo, fixed(ra, rb));
		const zeros = "0".repeat(ra.length);
		const nines = "9".repeat(ra.length);
		const out: Array<Array<I>> = [];
		if (ra !== zeros) out.push(...prefix(lo++, fixed(ra, nines)));
		const last = rb === nines ? [] : prefix(hi--, fixed(zeros, rb));
		if (lo <= hi) {
			out.push([digit(lo, hi), ...Array.from(ra, () => digit(0, 9))]);
		}
		out.push(...last);
		return out;
	};
	// The numbers from a to b, where 0 <= a <= b. If width is set, each one
	// has leading zeros to make it that many digits.
	const nonneg = (a: number, b: number, width: number): Array<Array<I>> => {
		if (width) {
			return fixed(String(a).padStart(width, "0"), String(b).padStart(width, "0"));
		}
		const out: Array<Array<I>> = [];
		for (let len = String(a).length; len <= String(b).length; len++) {
			const lo = Math.max(a, len === 1 ? 0 : 10 ** (len - 1));
			const hi = Math.min(b, 10 ** len - 1);
			out.push(...fixed(String(lo), String(hi)));
		}
		return out;
	};

	let lo = Number(loStr);
	let hi = Number(hiStr);
	if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) return undefined;
	if (lo > hi) [lo, hi] = [hi, lo];
	const padded = /^-?0\d/.test(loStr) || /^-?0\d/.test(hiStr);
	const width = padded ? Math.max(loStr.length, hiStr.length) : 0;
	const out: Array<Array<I>> = [];
	if (lo < 0) {
		const neg = nonneg(Math.max(-hi, 1), -lo, width && width - 1);
		out.push(...neg.map((s): Array<I> => [lit("-"), ...s]));
	}
	if (hi >= 0) out.push(...nonneg(Math.max(lo, 0), hi, width));
	return out;
};
