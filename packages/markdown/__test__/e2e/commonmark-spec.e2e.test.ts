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
	"Indented code blocks",
	"Paragraphs",
	"Blank lines",
];

/** The P1 task that clears a deferred example. */
type ClearingTask = "task-7" | "task-8" | "task-9";

/**
 * Examples inside an allowlisted section that need a construct P1 has not
 * landed yet. Keyed by spec example number.
 */
const DEFERRED_EXAMPLES: ReadonlyMap<number, ClearingTask> = new Map<number, ClearingTask>([
	// Tabs — every one of these is a container-block example that happens to
	// exercise tab arithmetic; the tab handling itself is covered by the
	// examples in this section that already pass, and by the unit tests.
	[4, "task-7"], // list item, blank line, tab-indented continuation
	[5, "task-7"], // list item with a tab-indented code block
	[6, "task-7"], // blockquote with a tab-indented code block
	[7, "task-7"], // list item with a tab-indented code block
	[9, "task-7"], // three nested lists, the innermost tab-indented

	// Precedence — list markers take precedence over the code span that spans
	// two of them, so this needs both the list (7) and code spans (8).
	[42, "task-8"], // `- \`one` / `- two\``

	// Thematic breaks — the break itself is right in each of these; what is
	// missing is the construct it is being weighed against.
	[56, "task-9"], // ` *-*` is emphasis, not a break
	[57, "task-7"], // thematic break between two lists
	[59, "task-7"], // `---` as a setext underline, not a break
	[60, "task-7"], // `* * *` between two lists
	[61, "task-7"], // `- * * *` as a list item containing a break

	// ATX headings
	[65, "task-8"], // backslash-escaped `\##` opening
	[66, "task-9"], // emphasis inside a heading, plus escapes
	[76, "task-8"], // backslash-escaped closing sequences

	// Indented code blocks — the code block is right; the container is not.
	[108, "task-7"], // list-item paragraph, not code
	[109, "task-7"], // nested list, not code
	[115, "task-7"], // setext heading interleaved with code

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
