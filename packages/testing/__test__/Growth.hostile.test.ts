// The positive control for every growth check in the kit. These run in the hostile tier on every pull request, on
// the same runner as the real checks: when that runner cannot tell a linear workload from a quadratic one, this file
// fails and says so, instead of a parser's check failing (or passing) for a reason that is not the parser.

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
	it("reports both timings and builds each input once", { timeout: 60_000 }, () => {
		const built: Array<number> = [];
		const result = Growth.measure(
			(size) => {
				built.push(size);
				return () => linear(size);
			},
			{ from: 200_000, bound: 10 },
		);
		assert.deepStrictEqual(built, [200_000, 800_000]);
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
