/**
 * Pure edit distance and "did you mean" suggestions.
 *
 * @packageDocumentation
 */

/**
 * Options for {@link EditDistance.suggest}.
 *
 * @public
 */
export interface EditDistanceSuggestOptions {
	/**
	 * The most edits a suggestion may be away from the input; `2` by default. A function is given the input and
	 * returns the maximum for it, so the threshold can grow with a longer word. A resolved maximum that is not a
	 * non-negative integer throws a `RangeError`.
	 */
	readonly maxDistance?: number | ((input: string) => number) | undefined;
}

/**
 * The Levenshtein distance between `a` and `b` when it is at most `limit`, and `limit + 1` otherwise.
 *
 * Only the diagonal band of the matrix within `limit` of it is computed (a cell outside it is past `limit` already),
 * over two rows reused in turn, and a row whose every cell is past `limit` ends the walk, since no later row can come
 * back under it: the cost is the length of `a` times `2 * limit + 1`.
 */
const boundedDistance = (a: string, b: string, limit: number): number => {
	const over = limit + 1;
	if (Math.abs(a.length - b.length) > limit) return over;
	const n = b.length;
	const at = (row: Array<number>, j: number): number => row[j] ?? over;
	let previous: Array<number> = Array.from({ length: n + 1 }, (_, j) => (j <= limit ? j : over));
	let current: Array<number> = new Array<number>(n + 1).fill(over);
	for (let i = 1; i <= a.length; i++) {
		const lo = Math.max(1, i - limit);
		const hi = Math.min(n, i + limit);
		const edge = lo === 1 && i <= limit ? i : over;
		current[lo - 1] = edge;
		let rowMin = edge;
		for (let j = lo; j <= hi; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			const cell = Math.min(at(previous, j) + 1, at(current, j - 1) + 1, at(previous, j - 1) + cost, over);
			current[j] = cell;
			if (cell < rowMin) rowMin = cell;
		}
		if (hi < n) current[hi + 1] = over;
		if (rowMin > limit) return over;
		[previous, current] = [current, previous];
	}
	return Math.min(at(previous, n), over);
};

/**
 * Edit distance and "did you mean" as plain functions: no Effect, no IO.
 *
 * The distance is Levenshtein's (one insertion, deletion or substitution per edit), over UTF-16 code units and
 * case-sensitive.
 *
 * @public
 */
export class EditDistance {
	private constructor() {}

	/**
	 * The Levenshtein distance between `a` and `b`.
	 *
	 * @param a - the first text
	 * @param b - the second text
	 *
	 * @public
	 */
	static between(a: string, b: string): number {
		return boundedDistance(a, b, Math.max(a.length, b.length));
	}

	/**
	 * The candidates nearest to `input`, for a "did you mean" hint: those at the smallest edit distance found, up to
	 * the maximum (two edits by default), in the order given, each once. No candidate that close is `[]`.
	 *
	 * @remarks
	 * A candidate equal to `input` is at distance zero and is the only one returned. The cost is linear in the
	 * candidates' total length: a candidate whose length differs from `input`'s by more than the maximum is skipped
	 * unmeasured, and only the band of the edit matrix within the maximum of its diagonal is measured, so a long typed
	 * value cannot make it quadratic. A maximum that is not a non-negative integer is a programming mistake and throws
	 * a `RangeError`.
	 *
	 * ```ts
	 * EditDistance.suggest("stauts", ["status", "stack", "build"]) // => ["status"]
	 * ```
	 *
	 * @param input - what was typed
	 * @param candidates - the names it could have meant
	 * @param options - the most edits a suggestion may be away
	 *
	 * @public
	 */
	static suggest(
		input: string,
		candidates: Iterable<string>,
		options?: EditDistanceSuggestOptions,
	): ReadonlyArray<string> {
		const option = options?.maxDistance ?? 2;
		const max = typeof option === "function" ? option(input) : option;
		if (!Number.isInteger(max) || max < 0) {
			throw new RangeError(`EditDistance.suggest: maxDistance must be a non-negative integer, received ${max}`);
		}
		let best = max + 1;
		let found: Array<string> = [];
		for (const candidate of new Set(candidates)) {
			const distance = boundedDistance(input, candidate, Math.min(max, best));
			if (distance < best) {
				best = distance;
				found = [candidate];
			} else if (distance === best) {
				found.push(candidate);
			}
		}
		return best <= max ? found : [];
	}
}
