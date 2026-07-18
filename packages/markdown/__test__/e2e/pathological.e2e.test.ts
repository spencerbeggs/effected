// The cmark pathological suite: the linear-time guarantee.
//
// Markdown's DoS vector is quadratic emphasis and link blowup, which the
// delimiter and bracket stacks exist to defeat. Each case here is an input
// engineered to expose that blowup, paired with the output a correctly linear
// parser produces and a wall-clock budget it must produce it within.
//
// A case that exceeds its budget is an engine defect, not a budget to raise.
// Writing this suite found four:
//
//  1. The link-close deactivation walk scanned the whole bracket stack on
//     every close. Image openers are never popped, so `![[]()` repeated
//     accumulated them and the walk went quadratic — the case did not
//     terminate at all. Now O(1) via an active-opener count.
//  2. Raw inline HTML scanned to end-of-input looking for `-->` at every
//     opener. 300k unclosed `<!--` took 34s; a memo of "this sequence does
//     not occur past here" makes it 0.1s.
//  3. The code span walked run by run looking for its closing backticks,
//     which is quadratic in the number of runs. A backtick run index makes it
//     a binary search.
//  4. Image alt flattening recursed and died with a RangeError on deeply
//     nested content (see `hardening.test.ts`).
//
// Three cases nest deeper than `MAX_NESTING_DEPTH` by construction and are
// REFUSED rather than parsed — a typed guard trip in milliseconds, which is
// the hardening posture working as designed rather than a hang. They are
// named below so that a case newly falling into that branch fails the suite.

import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../../src/internal/blockParser.js";
import { isGuardExceeded } from "../../src/internal/carriers.js";
import { renderHtml } from "./support/htmlWriter.js";
import { PATHOLOGICAL_CASES } from "./support/pathological/cases.js";

/**
 * Cases whose input nests past the depth cap. The guard trips, so no output
 * is produced and the vendored pattern cannot match — the assertion is that
 * it trips FAST and with the right reason.
 */
const GUARD_REFUSED: ReadonlySet<string> = new Set([
	// 65000 levels of `*a **a ` nesting.
	"nested strong emph",
	// 100k nested `>`.
	"nested block quotes",
	// 1000-deep list nesting, 1000 times over.
	"deeply nested lists",
]);

// --- the budgets are relative, and they have to be --------------------------
//
// The vendored budgets are wall clock, so they measure the machine and the
// instrumentation as much as the engine. Under this repo's default v8
// coverage the same parse costs EIGHTEEN times what it costs uninstrumented —
// measured, not guessed: the calibration input below takes 63ms clean and
// 1126ms instrumented, and the largest case 4.9s clean against 114s.
//
// Asserting raw milliseconds would therefore mean "this suite passes only
// without coverage", which is a trap: it would go red in CI for a reason that
// has nothing to do with the parser. Asserting nothing would give up the
// linear-time guarantee entirely.
//
// So the suite calibrates. It times a small input through the same code path
// as the heaviest case, divides by what that costs on a clean run, and scales
// every budget by the result. A real algorithmic regression still fails —
// quadratic blowup outruns any constant factor — while instrumentation and
// slow hardware scale the calibration and the case together.

/** A small input through the link-destination path, the heaviest machinery. */
const CALIBRATION_INPUT = "[a](b".repeat(3000);

/** What {@link CALIBRATION_INPUT} costs uninstrumented. */
const CALIBRATION_BASELINE_MS = 63;

const speedFactor = ((): number => {
	// One warm-up pass so the measurement is not dominated by first-call
	// compilation of the parse path.
	parseBlocks(CALIBRATION_INPUT);
	const started = performance.now();
	parseBlocks(CALIBRATION_INPUT);
	const elapsed = performance.now() - started;
	return Math.min(Math.max(elapsed / CALIBRATION_BASELINE_MS, 1), 40);
})();

describe("pathological inputs", () => {
	it("carries the whole vendored suite", () => {
		// The silently-empty-walk guard: an import that resolved to nothing
		// would make every test below vacuous.
		assert.isAtLeast(PATHOLOGICAL_CASES.length, 20);
	});

	for (const testCase of PATHOLOGICAL_CASES) {
		it(
			testCase.name,
			() => {
				const started = performance.now();
				let caught: unknown;
				let html = "";
				try {
					html = renderHtml(parseBlocks(testCase.input).root);
				} catch (error) {
					caught = error;
				}
				const elapsed = performance.now() - started;

				// Termination first: a hang is the failure this suite exists to
				// catch, and it is a failure whichever branch the case takes.
				const budget = testCase.timeoutMs * speedFactor;
				assert.isBelow(
					elapsed,
					budget,
					`${testCase.name} took ${elapsed.toFixed(0)}ms, over its ${testCase.timeoutMs}ms budget ` +
						`scaled by ${speedFactor.toFixed(1)}x to ${budget.toFixed(0)}ms`,
				);

				if (GUARD_REFUSED.has(testCase.name)) {
					assert.isTrue(
						isGuardExceeded(caught),
						`${testCase.name} is listed as guard-refused but did not trip the guard`,
					);
					return;
				}

				assert.isUndefined(caught, `${testCase.name} threw: ${String(caught)}`);
				assert.match(html, testCase.expectedPattern);
			},
			testCase.timeoutMs * 40 + 5000,
		);
	}
});
