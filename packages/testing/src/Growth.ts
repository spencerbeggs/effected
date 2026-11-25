import { AssertionError } from "node:assert/strict";

/** How a growth measurement is sized and bounded. */
export interface GrowthOptions {
	/** The small size. The large size is `from * factor`. */
	readonly from: number;
	/** How much larger the large size is. Defaults to 4. `assertOrder` needs an explicit `bound` for any other. */
	readonly factor?: number;
	/** The ratio at or over which the check fails. */
	readonly bound?: number;
}

/** What a growth measurement found. */
export interface GrowthResult {
	/** `largeMs / smallMs`. */
	readonly ratio: number;
	/** CPU milliseconds of one run at the small size: the fastest sample. */
	readonly smallMs: number;
	/** CPU milliseconds of one run at the large size: the fastest sample. */
	readonly largeMs: number;
	/** For an assertion message, such as `12.1 ms -> 49.0 ms (4.05x, bound 10)`. */
	readonly detail: string;
}

/** A batch shorter than this is repeated: below it, CPU time is mostly clock resolution. */
const FLOOR_MS = 5;
/** Samples per size, per round. The fastest is kept: noise only ever adds time. */
const SAMPLES = 5;
/** Rounds: a ratio at or over the bound is measured again, so one pause cannot fail fast work. */
const ROUNDS = 3;
/** A workload still under the floor after this many repetitions is not measurable. */
const MAX_REPETITIONS = 200_000;
/** Once a size has been sampled for this long, it is not sampled again in the round: a slow size is already clear. */
const SAMPLING_BUDGET_MS = 1000;
/** A ratio this many times its bound is not measured again: no retry brings it back under. */
const HOPELESS = 8;
/**
 * A first run this many times slower than every later one did its work once and cached it. A compiler warming up
 * does not make a run of five milliseconds or more fifty times faster; a cache does.
 */
const CACHED = 50;

const UNMEASURED =
	"the workload could not be measured: it stays under 5 ms of CPU after 200,000 repetitions, so its ratio would " +
	"be clock noise. Give it a larger size.";

const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

/**
 * Where every run's result goes. A call whose result nothing reads is one the optimizer may drop once the loop is
 * hot, and a dropped call times as nothing: the check then reads a ratio of noise, or cannot measure at all. A
 * result stored where the rest of the program could read it has to be computed.
 */
const kept: Array<unknown> = new Array<unknown>(8).fill(undefined);

/** CPU milliseconds of `repetitions` runs. */
const batch = (run: () => unknown, repetitions: number): number => {
	const started = cpuNow();
	for (let index = 0; index < repetitions; index += 1) kept[index & 7] = run();
	const elapsed = cpuNow() - started;
	kept.fill(undefined);
	return elapsed;
};

/** The repetition count at which one batch of `run` reaches the floor, and what the very first run cost. */
const calibrate = (run: () => unknown): { readonly repetitions: number; readonly firstMs: number } => {
	let repetitions = 1;
	let firstMs = Number.NaN;
	for (;;) {
		const elapsed = batch(run, repetitions);
		if (Number.isNaN(firstMs)) firstMs = elapsed;
		if (elapsed >= FLOOR_MS) return { repetitions, firstMs };
		if (repetitions >= MAX_REPETITIONS) throw new Error(`Growth: ${UNMEASURED}`);
		const wanted = elapsed > 0 ? Math.ceil((repetitions * FLOOR_MS * 1.25) / elapsed) : repetitions * 16;
		repetitions = Math.min(MAX_REPETITIONS, Math.max(repetitions * 2, wanted));
	}
};

/** The fastest of up to `SAMPLES` batches, per run: fewer once the sampling budget is spent, and never fewer than one. */
const fastest = (run: () => unknown, repetitions: number): number => {
	let best = Number.POSITIVE_INFINITY;
	let spent = 0;
	for (let sample = 0; sample < SAMPLES && spent < SAMPLING_BUDGET_MS; sample += 1) {
		const elapsed = batch(run, repetitions);
		spent += elapsed;
		best = Math.min(best, elapsed / repetitions);
	}
	return best;
};

const wholeAndPositive = (value: number): boolean => Number.isInteger(value) && value > 0;

const measure = (
	make: (size: number) => () => unknown,
	options: GrowthOptions & { readonly bound: number },
): GrowthResult => {
	const factor = options.factor ?? 4;
	if (!wholeAndPositive(options.from)) {
		throw new Error(`Growth: from must be a positive whole number, got ${options.from}`);
	}
	if (!Number.isInteger(factor) || factor < 2) {
		throw new Error(`Growth: factor must be a whole number of at least 2, got ${factor}`);
	}
	if (!(options.bound > 1)) throw new Error(`Growth: bound must be over 1, got ${options.bound}`);
	// One run on an input of its own, thrown away: whatever the first run of this work in the process pays once
	// (modules, tables built on first use, a cold compiler) is paid here, so the first run of each measured input
	// below is slower than its later runs only if that input caches its own answer.
	kept[0] = make(options.from)();
	const small = make(options.from);
	const large = make(options.from * factor);
	// Calibration is also the warm-up: each thunk has run to its floor before any sample is kept.
	const smallCalibration = calibrate(small);
	const largeCalibration = calibrate(large);
	const smallRepetitions = smallCalibration.repetitions;
	const largeRepetitions = largeCalibration.repetitions;
	let smallMs = Number.POSITIVE_INFINITY;
	let largeMs = Number.POSITIVE_INFINITY;
	let ratio = Number.NaN;
	for (let round = 0; round < ROUNDS; round += 1) {
		smallMs = Math.min(smallMs, fastest(small, smallRepetitions));
		largeMs = Math.min(largeMs, fastest(large, largeRepetitions));
		ratio = largeMs / smallMs;
		if (!Number.isFinite(ratio) || !(smallMs > 0)) throw new Error(`Growth: ${UNMEASURED}`);
		for (const [firstMs, laterMs] of [
			[smallCalibration.firstMs, smallMs],
			[largeCalibration.firstMs, largeMs],
		] as const) {
			if (firstMs >= FLOOR_MS && laterMs * CACHED < firstMs) {
				throw new Error(
					`Growth: the work is cached after its first run (${firstMs.toFixed(3)} ms, then ${laterMs.toFixed(3)} ms), ` +
						"so later runs measure the cache and not the work. Build the work so every run does it.",
				);
			}
		}
		// A larger input at under half the cost of the smaller is not growth being measured: the two sizes did
		// different things.
		if (ratio < 0.5) {
			throw new Error(
				`Growth: the workload could not be measured: ${factor}x the size cost ${ratio.toFixed(2)}x the time ` +
					`(${smallMs.toFixed(3)} ms -> ${largeMs.toFixed(3)} ms), so the sizes are not doing the same work.`,
			);
		}
		if (ratio < options.bound || ratio >= options.bound * HOPELESS) break;
	}
	return {
		ratio,
		smallMs,
		largeMs,
		detail: `${smallMs.toFixed(3)} ms -> ${largeMs.toFixed(3)} ms at ${factor}x the size (${ratio.toFixed(2)}x, bound ${options.bound})`,
	};
};

/** The bound for an order at factor 4: linear reads about 4 and quadratic about 16, cubic about 64. */
const boundFor = (order: 1 | 2): number => (order === 1 ? 10 : 32);

const assertOrder = (
	make: (size: number) => () => unknown,
	options: GrowthOptions & { readonly order: 1 | 2 },
): GrowthResult => {
	const factor = options.factor ?? 4;
	if (options.bound === undefined && factor !== 4) {
		throw new Error(`Growth: a factor other than 4 needs an explicit bound, got factor ${factor}`);
	}
	const bound = options.bound ?? boundFor(options.order);
	const result = measure(make, { from: options.from, factor, bound });
	if (result.ratio >= bound) {
		throw new AssertionError({
			message: `grew faster than order ${options.order}: ${result.detail}`,
			actual: result.ratio,
			expected: bound,
			operator: "<",
		});
	}
	return result;
};

/**
 * One measurement of how work grows with input size.
 *
 * @remarks
 * A complexity guarantee is checked as a ratio, the time at `from * factor` against the time at `from`, because a
 * ratio holds on any runner where an elapsed-time ceiling does not. Time is CPU time of the process, user plus
 * system, which counts the collector's threads too. Each size is timed as the fastest of five samples, a sample
 * shorter than 5 ms is a batch of repetitions, and a ratio at or over the bound is measured again, up to three
 * rounds. A size that takes over a second is sampled once, and a ratio eight times its bound is not measured again,
 * so a regression to exponential work fails in about the time of two runs of it. A test file that reads this is
 * named `.hostile.test.ts`, which runs it one file at a time.
 *
 * The work `make` returns should return what it computed: its result is kept, so the optimizer cannot drop the
 * call. It must do its work on every run: work cached after the first run is refused, as is a larger size that
 * costs under half the smaller. `make` is called once more than the two sizes measured, for a warm-up run on an
 * input of its own that takes the process's one-time start-up cost. Choose the smallest `from` whose run does real work, tens of thousands of characters for a scan: a short run is
 * repeated until it can be timed, so a larger input adds no accuracy, and it makes a quadratic regression take
 * minutes to report where a small one fails in seconds.
 */
export const Growth: {
	/** CPU milliseconds this process has used: user plus system. */
	readonly cpuNow: () => number;
	/**
	 * Times `make(from)` against `make(from * factor)`. `make` builds the input and returns the work to time, so
	 * building is not timed.
	 *
	 * @throws When a size cannot be measured, or `from`, `factor` or `bound` is not usable.
	 */
	readonly measure: (
		make: (size: number) => () => unknown,
		options: GrowthOptions & { readonly bound: number },
	) => GrowthResult;
	/**
	 * Fails when work grows faster than `order`: at factor 4 the bound is 10 for order 1 and 32 for order 2.
	 *
	 * @throws An `AssertionError` when the ratio is at or over the bound, and an `Error` when it cannot be measured.
	 */
	readonly assertOrder: (
		make: (size: number) => () => unknown,
		options: GrowthOptions & { readonly order: 1 | 2 },
	) => GrowthResult;
} = { cpuNow, measure, assertOrder };
