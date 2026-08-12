// Comment fidelity (#127): the commentBefore / comment / spaceBefore split on
// the four node classes, the composer's FORWARD own-line attribution, blank
// line preservation, and stringifier emission across node kinds and styles.
//
// The headline gate is the systems repro: a workflow file carrying leading
// comments, trailing comments and own-line section comments roundtrips
// through YamlFormat.formatToString byte-intact (fixtures/comment-fidelity/
// workflow.yaml, a committed fixed point under indentSequences: true).

import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Yaml, YamlDocument, YamlFormat, YamlMap, YamlScalar, YamlSeq, YamlVisitor } from "../src/index.js";

const firstMap = (doc: YamlDocument): YamlMap => {
	assert.instanceOf(doc.contents, YamlMap);
	return doc.contents as YamlMap;
};

describe("comment fidelity (#127)", () => {
	describe("composer attribution", () => {
		it.effect("attributes an own-line comment FORWARD to the following pair", () =>
			Effect.gen(function* () {
				// The issue's exact case: `# section` documents `b`, not `a`.
				const doc = yield* YamlDocument.parse("a: 1\n\n# section\nb: 2\n");
				const map = firstMap(doc);
				const [a, b] = map.items;
				assert.isUndefined(a?.comment);
				assert.isUndefined(a?.commentBefore);
				assert.strictEqual(b?.commentBefore, " section");
				assert.strictEqual(b?.spaceBefore, true);
			}),
		);

		it.effect("attributes a same-line comment as the pair's trailing comment", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a: 1 # trailing a\nb: 2\n");
				const map = firstMap(doc);
				assert.strictEqual(map.items[0]?.comment, " trailing a");
				assert.isUndefined(map.items[1]?.comment);
			}),
		);

		it.effect("joins consecutive leading comment lines with a newline", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a: 1\n# line one\n# line two\nb: 2\n");
				const map = firstMap(doc);
				assert.strictEqual(map.items[1]?.commentBefore, " line one\n line two");
			}),
		);

		it.effect("preserves a blank line without comments as spaceBefore", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a: 1\n\nb: 2\n");
				const map = firstMap(doc);
				assert.isUndefined(map.items[0]?.spaceBefore);
				assert.strictEqual(map.items[1]?.spaceBefore, true);
				assert.isUndefined(map.items[1]?.commentBefore);
			}),
		);

		it.effect("own-line comments after a mapping's last entry become the mapping's trailing comment", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a:\n  b: 1\n  # end of a\nc: 2\n");
				const map = firstMap(doc);
				const aValue = map.items[0]?.value;
				assert.instanceOf(aValue, YamlMap);
				assert.strictEqual((aValue as YamlMap).comment, " end of a");
				// It must NOT have attached backward to the b pair.
				assert.isUndefined((aValue as YamlMap).items[0]?.comment);
			}),
		);

		it.effect("attributes seq item comments: own-line forward, same-line trailing", () =>
			Effect.gen(function* () {
				// A comment between `key:` and the sequence leads the VALUE node
				// (the sequence itself) — the same attachment the yaml npm
				// package uses; comments between items lead the next item.
				const doc = yield* YamlDocument.parse("steps:\n  # first step\n  - build\n  # mid\n  - test # inline\n");
				const map = firstMap(doc);
				const seq = map.items[0]?.value;
				assert.instanceOf(seq, YamlSeq);
				assert.strictEqual((seq as YamlSeq).commentBefore, " first step");
				const [first, second] = (seq as YamlSeq).items;
				assert.instanceOf(first, YamlScalar);
				assert.isUndefined((first as YamlScalar).commentBefore);
				assert.strictEqual((second as YamlScalar).commentBefore, " mid");
				assert.strictEqual((second as YamlScalar).comment, " inline");
			}),
		);

		it.effect("a key-line comment ahead of a block value stays on the pair", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a: # c\n  b: 1\n");
				const map = firstMap(doc);
				assert.strictEqual(map.items[0]?.comment, " c");
			}),
		);

		it.effect("an own-line comment between `:` and the value leads the value node", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a:\n  # note\n  1\n");
				const map = firstMap(doc);
				const value = map.items[0]?.value;
				assert.instanceOf(value, YamlScalar);
				assert.strictEqual((value as YamlScalar).commentBefore, " note");
			}),
		);

		it.effect("stores RAW post-# text: alignment, no-space and bare # survive", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("#no-space\n#   aligned\n#\na: 1\n");
				const map = firstMap(doc);
				// Reference parity: raw slices; a bare `#` stores " " so it is
				// distinguishable from an embedded blank line ("").
				assert.strictEqual(doc.comment, "no-space\n   aligned\n ");
				assert.isUndefined(map.items[0]?.commentBefore);
			}),
		);

		it.effect("embeds a blank line WITHIN a comment run; blank BEFORE the run is spaceBefore", () =>
			Effect.gen(function* () {
				const interior = yield* YamlDocument.parse("a: 1\n# one\n\n# two\nb: 2\n");
				const im = firstMap(interior);
				assert.strictEqual(im.items[1]?.commentBefore, " one\n\n two");
				assert.isUndefined(im.items[1]?.spaceBefore);

				const before = yield* YamlDocument.parse("a: 1\n\n# one\n# two\nb: 2\n");
				const bm = firstMap(before);
				assert.strictEqual(bm.items[1]?.commentBefore, " one\n two");
				assert.strictEqual(bm.items[1]?.spaceBefore, true);

				const after = yield* YamlDocument.parse("a: 1\n# one\n\nb: 2\n");
				const am = firstMap(after);
				assert.strictEqual(am.items[1]?.commentBefore, " one\n");
				assert.isUndefined(am.items[1]?.spaceBefore);
			}),
		);

		it.effect("a shallow terminal comment escapes the nested block to the next outer key", () =>
			Effect.gen(function* () {
				// Reference parity: a column-0 `# tail` after `c:`'s nested block
				// documents `e`, not the nested block — while a comment at the
				// nested content's column stays the nested map's trailing comment.
				const doc = yield* YamlDocument.parse("c:\n  d: 1\n# tail\n\ne: 3\n");
				const map = firstMap(doc);
				const cValue = map.items[0]?.value;
				assert.instanceOf(cValue, YamlMap);
				assert.isUndefined((cValue as YamlMap).comment);
				assert.strictEqual(map.items[1]?.commentBefore, " tail\n");
			}),
		);

		it.effect("joins a multi-line document header comment", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("# one\n# two\na: 1\n");
				assert.strictEqual(doc.comment, " one\n two");
			}),
		);

		it.effect("captures comments after the document end marker as commentAfter", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("a: 1\n...\n# after\n");
				assert.strictEqual(doc.commentAfter, " after");
				assert.isUndefined(doc.comment);
			}),
		);
	});

	describe("stringifier emission", () => {
		const roundtrips = (source: string, options?: { readonly indentSequences?: boolean }) =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse(source);
				const out = yield* doc.stringify(options);
				assert.strictEqual(out, source);
				// And the emission is stable: parse(out) stringifies identically.
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(options), out);
			});

		it.effect("emits leading, trailing and section comments in block mappings", () =>
			roundtrips("# doc header\n# line two\na: 1 # trailing a\n\n# section\nb: 2\n"),
		);

		it.effect("emits a mapping's trailing comment after its last entry", () =>
			roundtrips("a:\n  b: 1\n  # end of a\nc: 2\n"),
		);

		it.effect("emits blank lines preserved as spaceBefore", () => roundtrips("a: 1\n\nb: 2\n"));

		it.effect("emits raw comment text byte-intact: no-space, alignment, bare #", () =>
			roundtrips("a: 1 #tight\n#no-space\n#   aligned\n#\nb: 2\n"),
		);

		it.effect("emits blank lines within and after a comment run byte-intact", () =>
			roundtrips("a: 1\n# one\n\n# two\nb: 2\nc:\n  d: 1\n# tail\n\ne: 3\n"),
		);

		it.effect("emits key-line comments ahead of block values", () => roundtrips("a: # c\n  b: 1\n"));

		it.effect("emits the document trailing comment after the end marker", () =>
			roundtrips("a: 1\n...\n# after\n# more\n"),
		);

		it.effect("emits a value's own leading comment above the spilled value", () => roundtrips("a:\n  # note\n  1\n"));

		it.effect("emits seq item comments in block style", () =>
			roundtrips("steps:\n  # first step\n  - build\n  # mid\n  - test # inline\n", { indentSequences: true }),
		);

		it.effect("emits comment-carrying flow collections in multi-line flow layout", () =>
			Effect.gen(function* () {
				// Single-line flow cannot carry `#` comments (they would swallow
				// the closing bracket), so comment-carrying flow collections
				// re-emit in multi-line flow layout — semantics preserved.
				const doc = yield* YamlDocument.parse("m: { a: 1, # c\n  b: 2 }\n");
				const out = yield* doc.stringify();
				assert.include(out, "a: 1, # c");
				assert.include(out, "{");
				assert.deepStrictEqual(yield* Yaml.parse(out), { m: { a: 1, b: 2 } });
				// Idempotent from the second pass on.
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		it.effect("emits comment-carrying flow sequences in multi-line flow layout", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("s: [ one, # c\n  two ]\n");
				const out = yield* doc.stringify();
				assert.include(out, "# c");
				assert.include(out, "[");
				assert.deepStrictEqual(yield* Yaml.parse(out), { s: ["one", "two"] });
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		it.effect("emits comments on explicit-key spill pairs (#323 interaction)", () =>
			Effect.gen(function* () {
				const key = `pkg-a@1.0.0(${"a".repeat(1100)})`;
				const source = `# entry\n? ${key}\n: 1 # one\n`;
				const doc = yield* YamlDocument.parse(source);
				const out = yield* doc.stringify();
				assert.include(out, "# entry");
				assert.include(out, ": 1 # one");
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		it.effect("canonical mode (forceDefaultStyles) stays comment-free — the conformance contract", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("# doc\na: 1 # trailing\n\n# section\nb: 2\n");
				const out = yield* doc.stringify({ forceDefaultStyles: true });
				assert.notInclude(out, "#");
				assert.strictEqual(out, "a: 1\nb: 2\n");
			}),
		);
	});

	describe("YamlFormat.formatToString — the systems repro gate", () => {
		const fixture = readFileSync(new URL("./fixtures/comment-fidelity/workflow.yaml", import.meta.url), "utf8");

		it("roundtrips the workflow repro byte-intact (fixed point)", () => {
			const options = { indentSequences: true };
			const out = YamlFormat.formatToString(fixture, undefined, options);
			assert.strictEqual(out, fixture);
		});

		it("preserveComments keeps its name: true preserves per-node comments, false strips them", () => {
			const preserved = YamlFormat.formatToString(fixture, undefined, { indentSequences: true });
			assert.include(preserved, "# Deploy workflow");
			assert.include(preserved, "# only main");
			assert.include(preserved, "# check the repo out");
			assert.include(preserved, "# install deps");

			const stripped = YamlFormat.formatToString(fixture, undefined, {
				indentSequences: true,
				preserveComments: false,
			});
			assert.notInclude(stripped, "#");
		});

		it.effect("formatting preserves the parsed value exactly", () =>
			Effect.gen(function* () {
				const out = YamlFormat.formatToString(fixture, undefined, { indentSequences: true });
				assert.deepStrictEqual(yield* Yaml.parse(out), yield* Yaml.parse(fixture));
			}),
		);
	});

	describe("visitor", () => {
		it.effect("Comment events discriminate leading from trailing placement", () =>
			Effect.gen(function* () {
				const events = yield* Stream.runCollect(
					YamlVisitor.visit("# header\n# section\na: 1 # trailing\n...\n# tail\n"),
				);
				const comments = [...events]
					.filter((e) => e._tag === "Comment")
					.map((e) => e as { readonly text: string; readonly placement: "leading" | "trailing" });
				assert.deepStrictEqual(
					comments.map((c) => [c.placement, c.text]),
					[
						["leading", " header\n section"],
						["trailing", " trailing"],
						["trailing", " tail"],
					],
				);
			}),
		);
	});
});
