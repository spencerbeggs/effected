// The re-parse equivalence property — what "canonical stringify" means
// operationally: for EVERY vendored conformance example, parsing the
// example, stringifying the tree and parsing the emission again must yield a
// render-equivalent document under the same dialect. Both sides render
// through the test writer and normalize through the P1 harness machinery, so
// the comparison isolates stringify: the first parse already passed spec
// conformance elsewhere, and any inequality here is a serialization bug.
//
// There is no skip list. The one special case is the extensions.txt crash
// regression (example 20, `<IGNORE>` expected output), which asserts
// round-trip termination the same way the conformance harness asserts parse
// termination — rendering it is meaningless on both sides of the round trip
// alike, so equivalence still holds and is still asserted.
//
// `stringify-roundtrip.hostile.test.ts` measures serialization cost against
// the design doc's ~17µs/node Schema-construction flag.

import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../../src/internal/blockParser.js";
import { stringifyTree } from "../../src/internal/stringify.js";
import type { SpecExample } from "./support/corpus.js";
import { loadGfmExtensionsExamples, loadGfmSpecExtensionExamples, loadSpecExamples } from "./support/corpus.js";
import { renderHtml } from "./support/htmlWriter.js";
import { normalizeHtml } from "./support/normalizeHtml.js";

type Dialect = "commonmark" | "gfm";

const roundTrip = (markdown: string, dialect: Dialect): { before: string; after: string; emitted: string } => {
	const gfm = dialect === "gfm";
	const first = parseBlocks(markdown, dialect).root;
	const emitted = stringifyTree(first);
	const second = parseBlocks(emitted, dialect).root;
	return {
		before: normalizeHtml(renderHtml(first, { gfm })),
		after: normalizeHtml(renderHtml(second, { gfm })),
		emitted,
	};
};

const runCorpus = (
	name: string,
	examples: ReadonlyArray<SpecExample>,
	dialect: Dialect,
	expectedCount: number,
): void => {
	describe(name, () => {
		it("carries the whole corpus", () => {
			assert.strictEqual(examples.length, expectedCount);
		});

		for (const example of examples) {
			it(`example ${example.example} (${example.section})`, () => {
				const { before, after, emitted } = roundTrip(example.markdown, dialect);
				assert.strictEqual(
					after,
					before,
					`stringify round-trip diverged.\nsource:  ${JSON.stringify(example.markdown)}\nemitted: ${JSON.stringify(emitted)}`,
				);
			});
		}
	});
};

describe("stringify re-parse equivalence", () => {
	// The 652 spec examples round-trip under BOTH dialects: stringify output
	// must not depend on constructs the reading dialect lacks.
	runCorpus("CommonMark spec under commonmark", loadSpecExamples(), "commonmark", 652);
	runCorpus("CommonMark spec under gfm", loadSpecExamples(), "gfm", 652);
	runCorpus("GFM spec extensions", loadGfmSpecExtensionExamples(), "gfm", 22);
	runCorpus("cmark-gfm extensions.txt", loadGfmExtensionsExamples(), "gfm", 30);
});
