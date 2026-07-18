// The CommonMark 0.31.2 conformance harness.
//
// One test per spec example: our tree, rendered by the test-only HTML writer
// and normalized, must equal the spec's expected HTML normalized the same way
// (the mdast-util-from-markdown precedent — the package ships no HTML).
//
// Two gates, both of which must shrink to nothing by the end of P1:
//
// - `SECTIONS_GREEN` is the inverse of a skip map. A section not listed is
//   skipped wholesale, by name, with its example count visible. It grows task
//   by task and reaches every section at Task 9.
// - `DEFERRED_EXAMPLES` is the per-example escape hatch inside an allowlisted
//   section: an example that needs a construct a later task delivers. Every
//   entry names the task that clears it, and the guard below refuses stale or
//   misfiled entries.
//
// Neither is a skip list in the standing-goal sense: nothing here is
// permanent, and Task 9 deletes both.

import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../../src/internal/blockParser.js";
import type { SpecExample } from "./support/corpus.js";
import { loadSpecExamples } from "./support/corpus.js";
import { renderHtml } from "./support/htmlWriter.js";
import { normalizeHtml } from "./support/normalizeHtml.js";

/**
 * The sections whose examples run. Task 6's gate; Tasks 7-9 widen it to all
 * twenty-six.
 */
const SECTIONS_GREEN: ReadonlyArray<string> = [
	"Tabs",
	"Precedence",
	"Thematic breaks",
	"ATX headings",
	"Setext headings",
	"Indented code blocks",
	"Fenced code blocks",
	"HTML blocks",
	"Link reference definitions",
	"Paragraphs",
	"Blank lines",
	"Block quotes",
	"List items",
	"Lists",
];

/** The P1 task that clears a deferred example. */
type ClearingTask = "task-7" | "task-8" | "task-9";

/**
 * Examples inside an allowlisted section that need a construct P1 has not
 * landed yet. Keyed by spec example number.
 */
const DEFERRED_EXAMPLES: ReadonlyMap<number, ClearingTask> = new Map<number, ClearingTask>([
	// Every remaining deferral is an inline construct. The block structure
	// each of these examples produces is already correct — what is missing is
	// the pass that turns a leaf's raw text into phrasing content.

	// Precedence
	[42, "task-8"], // a code span spanning two list markers

	// Thematic breaks
	[56, "task-9"], // ` *-*` is emphasis, not a break

	// ATX headings
	[65, "task-8"], // backslash-escaped `\##` opening
	[66, "task-9"], // emphasis inside a heading
	[76, "task-8"], // backslash-escaped closing sequences

	// Setext headings
	[80, "task-9"], // emphasis in the heading text
	[81, "task-9"], // emphasis spanning both heading lines
	[82, "task-9"], // emphasis spanning both heading lines
	[102, "task-8"], // backslash-escaped `\>`
	[106, "task-8"], // backslash-escaped `\---`

	// Fenced code blocks
	[121, "task-8"], // `` `` foo `` `` is a code span, not a fence
	[138, "task-8"], // a code span made of fence-length backtick runs
	[145, "task-8"], // a code span made of fence-length backtick runs

	// HTML blocks
	[148, "task-9"], // emphasis in a paragraph between HTML lines
	[152, "task-9"], // emphasis in a paragraph after a block
	[155, "task-9"], // emphasis in a paragraph after a block
	[167, "task-9"], // emphasis in a paragraph inside `<del>`
	[168, "task-9"], // inline `<del>` plus emphasis
	[176, "task-9"], // emphasis after a `<style>` block
	[177, "task-9"], // emphasis after a comment block
	[187, "task-8"], // an inline `<a>` tag that does not open a block
	[188, "task-9"], // emphasis inside a `<div>`

	// Link reference definitions — the definitions parse and are kept; what is
	// missing is the reference that resolves against them.
	[192, "task-9"],
	[193, "task-9"],
	[194, "task-9"],
	[195, "task-9"],
	[196, "task-9"],
	[198, "task-9"],
	[200, "task-9"],
	[201, "task-8"], // `<bar>` is inline raw HTML in a plain paragraph
	[202, "task-9"],
	[203, "task-9"],
	[204, "task-9"],
	[205, "task-9"],
	[206, "task-9"],
	[214, "task-9"],
	[215, "task-9"],
	[216, "task-9"],
	[217, "task-9"],
	[218, "task-9"],

	// Paragraphs
	[226, "task-8"], // two trailing spaces make a hard line break
]);

const bySection = (examples: ReadonlyArray<SpecExample>): ReadonlyMap<string, ReadonlyArray<SpecExample>> => {
	const sections = new Map<string, SpecExample[]>();
	for (const example of examples) {
		const bucket = sections.get(example.section);
		if (bucket === undefined) {
			sections.set(example.section, [example]);
		} else {
			bucket.push(example);
		}
	}
	return sections;
};

const examples = loadSpecExamples();
const sections = bySection(examples);

describe("CommonMark 0.31.2 conformance", () => {
	describe("gate", () => {
		it("allowlists only sections the corpus actually has", () => {
			for (const section of SECTIONS_GREEN) {
				assert.isTrue(sections.has(section), `SECTIONS_GREEN names a section the corpus does not: ${section}`);
			}
		});

		it("defers only real examples inside allowlisted sections", () => {
			const allowed = new Set(SECTIONS_GREEN);
			for (const number of DEFERRED_EXAMPLES.keys()) {
				const example = examples.find((candidate) => candidate.example === number);
				assert.isDefined(example, `DEFERRED_EXAMPLES names example ${number}, which the corpus does not have`);
				assert.isTrue(
					allowed.has(example?.section ?? ""),
					`example ${number} is deferred but its section is not allowlisted — delete the entry`,
				);
			}
		});
	});

	for (const [section, sectionExamples] of sections) {
		describe(section, () => {
			if (!SECTIONS_GREEN.includes(section)) {
				it.skip(`${sectionExamples.length} examples — section not yet in SECTIONS_GREEN`, () => {});
				return;
			}

			for (const example of sectionExamples) {
				const deferred = DEFERRED_EXAMPLES.get(example.example);
				if (deferred !== undefined) {
					it.skip(`example ${example.example} — deferred to ${deferred}`, () => {});
					continue;
				}

				it(`example ${example.example}`, () => {
					const actual = normalizeHtml(renderHtml(parseBlocks(example.markdown).root));
					assert.strictEqual(actual, normalizeHtml(example.html));
				});
			}
		});
	}
});
