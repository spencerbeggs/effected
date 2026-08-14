/** One input on which two implementations disagreed. */
export interface Divergence<I> {
	readonly input: I;
	readonly ours: unknown;
	readonly theirs: unknown;
}

/**
 * Oracle-differential helper: run the same inputs through two implementations
 * and collect every divergence (JSON-compared; a throw records as { threw }).
 * An empty return is agreement across the corpus.
 */
export const differential = <I, O>(
	inputs: Iterable<I>,
	ours: (input: I) => O,
	theirs: (input: I) => O,
): Array<Divergence<I>> => {
	const divergences: Array<Divergence<I>> = [];
	for (const input of inputs) {
		let ourValue: unknown;
		let theirValue: unknown;
		try {
			ourValue = ours(input);
		} catch (error) {
			ourValue = { threw: String(error) };
		}
		try {
			theirValue = theirs(input);
		} catch (error) {
			theirValue = { threw: String(error) };
		}
		if (JSON.stringify(ourValue) !== JSON.stringify(theirValue)) {
			divergences.push({ input, ours: ourValue, theirs: theirValue });
		}
	}
	return divergences;
};
