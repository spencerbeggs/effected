/**
 * How much input a depth-aware test reads.
 *
 * @remarks
 * `sample` is what every pull request and every local run reads: a fixed, committed slice of a corpus, or a
 * property's ordinary run count. `full` is the whole corpus and the deeper counts, run for a release and on demand.
 */
export type TestDepth = "sample" | "full";

const VARIABLE = "EFFECTED_TEST_DEPTH";

const parse = (raw: string | undefined): TestDepth => {
	if (raw === undefined || raw === "sample") return "sample";
	if (raw === "full") return "full";
	// A mistyped depth must stop the run: read as `sample`, it would pass as the full run it was meant to be.
	throw new Error(`${VARIABLE} must be "sample" or "full", or unset for "sample"; got ${JSON.stringify(raw)}`);
};

/**
 * The depth of the current test run, read from `EFFECTED_TEST_DEPTH`.
 *
 * @remarks
 * A test file that reads this is depth-aware and is named `.parity.test.ts`, `.corpus.test.ts` or
 * `.property.test.ts`, which is how the full run finds it.
 */
export const Depth: {
	/** Parses a raw value: `undefined` is `sample`, and anything but `sample` or `full` throws. */
	readonly parse: (raw: string | undefined) => TestDepth;
	/** The depth in the environment, read on every access. */
	readonly current: TestDepth;
	/** The value for the current depth. */
	readonly pick: <A>(options: { readonly sample: A; readonly full: A }) => A;
	/** Runs `run` at full depth and does nothing at sample depth. */
	readonly whenFull: (run: () => void) => void;
} = {
	parse,
	get current(): TestDepth {
		return parse(process.env[VARIABLE]);
	},
	pick: (options) => (parse(process.env[VARIABLE]) === "full" ? options.full : options.sample),
	whenFull: (run) => {
		if (parse(process.env[VARIABLE]) === "full") run();
	},
};
