import { strictEqual } from "node:assert/strict";
import type { TestDepth } from "./Depth.js";
import { Depth } from "./Depth.js";

/** One named input of a corpus. */
export interface CorpusEntry {
	readonly name: string;
}

const select = <A extends CorpusEntry>(
	all: ReadonlyArray<A>,
	options: { readonly sample: ReadonlyArray<string>; readonly depth?: TestDepth },
): ReadonlyArray<A> => {
	if (options.sample.length === 0) {
		throw new Error("Corpus.select: the sample is empty, so a sample-depth run would compare nothing");
	}
	const wanted = new Set(options.sample);
	if (wanted.size !== options.sample.length) {
		const seen = new Set<string>();
		const repeated = options.sample.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
		throw new Error(`Corpus.select: duplicate sample names: ${[...new Set(repeated)].join(", ")}`);
	}
	const present = new Set(all.map((entry) => entry.name));
	const missing = options.sample.filter((name) => !present.has(name));
	// Checked at both depths: a renamed or deleted fixture must fail the run that would otherwise quietly read less.
	if (missing.length > 0) {
		throw new Error(`Corpus.select: the sample names entries the corpus does not have: ${missing.join(", ")}`);
	}
	return (options.depth ?? Depth.current) === "full" ? all : all.filter((entry) => wanted.has(entry.name));
};

const pin = (
	actual: number,
	expected: number,
	options?: { readonly label?: string; readonly depth?: TestDepth },
): void => {
	if ((options?.depth ?? Depth.current) !== "full") return;
	strictEqual(
		actual,
		expected,
		`${options?.label === undefined ? "" : `${options.label}: `}expected ${expected} over the full corpus, got ${actual}`,
	);
};

/**
 * Corpus inputs by depth.
 *
 * @remarks
 * A corpus too large to run on every pull request names a fixed sample of itself. The sample is a committed list,
 * so a failure reproduces, and an exact count over the corpus is a full-depth fact.
 */
export const Corpus: {
	/**
	 * Every entry at full depth, and the entries `sample` names at sample depth, in corpus order.
	 *
	 * @throws When `sample` is empty, repeats a name, or names an entry `all` lacks, at either depth.
	 */
	readonly select: <A extends CorpusEntry>(
		all: ReadonlyArray<A>,
		options: { readonly sample: ReadonlyArray<string>; readonly depth?: TestDepth },
	) => ReadonlyArray<A>;
	/** Asserts `actual === expected` at full depth, and nothing at sample depth. */
	readonly pin: (
		actual: number,
		expected: number,
		options?: { readonly label?: string; readonly depth?: TestDepth },
	) => void;
} = { select, pin };
