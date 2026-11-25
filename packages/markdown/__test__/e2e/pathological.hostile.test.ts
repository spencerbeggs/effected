// The cmark pathological suite: the linear-time guarantee.
//
// Markdown's DoS vector is quadratic emphasis and link blowup, which the
// delimiter and bracket stacks exist to defeat. Each case here is an input
// engineered to expose that blowup, paired with the output a correctly linear
// parser produces. A vendored case is a fixed input, so nothing here bounds its
// time in milliseconds: it must finish inside the hostile tier's test timeout,
// and the scaling guards at the bottom hold the growth ratios.
//
// A case that does not finish is an engine defect, not a timeout to raise.
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
import { Growth } from "@effected/testing";
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

// --- no budget in milliseconds -----------------------------------------------
//
// The vendored budgets are wall clock, so they measure the machine and the
// instrumentation as much as the engine: under v8 coverage the same parse
// costs about three times what it costs uninstrumented, and tight engine loops
// about nine. An earlier version of this file scaled each budget by a
// calibration parse; that still bounded a time, and a time holds on one runner
// and fails on a loaded one. The guards at the bottom measure a ratio instead,
// both sides under the same conditions, through `Growth.measure` (#1415).

/**
 * The kit's bound for linear work: under 10, where a quadratic parse reads 16. It was 8 here, and the costliest shape
 * read 7.1x on a Linux runner where it reads 4x to 6x on macOS.
 */
const LINEAR_BOUND = 10;

/** 4x `from` of `make`'s unit against `from`: the growth ratio of the work `make` returns. */
const scaling = (make: (count: number) => () => unknown, from: number): { ratio: number; detail: string } =>
	Growth.measure(make, { from, bound: LINEAR_BOUND });

/** The deadline of a scaling guard: far above what one takes, so a guard fails on its ratio and not on this. */
const GUARD_DEADLINE_MS = 120_000;

describe("pathological inputs", () => {
	it("carries the whole vendored suite", () => {
		// The silently-empty-walk guard: an import that resolved to nothing
		// would make every test below vacuous.
		assert.isAtLeast(PATHOLOGICAL_CASES.length, 20);
	});

	// The heaviest vendored case takes about 3 s. This is a deadline, not a bound on the work: a synchronous parse
	// cannot be interrupted, so a case that regressed to tens of seconds fails late, and one that never returns runs
	// until the job is stopped. What bounds the work is the growth of each shape, further down.
	const VENDORED_DEADLINE_MS = 30_000;

	for (const testCase of PATHOLOGICAL_CASES) {
		it(
			testCase.name,
			() => {
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
			VENDORED_DEADLINE_MS,
		);
	}

	// Every vendored shape that is built by repeating a unit, measured at a count and at four times it. The vendored
	// cases above are fixed inputs: on their own they would pass a parse that had gone quadratic but still finished.
	// Left out: the three guard-refused shapes, the two inputs with nothing to repeat, the hash-collision document,
	// and "backticks", whose input is itself quadratic in its count.
	const shapes: ReadonlyArray<readonly [name: string, make: (count: number) => string, dialect?: "gfm"]> = [
		["many emph closers with no openers", (count) => "a_ ".repeat(count)],
		["many emph openers with no closers", (count) => "_a ".repeat(count)],
		["many link closers with no openers", (count) => "a]".repeat(count)],
		["many link openers with no closers", (count) => "[a".repeat(count)],
		["mismatched openers and closers", (count) => "*a_ ".repeat(count)],
		["openers and closers multiple of 3", (count) => `a**b${"c* ".repeat(count)}`],
		["link openers and emph closers", (count) => "[ a_".repeat(count)],
		["pattern [ (]( repeated", (count) => "[ (](".repeat(count)],
		["pattern ![[]() repeated", (count) => "![[]()".repeat(count)],
		["nested brackets", (count) => `${"[".repeat(count)}a${"]".repeat(count)}`],
		["unclosed links A", (count) => "[a](<b".repeat(count)],
		["unclosed <!--", (count) => `</${"<!--".repeat(count)}`],
		["tables", (count) => "aaa\rbbb\n-\u000b\n".repeat(count), "gfm"],
	];
	for (const [name, make, dialect] of shapes) {
		it(`${name} scales linearly`, () => {
			const { ratio, detail } = scaling((count) => {
				const input = make(count);
				return () => (dialect === "gfm" ? parseBlocks(input, "gfm") : parseBlocks(input));
			}, 5_000);
			assert.isBelow(
				ratio,
				LINEAR_BOUND,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${detail}); linear is ~4x`,
			);
		});
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
			const { ratio, detail } = scaling((count) => {
				const input = "[a](b".repeat(count);
				return () => parseBlocks(input);
			}, 20_000);
			assert.isBelow(
				ratio,
				LINEAR_BOUND,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${detail}); linear is ~4x, the pre-cap quadratic was ~16x`,
			);
		},
		GUARD_DEADLINE_MS,
	);

	// The linearity guard for definition extraction (defect 8). A paragraph's leading definitions were split off one
	// at a time, each re-slicing the paragraph's per-line segments, re-scanning them for its source offsets and
	// splicing its node in by a search of the parent's children: O(definitions) per definition. 20k consecutive
	// definitions took 1.5s, ~14x per input quadrupling. One pass with a forward segment cursor and one splice makes
	// it linear. Same method and threshold as the guards above.
	it(
		"consecutive link reference definitions scale linearly",
		() => {
			const { ratio, detail } = scaling((count) => {
				const input = Array.from({ length: count }, (_, index) => `[r${index}]: /u${index}\n`).join("");
				return () => parseBlocks(input, "gfm");
			}, 2_500);
			assert.isBelow(
				ratio,
				LINEAR_BOUND,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${detail}); linear is ~4x, the per-definition re-slice was ~16x`,
			);
		},
		GUARD_DEADLINE_MS,
	);

	// The linearity guard for the email-literal postprocess (defect 7). The postprocess maps each match's offsets in a
	// merged run of text nodes back to source; that lookup walked the run's nodes from the start on every call, so a
	// run that brackets or escapes split into many nodes cost O(nodes) per address: 20k reps of `[a] b@c.de ` took
	// 5.6s, ~16x per input quadrupling. A forward cursor over the nodes makes the mapping linear. Same method and
	// threshold as the guard above.
	it(
		"email literals in a run of many text nodes scale linearly",
		() => {
			const { ratio, detail } = scaling((count) => {
				const input = "[a] b@c.de ".repeat(count);
				return () => parseBlocks(input, "gfm");
			}, 2_500);
			assert.isBelow(
				ratio,
				LINEAR_BOUND,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${detail}); linear is ~4x, the per-call node walk was ~16x`,
			);
		},
		GUARD_DEADLINE_MS,
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
			const { ratio, detail } = scaling((count) => {
				const input = "*a* [b](/u) c\n".repeat(count);
				return () => Markdown.parseResult(input);
			}, 4_000);
			assert.isBelow(
				ratio,
				LINEAR_BOUND,
				`4x the input cost ${ratio.toFixed(1)}x the CPU time (${detail}); linear is ~4x, the quadratic paths were ~15x`,
			);
		},
		GUARD_DEADLINE_MS,
	);
});
