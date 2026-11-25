// The cmark pathological suite: the linear-time guarantee.
//
// Markdown's DoS vector is quadratic emphasis and link blowup, which the
// delimiter and bracket stacks exist to defeat. Each case here is an input
// engineered to expose that blowup, paired with the output a correctly linear
// parser produces and a wall-clock budget it must produce it within.
//
// A case that exceeds its budget is an engine defect, not a budget to raise.
// Writing and keeping this suite found six:
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
//  5. The bare link-destination scan had no paren-nesting cap, so on
//     "unclosed links B" every failed inline-link attempt scanned to the end
//     of the subject — O(n) per `]`, quadratic overall (5.2s at 30k reps,
//     4.2x per input doubling). cmark's MAX_LINK_DEST_PARENS bound
//     (`references.ts`) makes a failed attempt stop at the 33rd `(`; the
//     scaling guard below pins it linear. commonmark.js@0.31.2 has no cap
//     and shares the quadratic — the C reference is the authority here.
//  6. The "tables" case was linear but sat AT its budget (7.4s bare for 90k
//     rows): `make` on a class-typed children field re-constructs every
//     element, so the single `Table.make` re-built all 90k rows and each
//     `TableRow.make` its cells. Pointing the children fields at the real
//     one-member category unions (`MarkdownNode.ts`, see `RowContent`)
//     passes constructed instances through: 7.4s → 2.8s.
//
//  7. The email-literal postprocess mapped each match back to source by walking
//     the merged run's text nodes from the start, O(nodes) per address: a run
//     split by brackets or escapes into many nodes went quadratic. A forward
//     cursor makes it linear (guard at the bottom).
//  8. Link reference definition extraction split a paragraph's leading
//     definitions off one at a time, each re-slicing and re-scanning the
//     paragraph's line segments and searching the parent's children: a run of
//     consecutive definitions went quadratic. One pass makes it linear (guard
//     at the bottom).
//
// Three cases nest deeper than `MAX_NESTING_DEPTH` by construction and are
// REFUSED rather than parsed — a typed guard trip in milliseconds, which is
// the hardening posture working as designed rather than a hang. They are
// named below so that a case newly falling into that branch fails the suite.

import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../../src/internal/blockParser.js";
import { isGuardExceeded } from "../../src/internal/carriers.js";
import { Markdown } from "../../src/Markdown.js";
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
// coverage the same parse costs about THREE times what it costs
// uninstrumented — measured, not guessed: the calibration input below takes
// 93ms clean and ~290ms instrumented, and the heaviest case ("tables") 2.8s
// clean against 8.7s. The factor is path-dependent — materialization-heavy
// parses (most of this suite's cost) inflate ~3x while tight engine loops
// inflate ~9x (and the pre-cap destination scan measured 18x) — which is
// what the calibration exists to absorb, and why the linearity guard at the
// bottom is ratio-based instead of budgeted.
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

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

/**
 * A small input through the gfm table path — the heaviest machinery now that
 * the destination scan is capped: the suite's dominant cost is node
 * materialization, and this input is the "tables" case at 1/30th scale, so
 * the calibration and the heaviest case inflate together under
 * instrumentation. (The previous calibration input, `"[a](b".repeat(3000)`,
 * measured the then-quadratic destination scan; with the paren cap it costs
 * ~3ms and calibrates nothing.)
 */
const CALIBRATION_INPUT = "aaa\rbbb\n-\u000b\n".repeat(1000);

/** What {@link CALIBRATION_INPUT} costs uninstrumented. */
const CALIBRATION_BASELINE_MS = 93;

const speedFactor = ((): number => {
	// One warm-up pass so the measurement is not dominated by first-call
	// compilation of the parse path.
	parseBlocks(CALIBRATION_INPUT, "gfm");
	const started = cpuNow();
	parseBlocks(CALIBRATION_INPUT, "gfm");
	const elapsed = cpuNow() - started;
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
				const started = cpuNow();
				let caught: unknown;
				let html = "";
				try {
					// A case's dialect defaults to the commonmark substrate;
					// upstream's GFM-extension cases parse and render under gfm.
					html =
						testCase.dialect === "gfm"
							? renderHtml(parseBlocks(testCase.input, "gfm").root, { gfm: true })
							: renderHtml(parseBlocks(testCase.input).root);
				} catch (error) {
					caught = error;
				}
				const elapsed = cpuNow() - started;

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

	// The linearity guard for the destination-scan cap (defect 5 above).
	//
	// RATIO-BASED, deliberately: both measurements run under the same
	// instrumentation, so coverage and slow hardware cancel out where an
	// absolute budget would not. Without `MAX_LINK_DESTINATION_PARENS` every
	// failed inline-link attempt in this input re-scans to the end of the
	// subject, and quadrupling the input costs ~16x (measured
	// 303ms/1278ms/4842ms at 7.5k/15k/30k reps); linear costs ~4x. The
	// sizes (20k/80k reps) make the small side cost tens of milliseconds — at
	// the old 7.5k it was under one, and load alone pushed the ratio to 8-13x
	// (#1281) — and each size takes the minimum of five samples.
	//
	// The clock is CPU time (`process.cpuUsage`), not wall time: a pause from
	// load descheduling the process is wall time the parse never spent, and the
	// large side, long enough to be preempted more, absorbs more of it than the
	// small. Measured with twelve busy loops beside the run, wall ratios were
	// 9.8-13.8x and CPU ratios 5.3-6.1x (unloaded: ~4.3x either way). That is
	// safe because vitest runs each test file in its own forked process, so
	// no other test's CPU lands in this one. The threshold of 8 sits between
	// linear and the ~16x quadratic with margin on both sides. Watched red
	// against the uncapped scan.
	it(
		"unclosed links B scales linearly",
		() => {
			const timeAt = (reps: number): number => {
				const input = "[a](b".repeat(reps);
				// The minimum of several samples: a GC or scheduler pause only ever
				// ADDS time to a sample, so the fastest is the least-disturbed
				// estimate, and it cannot hide an algorithmic blowup (every sample
				// of a quadratic parse is slow).
				let best = Number.POSITIVE_INFINITY;
				for (let pass = 0; pass < 5; pass += 1) {
					const started = cpuNow();
					parseBlocks(input);
					best = Math.min(best, cpuNow() - started);
				}
				return best;
			};

			// Warm the path so the small measurement is not first-call cost.
			timeAt(2000);
			// The small side does tens of milliseconds of real work, so a pause of
			// a few milliseconds is noise on it rather than the measurement.
			const small = timeAt(20000);
			const large = timeAt(80000);
			// Floor the denominator anyway, for a pathologically fast machine.
			const ratio = large / Math.max(small, 1);
			assert.isBelow(
				ratio,
				8,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms); ` +
					"linear is ~4x, the pre-cap quadratic was ~16x",
			);
		},
		// The same wall-clock ceiling the vendored cases get (their shared
		// TIMEOUT_MS is 8000): generous against instrumented linear cost —
		// two orders of magnitude of headroom — while anything worse than
		// the measured quadratic fails HERE instead of grinding the runner.
		8000 * 40 + 5000,
	);

	// The linearity guard for definition extraction (defect 8). A paragraph's leading definitions were split off one
	// at a time, each re-slicing the paragraph's per-line segments, re-scanning them for its source offsets and
	// splicing its node in by a search of the parent's children: O(definitions) per definition. 20k consecutive
	// definitions took 1.5s, ~14x per input quadrupling. One pass with a forward segment cursor and one splice makes
	// it linear. Same method and threshold as the guards above.
	it(
		"consecutive link reference definitions scale linearly",
		() => {
			const timeAt = (reps: number): number => {
				const input = Array.from({ length: reps }, (_, index) => `[r${index}]: /u${index}\n`).join("");
				let best = Number.POSITIVE_INFINITY;
				for (let pass = 0; pass < 5; pass += 1) {
					const started = cpuNow();
					parseBlocks(input, "gfm");
					best = Math.min(best, cpuNow() - started);
				}
				return best;
			};
			timeAt(500);
			const small = timeAt(2500);
			const large = timeAt(10000);
			const ratio = large / Math.max(small, 1);
			assert.isBelow(
				ratio,
				8,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms); ` +
					"linear is ~4x, the per-definition re-slice was ~16x",
			);
		},
		8000 * 40 + 5000,
	);

	// The linearity guard for the email-literal postprocess (defect 7). The postprocess maps each match's offsets in a
	// merged run of text nodes back to source; that lookup walked the run's nodes from the start on every call, so a
	// run that brackets or escapes split into many nodes cost O(nodes) per address: 20k reps of `[a] b@c.de ` took
	// 5.6s, ~16x per input quadrupling. A forward cursor over the nodes makes the mapping linear. Same method and
	// threshold as the guard above.
	it(
		"email literals in a run of many text nodes scale linearly",
		() => {
			const timeAt = (reps: number): number => {
				const input = "[a] b@c.de ".repeat(reps);
				let best = Number.POSITIVE_INFINITY;
				for (let pass = 0; pass < 5; pass += 1) {
					const started = cpuNow();
					parseBlocks(input, "gfm");
					best = Math.min(best, cpuNow() - started);
				}
				return best;
			};
			timeAt(500);
			const small = timeAt(2500);
			const large = timeAt(10000);
			const ratio = large / Math.max(small, 1);
			assert.isBelow(
				ratio,
				8,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms); ` +
					"linear is ~4x, the per-call node walk was ~16x",
			);
		},
		8000 * 40 + 5000,
	);

	// The linearity guard for one long paragraph of inline nodes, two paths of it. Each node's position maps its
	// index in the paragraph's content back to the source through the paragraph's segments, one per line, and a scan
	// from the first segment cost O(lines) per node. And each link's emphasis pass walked the delimiter stack from its
	// top for the first delimiter above the link's opener, passing it when there was none and running to the stack's
	// base, every earlier line's emphasis delimiters still open there. Before both fixes 4x the lines cost 14.7x here
	// under coverage (61/212/727ms at 4k/8k/16k lines uninstrumented for the first path alone). Same clock, sampling
	// and threshold as the guard above.
	it(
		"a long paragraph of inline nodes scales linearly",
		() => {
			const timeAt = (lines: number): number => {
				const input = "*a* [b](/u) c\n".repeat(lines);
				let best = Number.POSITIVE_INFINITY;
				for (let pass = 0; pass < 5; pass += 1) {
					const started = cpuNow();
					Markdown.parseResult(input);
					best = Math.min(best, cpuNow() - started);
				}
				return best;
			};

			timeAt(1000);
			const small = timeAt(4000);
			const large = timeAt(16000);
			const ratio = large / Math.max(small, 1);
			assert.isBelow(
				ratio,
				8,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms); ` +
					"linear is ~4x, the quadratic paths were ~15x",
			);
		},
		8000 * 40 + 5000,
	);
});
