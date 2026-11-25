// The positive control for every growth check in the kit. These run in the hostile tier on every pull request, on
// the same runner as the real checks: when that runner cannot tell a linear workload from a quadratic one, this file
// fails and says so, instead of a parser's check failing (or passing) for a reason that is not the parser.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { it as plainIt } from "vitest";
import { Growth } from "../src/index.js";

// Module-level, so the loops below have an effect the optimizer cannot drop.
let sink = 0;

const linear = (size: number): void => {
	for (let i = 0; i < size; i += 1) sink = (Math.imul(sink, 31) + i) | 0;
};

const quadratic = (size: number): void => {
	for (let i = 0; i < size; i += 1) {
		for (let j = 0; j < size; j += 1) sink = (Math.imul(sink, 31) + j) | 0;
	}
};

const cubic = (size: number): void => {
	for (let i = 0; i < size; i += 1) {
		for (let j = 0; j < size; j += 1) {
			for (let k = 0; k < size; k += 1) sink = (Math.imul(sink, 31) + k) | 0;
		}
	}
};

// A growth check repeats its workload until it can be timed, which can outlast vitest's five-second default. The
// root config gives every `.hostile.test.ts` file the `hostile` tag and its one-minute timeout; this pins that the
// tag reaches the file, because without it a check fails on a slow run for a reason that is not its ratio.
describe("the hostile tag", () => {
	plainIt("gives a test in a hostile file a one-minute timeout", ({ task }) => {
		assert.strictEqual(task.timeout, 60_000);
	});
});

describe("Growth.assertOrder", () => {
	it("passes a linear workload at order 1", { timeout: 60_000 }, () => {
		const result = Growth.assertOrder((size) => () => linear(size), { from: 200_000, order: 1 });
		assert.isBelow(result.ratio, 10);
		assert.isAbove(result.ratio, 1);
		assert.match(result.detail, /bound 10/);
	});

	it("fails a quadratic workload at order 1", { timeout: 60_000 }, () => {
		assert.throws(() => Growth.assertOrder((size) => () => quadratic(size), { from: 400, order: 1 }), /bound 10/);
	});

	it("passes a quadratic workload at order 2 and fails a cubic one", { timeout: 60_000 }, () => {
		Growth.assertOrder((size) => () => quadratic(size), { from: 400, order: 2 });
		assert.throws(() => Growth.assertOrder((size) => () => cubic(size), { from: 40, order: 2 }), /bound 32/);
	});

	// A workload too fast to time gives a ratio of noise. It must fail as unmeasured, never pass.
	it("fails when the workload cannot be measured", () => {
		assert.throws(() => Growth.assertOrder(() => () => undefined, { from: 1, order: 1 }), /could not be measured/);
	});

	// Work that caches its answer does the real work once, on the first call. Every run after that costs the same
	// small amount at both sizes, and a ratio of one looks better than linear: the check must refuse it, not pass it.
	it("fails when the work is only done on the first call: a memoized workload", { timeout: 60_000 }, () => {
		const memoized = (size: number): (() => unknown) => {
			let cached: number | undefined;
			return () => {
				if (cached === undefined) {
					quadratic(size);
					cached = size;
				} else {
					// What reading a cache costs: a little, and the same whatever the size.
					const until = Growth.cpuNow() + 0.05;
					while (Growth.cpuNow() < until) linear(100);
				}
				return cached;
			};
		};
		assert.throws(() => Growth.assertOrder(memoized, { from: 2_000, order: 1 }), /cached after its first run/);
	});

	// The first run of anything in a process pays for start-up: modules, tables built on first use, a cold compiler.
	// That is not a cache, and it must not be mistaken for one, or every cheap check would be refused.
	it("does not take a one-time start-up cost for a cache", { timeout: 60_000 }, () => {
		let started = false;
		const result = Growth.assertOrder(
			(size) => () => {
				if (!started) {
					started = true;
					quadratic(2_000);
				}
				linear(size);
			},
			{ from: 20_000, order: 1 },
		);
		assert.isBelow(result.ratio, 10);
	});

	// Both sizes often run the same code, and that code gets faster as the process warms up. Measured first and only
	// once, the small size would be timed while it was still slow and the large size after, which understates the
	// ratio: on a Linux runner a check of work that costs the same at both sizes read 0.22x. The small size is timed
	// again after the large one, so both have been timed warm.
	it("times the small size again after the large, so warm-up does not understate the ratio", {
		timeout: 60_000,
	}, () => {
		let calls = 0;
		const result = Growth.measure(
			() => () => {
				calls += 1;
				// The same work at both sizes, four times slower for the first seventy calls in the process: long enough
				// that every first timing of the small size is slow, and the large size's later timings are not.
				const until = Growth.cpuNow() + (calls <= 70 ? 1 : 0.25);
				while (Growth.cpuNow() < until) linear(100);
				return calls;
			},
			{ from: 1000, bound: 4 },
		);
		assert.isAbove(result.ratio, 0.6);
		assert.isBelow(result.ratio, 1.7);
	});

	// A larger input that costs less than a quarter of the smaller one is not a measurement of growth at all.
	it("fails when the larger size reads as cheaper than the smaller", { timeout: 60_000 }, () => {
		assert.throws(
			() => Growth.assertOrder((size) => () => linear(size > 100_000 ? 20_000 : 400_000), { from: 100_000, order: 1 }),
			/could not be measured/,
		);
	});

	it("refuses a factor other than 4 without a bound", () => {
		assert.throws(
			() => Growth.assertOrder((size) => () => linear(size), { from: 1000, factor: 8, order: 1 }),
			/explicit bound/,
		);
	});

	it("refuses a size or factor that is not a positive whole number", () => {
		assert.throws(() => Growth.assertOrder((size) => () => linear(size), { from: 0, order: 1 }), /from/);
		assert.throws(() => Growth.assertOrder((size) => () => linear(size), { from: 1.5, order: 1 }), /from/);
		assert.throws(() => Growth.measure((size) => () => linear(size), { from: 10, factor: 1, bound: 10 }), /factor/);
	});
});

describe("Growth.measure", () => {
	it("reports both timings, and builds the inputs it measures once each", { timeout: 60_000 }, () => {
		const built: Array<number> = [];
		const result = Growth.measure(
			(size) => {
				built.push(size);
				return () => linear(size);
			},
			{ from: 200_000, bound: 10 },
		);
		// The small size is built twice: once for a warm-up run that is thrown away, once to measure.
		assert.deepStrictEqual(built, [200_000, 200_000, 800_000]);
		assert.isAbove(result.smallMs, 0);
		assert.isAbove(result.largeMs, result.smallMs);
		assert.strictEqual(result.ratio, result.largeMs / result.smallMs);
	});
});

describe("Growth.measure on work far past its bound", () => {
	/** Work that takes `ms` of CPU whatever the machine, so the number of runs below does not depend on its speed. */
	const burn = (ms: number): void => {
		const until = Growth.cpuNow() + ms;
		while (Growth.cpuNow() < until) linear(1000);
	};

	// A regression from linear to exponential can make the large size take seconds a run. Measuring it again cannot
	// bring a ratio hundreds of times the bound back under it, so the measurement stops after the first round, and
	// stops sampling a slow size once it has spent a second on it.
	it("does not keep re-measuring a ratio no retry could rescue", () => {
		let largeRuns = 0;
		const result = Growth.measure(
			(size) => () => {
				if (size > 1000) largeRuns += 1;
				burn(size > 1000 ? 400 : 1);
			},
			{ from: 1000, bound: 10 },
		);
		assert.isAbove(result.ratio, 100);
		// One run to calibrate, then one round of three samples: 400 ms, 800 ms, and the third passes the one-second
		// sampling budget. Without the budget a round is five samples; without the early exit there are three rounds.
		assert.strictEqual(largeRuns, 4);
	});
});

describe("Growth.cpuNow", () => {
	it("moves forward as the process works", () => {
		const started = Growth.cpuNow();
		linear(20_000_000);
		assert.isAbove(Growth.cpuNow(), started);
	});
});

describe("a growth report", () => {
	// A ratio's margin under its bound differs by machine: one check read 4.2x on macOS and 11.9x on a Linux runner.
	// The report is how a runner says which checks are near their bounds before one of them fails.
	it("appends one line per measurement, with its sizing, its ratio and where it was asked for", () => {
		const dir = mkdtempSync(join(tmpdir(), "effected-growth-"));
		try {
			const report = join(dir, "growth.jsonl");
			const first = Growth.measure((size) => () => linear(size), { from: 200_000, bound: 10, report });
			Growth.measure((size) => () => quadratic(size), { from: 400, bound: 32, report });
			const lines = readFileSync(report, "utf8").trimEnd().split("\n");
			assert.strictEqual(lines.length, 2);
			const [one, two] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
			assert.deepStrictEqual(
				{ from: one?.from, factor: one?.factor, bound: one?.bound, ratio: one?.ratio },
				{ from: 200_000, factor: 4, bound: 10, ratio: first.ratio },
			);
			assert.strictEqual(one?.smallMs, first.smallMs);
			assert.strictEqual(one?.largeMs, first.largeMs);
			assert.isAtLeast(one?.rounds as number, 1);
			assert.match(one?.site as string, /^testing\/__test__\/Growth\.hostile\.test\.ts:\d+$/);
			assert.strictEqual(two?.bound, 32);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
