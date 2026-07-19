// The GFM conformance harness, over both vendored corpora.
//
// Same shape as `commonmark-spec.e2e.test.ts`: our tree, rendered by the
// test-only HTML writer and normalized, must equal the expected HTML
// normalized the same way. Two differences, both forced by the dialect —
// parsing runs under `"gfm"`, and the writer runs with its `gfm` option so
// the tagfilter applies.
//
// `SECTIONS_GREEN` is the P1 allowlist pattern and it is deliberately still
// PARTIAL here: this file grows one entry per construct task, and the gate
// below fails if a section ever leaves it. Sections still off carry the task
// that clears them.

import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../../src/internal/blockParser.js";
import type { SpecExample } from "./support/corpus.js";
import { loadGfmExtensionsExamples, loadGfmSpecExtensionExamples } from "./support/corpus.js";
import { renderHtml } from "./support/htmlWriter.js";
import { normalizeHtml } from "./support/normalizeHtml.js";

/**
 * The GFM spec's extension sections that run today.
 *
 * Still off, with the P2 task that turns each on:
 *   - "Disallowed Raw HTML (extension)" → Task 7 (the writer's tagfilter is
 *     already in place, but the example nests a table AND a task list)
 */
const SPEC_SECTIONS_GREEN: ReadonlyArray<string> = [
	"Tables (extension)",
	"Strikethrough (extension)",
	"Autolinks (extension)",
];

/**
 * The `extensions.txt` sections that run today.
 *
 * Still off, with the P2 task that turns each on:
 *   - "HTML tag filter"                                          → Task 7
 *
 * "Interop" joins here rather than at Task 7: both its examples cross tables
 * with strikethrough and autolink literals, and nothing in them waits on a
 * construct still to come.
 */
const EXTENSIONS_SECTIONS_GREEN: ReadonlyArray<string> = [
	"Tables",
	"Table cell count mismatches",
	"Embedded pipes",
	"Oddly-formatted markers",
	"Escaping",
	"Embedded HTML",
	"Reference-style links",
	"Sequential cells",
	"Interaction with emphasis",
	"a table can be recognised when separated from a paragraph of text without an empty line",
	"Strikethroughs",
	"Autolinks",
	"Interop",
	"Task lists",
	"Footnotes",
	"When a footnote is used multiple times, we insert multiple backrefs.",
	"Footnote reference labels are href escaped",
];

/**
 * Examples inside a green section that a later task clears.
 *
 * `extensions.txt` example 20 is upstream's own crash regression and its
 * expected output is the literal `<IGNORE>` — cmark-gfm asserts only that it
 * terminates. There is nothing to compare against, so it is checked for
 * termination here instead of skipped outright.
 */
const TERMINATION_ONLY: ReadonlySet<number> = new Set([20]);

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

const runCorpus = (
	title: string,
	examples: ReadonlyArray<SpecExample>,
	green: ReadonlyArray<string>,
	expectedCount: number,
): void => {
	const sections = bySection(examples);

	describe(title, () => {
		describe("gate", () => {
			it("allowlists only sections the corpus actually has", () => {
				for (const section of green) {
					assert.isTrue(sections.has(section), `the allowlist names a section the corpus does not: ${section}`);
				}
			});

			it("runs the number of examples this task turns on", () => {
				// The silently-shrinking-corpus guard: a section quietly
				// dropping examples would otherwise still look green.
				const running = green.reduce((total, section) => total + (sections.get(section)?.length ?? 0), 0);
				assert.strictEqual(running, expectedCount);
			});
		});

		for (const section of green) {
			describe(section, () => {
				for (const example of sections.get(section) ?? []) {
					it(`example ${example.example}`, () => {
						if (TERMINATION_ONLY.has(example.example)) {
							// No expected output to compare — the assertion is
							// that rendering completes at all.
							assert.isString(renderHtml(parseBlocks(example.markdown, "gfm").root, { gfm: true }));
							return;
						}
						const actual = normalizeHtml(renderHtml(parseBlocks(example.markdown, "gfm").root, { gfm: true }));
						assert.strictEqual(actual, normalizeHtml(example.html));
					});
				}
			});
		}
	});
};

describe("GFM conformance", () => {
	runCorpus("spec.txt extension sections", loadGfmSpecExtensionExamples(), SPEC_SECTIONS_GREEN, 21);
	runCorpus("extensions.txt", loadGfmExtensionsExamples(), EXTENSIONS_SECTIONS_GREEN, 29);
});
