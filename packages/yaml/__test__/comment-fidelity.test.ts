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
import { Effect, Result, Stream } from "effect";
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

		it.effect("emits spaces-only comment text byte-intact: bare # and trailing-space spellings (PR #338)", () =>
			Effect.gen(function* () {
				// `#` (raw "") and `# ` (raw " ") are DIFFERENT comment spellings;
				// the all-space capture escape keeps them apart from the embedded
				// blank line encoding so every one re-emits byte-intact.
				yield* roundtrips("a: 1\n#\nb: 2\n");
				yield* roundtrips("a: 1\n# \nb: 2\n");
				yield* roundtrips("a: 1 #\n");
				yield* roundtrips("a: 1 # \n");
				yield* roundtrips("# one\n\n# two\na: 1\n");
			}),
		);

		it.effect("an empty document keeps its markers and trailing comment (PR #338)", () =>
			Effect.gen(function* () {
				yield* roundtrips("---\n...\n# tail\n");
				yield* roundtrips("---\n");
				const doc = yield* YamlDocument.parse("---\n...\n# tail\n");
				assert.isNull(doc.contents);
				assert.strictEqual(doc.commentAfter, " tail");
				assert.strictEqual(YamlFormat.formatToString("---\n...\n# tail\n"), "---\n...\n# tail\n");
			}),
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
				// Pin the exact FIRST emission (multi-line flow layout), not just
				// comment presence — see the seq own-line pin below.
				const out = yield* doc.stringify();
				assert.strictEqual(out, "m:\n  {\n    a: 1, # c\n    b: 2\n  }\n");
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
				// Pin the exact FIRST emission (multi-line flow layout), not just
				// comment presence.
				const out = yield* doc.stringify();
				assert.strictEqual(out, "s:\n  [\n    one, # c\n    two\n  ]\n");
				assert.include(out, "# c");
				assert.include(out, "[");
				assert.deepStrictEqual(yield* Yaml.parse(out), { s: ["one", "two"] });
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		it.effect("flow: an own-line comment attributes FORWARD to the next item, first emit a fixed point (PR #338)", () =>
			Effect.gen(function* () {
				// The comment sits on its own line between `a` and `b`; backward
				// attachment would render `a, # own` — which a REPARSE attributes
				// forward again, so the first emission would not be a fixed point.
				const doc = yield* YamlDocument.parse("[ a\n# own\n, b ]\n");
				const seq = doc.contents;
				assert.instanceOf(seq, YamlSeq);
				assert.strictEqual(((seq as YamlSeq).items[1] as YamlScalar).commentBefore, " own");
				const out = yield* doc.stringify();
				assert.strictEqual(out, "[\n  a,\n  # own\n  b\n]\n");
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		it.effect(
			"flow: a same-line comment still trails its item; the following own-line comment goes forward (PR #338)",
			() =>
				Effect.gen(function* () {
					const doc = yield* YamlDocument.parse("[ a # t\n# own\n, b ]\n");
					const seq = doc.contents as YamlSeq;
					assert.strictEqual((seq.items[0] as YamlScalar).comment, " t");
					assert.strictEqual((seq.items[1] as YamlScalar).commentBefore, " own");
					const out = yield* doc.stringify();
					assert.strictEqual(out, "[\n  a, # t\n  # own\n  b\n]\n");
					const again = yield* YamlDocument.parse(out);
					assert.strictEqual(yield* again.stringify(), out);
				}),
		);

		it.effect("flow: an own-line comment after the last item becomes the sequence's trailing comment (PR #338)", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("[ a,\nb\n# own\n]\n");
				const seq = doc.contents as YamlSeq;
				assert.strictEqual(seq.comment, " own");
				// Pin the exact FIRST emission — a stringifier that dropped or
				// relocated `# own` could still fixed-point on its reduced output.
				const out = yield* doc.stringify();
				assert.strictEqual(out, "[\n  a,\n  b\n  # own\n]\n");
				const again = yield* YamlDocument.parse(out);
				assert.strictEqual(yield* again.stringify(), out);
			}),
		);

		describe("flow blank-line fidelity (PR #338 review)", () => {
			// Closers sit indented past the block level so #340 strictness
			// accepts the parse. First emission is the multi-line flow
			// re-layout (expected); each pin asserts the exact first output
			// INCLUDING the blank line, then the fixed point.

			it.effect("flow seq: the blank line before an own-line comment run survives", () =>
				Effect.gen(function* () {
					const source = "a: [\n  1,\n\n  # c\n  2\n  ]\n";
					const doc = yield* YamlDocument.parse(source);
					const seq = firstMap(doc).items[0]?.value;
					assert.instanceOf(seq, YamlSeq);
					const second = (seq as YamlSeq).items[1] as YamlScalar;
					assert.strictEqual(second.commentBefore, " c");
					assert.strictEqual(second.spaceBefore, true);
					const out = YamlFormat.formatToString(source);
					assert.strictEqual(out, "a:\n  [\n    1,\n\n    # c\n    2\n  ]\n");
					assert.strictEqual(YamlFormat.formatToString(out), out);
				}),
			);

			it.effect("flow map control: the blank line before an own-line comment run stays preserved", () =>
				Effect.gen(function* () {
					const source = "m: {\n  a: 1,\n\n  # c\n  b: 2\n  }\n";
					const doc = yield* YamlDocument.parse(source);
					const map = firstMap(doc).items[0]?.value;
					assert.instanceOf(map, YamlMap);
					assert.strictEqual((map as YamlMap).items[1]?.commentBefore, " c");
					assert.strictEqual((map as YamlMap).items[1]?.spaceBefore, true);
					const out = YamlFormat.formatToString(source);
					assert.strictEqual(out, "m:\n  {\n    a: 1,\n\n    # c\n    b: 2\n  }\n");
					assert.strictEqual(YamlFormat.formatToString(out), out);
				}),
			);

			it.effect("flow seq: the blank line before the TERMINAL comment run survives as a leading embed", () =>
				Effect.gen(function* () {
					const source = "a: [\n  1,\n  2\n\n  # tail\n  ]\n";
					const doc = yield* YamlDocument.parse(source);
					const seq = firstMap(doc).items[0]?.value;
					assert.instanceOf(seq, YamlSeq);
					assert.strictEqual((seq as YamlSeq).comment, "\n tail");
					const out = YamlFormat.formatToString(source);
					assert.strictEqual(out, "a:\n  [\n    1,\n    2\n\n    # tail\n  ]\n");
					assert.strictEqual(YamlFormat.formatToString(out), out);
				}),
			);

			it.effect("flow seq: a blank WITHIN a comment run embeds as an empty line", () =>
				Effect.gen(function* () {
					const source = "a: [\n  1,\n\n  # c1\n\n  # c2\n  2\n  ]\n";
					const doc = yield* YamlDocument.parse(source);
					const seq = firstMap(doc).items[0]?.value;
					assert.instanceOf(seq, YamlSeq);
					const second = (seq as YamlSeq).items[1] as YamlScalar;
					assert.strictEqual(second.commentBefore, " c1\n\n c2");
					assert.strictEqual(second.spaceBefore, true);
					const out = YamlFormat.formatToString(source);
					assert.strictEqual(out, "a:\n  [\n    1,\n\n    # c1\n\n    # c2\n    2\n  ]\n");
					assert.strictEqual(YamlFormat.formatToString(out), out);
				}),
			);

			it.effect("flow seq nested in a block mapping keeps the blank line", () =>
				Effect.gen(function* () {
					const source = "top:\n  inner: [\n    1,\n\n    # c\n    2\n    ]\n";
					const out = YamlFormat.formatToString(source);
					assert.strictEqual(out, "top:\n  inner:\n    [\n      1,\n\n      # c\n      2\n    ]\n");
					assert.strictEqual(YamlFormat.formatToString(out), out);
					assert.deepStrictEqual(yield* Yaml.parse(out), { top: { inner: [1, 2] } });
				}),
			);
		});

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

		describe("block-scalar header comments (#341)", () => {
			// The header line is the ONE line of a block scalar that legally
			// carries a `#` comment; the lexer packs it inside the scalar's CST
			// token, so makeScalar captures it as the SCALAR's trailing comment
			// (reference `yaml` parity) and the stringifier re-emits it on the
			// header line. Each case is a byte-pinned fixed point.
			const roundtrips: ReadonlyArray<readonly [string, string]> = [
				["map literal", "a: | # hdr\n  body\n"],
				["map folded", "a: > # hdr\n  body\n"],
				["seq literal", "- | # hdr\n  body\n"],
				["seq folded", "- > # hdr\n  body\n"],
				["map strip-chomp", "a: |- # hdr\n  body\n"],
				["seq strip-chomp", "- |- # hdr\n  body\n"],
				// Explicit header indicators the value alone cannot derive
				// (CodeRabbit PR #338): a redundant keep-chomp and a redundant
				// indentation indicator both re-emit byte-intact.
				["map keep-chomp", "a: |+ # hdr\n  body\n"],
				["seq keep-chomp", "- |+ # hdr\n  body\n"],
				["map folded keep-chomp", "a: >+ # hdr\n  body\n"],
				["map indent indicator", "a: |2 # hdr\n  body\n"],
				["map folded indent indicator", "a: >2 # hdr\n  body\n"],
				["map indent indicator with keep", "a: |2+ # hdr\n  body\n"],
				["map keep-chomp bare header", "a: |+\n  body\n"],
				["map indent indicator bare header", "a: |2\n  body\n"],
			];
			for (const [name, source] of roundtrips) {
				it.effect(`roundtrips byte-intact: ${name}`, () =>
					Effect.gen(function* () {
						const doc = yield* YamlDocument.parse(source);
						const out = yield* doc.stringify();
						assert.strictEqual(out, source);
						const again = yield* YamlDocument.parse(out);
						assert.strictEqual(yield* again.stringify(), out);
					}),
				);
			}

			it.effect("captures the header comment on the SCALAR node, not the pair", () =>
				Effect.gen(function* () {
					const doc = yield* YamlDocument.parse("a: | # hdr\n  body\n");
					const pair = firstMap(doc).items[0];
					assert.isUndefined(pair?.comment);
					assert.instanceOf(pair?.value, YamlScalar);
					assert.strictEqual((pair?.value as YamlScalar).comment, " hdr");
					assert.strictEqual((pair?.value as YamlScalar).value, "body\n");
				}),
			);

			it.effect("captures a seq item's header comment on the item scalar", () =>
				Effect.gen(function* () {
					const doc = yield* YamlDocument.parse("- | # hdr\n  body\n");
					assert.instanceOf(doc.contents, YamlSeq);
					const item = (doc.contents as YamlSeq).items[0];
					assert.instanceOf(item, YamlScalar);
					assert.strictEqual((item as YamlScalar).comment, " hdr");
				}),
			);

			it.effect("emits the header comment on an explicit-key spill pair's value header", () =>
				Effect.gen(function* () {
					const key = `pkg-a@1.0.0(${"a".repeat(1100)})`;
					const source = `? ${key}\n: | # hdr\n  body\n`;
					const doc = yield* YamlDocument.parse(source);
					const out = yield* doc.stringify();
					assert.strictEqual(out, source);
					const again = yield* YamlDocument.parse(out);
					assert.strictEqual(yield* again.stringify(), out);
				}),
			);

			it.effect("emits BOTH a pair comment and a header comment, each on its own legal line", () =>
				Effect.gen(function* () {
					// The spilled form is itself legal YAML that reparses with the
					// same two comments, so it is a byte fixed point.
					const source = "a: # pair\n  | # hdr\n  body\n";
					const doc = yield* YamlDocument.parse(source);
					const pair = firstMap(doc).items[0];
					assert.strictEqual(pair?.comment, " pair");
					assert.instanceOf(pair?.value, YamlScalar);
					assert.strictEqual((pair?.value as YamlScalar).comment, " hdr");
					const out = yield* doc.stringify();
					assert.strictEqual(out, source);
					const again = yield* YamlDocument.parse(out);
					assert.strictEqual(yield* again.stringify(), out);
				}),
			);

			it.effect("a pair comment ALONE still relocates to the header line (ratified relocation)", () =>
				Effect.gen(function* () {
					const doc = yield* YamlDocument.parse("a: # pair\n  |\n  body\n");
					const out = yield* doc.stringify();
					assert.strictEqual(out, "a: | # pair\n  body\n");
					const again = yield* YamlDocument.parse(out);
					assert.strictEqual(yield* again.stringify(), out);
				}),
			);

			it.effect("captures the explicit indicators on the scalar: chomp keep and blockIndent", () =>
				Effect.gen(function* () {
					const doc = yield* YamlDocument.parse("a: |2+ # hdr\n  body\n");
					const scalar = firstMap(doc).items[0]?.value as YamlScalar;
					assert.strictEqual(scalar.chomp, "keep");
					assert.strictEqual(scalar.blockIndent, 2);
					assert.strictEqual(scalar.value, "body\n");
					// No explicit indicator → no captured field.
					const doc2 = yield* YamlDocument.parse("a: |\n  body\n");
					assert.isUndefined((firstMap(doc2).items[0]?.value as YamlScalar).blockIndent);
				}),
			);

			it.effect("an explicit indicator that no longer matches the rendered indent normalizes away", () =>
				Effect.gen(function* () {
					// blockIndent 4 with a rendered indent of 2 would lie about the
					// content columns — the header falls back to auto-detection.
					const doc = yield* YamlDocument.parse("a: |4\n    body\n");
					const scalar = firstMap(doc).items[0]?.value as YamlScalar;
					assert.strictEqual(scalar.blockIndent, 4);
					assert.strictEqual(scalar.value, "body\n");
					assert.strictEqual(yield* doc.stringify(), "a: |\n  body\n");
				}),
			);

			it.effect("a +/- inside the header comment is not a chomp indicator (regression)", () =>
				Effect.gen(function* () {
					// getBlockChomp once scanned the whole header line, so a `+` in
					// `# x+y` parsed as keep-chomp and re-emitted as `|+`, changing
					// what the document means.
					const doc = yield* YamlDocument.parse("a: | # x+y\n  body\n");
					const scalar = firstMap(doc).items[0]?.value as YamlScalar;
					assert.strictEqual(scalar.chomp, "clip");
					assert.strictEqual(yield* doc.stringify(), "a: | # x+y\n  body\n");

					const doc2 = yield* YamlDocument.parse("a: | # strip-me\n  body\n");
					assert.strictEqual((firstMap(doc2).items[0]?.value as YamlScalar).chomp, "clip");
				}),
			);

			it("survives the YamlFormat path", () => {
				const text = "a: | # hdr\n  body\nb: 1\n";
				assert.strictEqual(YamlFormat.formatToString(text), text);
			});
		});

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

	describe("blank-line fidelity — header block and terminal comment run (systems item 10)", () => {
		// Both repro shapes are CAPTURE-side embeds: a blank line adjacent to a
		// comment run stores as an empty line in the joined comment string
		// (trailing for the document header, leading for a collection's
		// terminal run), so emission needs no new state.

		it("keeps the blank line between a document-header comment block and the first key (fixed point)", () => {
			for (const text of ["# hdr\n# hdr2\n\nversion: 2\n", "# hdr\n\nversion: 2\n"]) {
				assert.strictEqual(YamlFormat.formatToString(text), text);
			}
		});

		it("keeps the blank line between a doc-header block and a `---` marker (fixed point)", () => {
			const text = "# hdr\n\n---\nversion: 2\n";
			assert.strictEqual(YamlFormat.formatToString(text), text);
		});

		it("roundtrips a dependabot-style header byte-intact (fixed point)", () => {
			const fixture = readFileSync(new URL("./fixtures/comment-fidelity/dependabot.yaml", import.meta.url), "utf8");
			assert.strictEqual(YamlFormat.formatToString(fixture, undefined, { indentSequences: true }), fixture);
		});

		it.effect("captures the header's trailing blank as a trailing empty line in doc.comment", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("# hdr\n\nversion: 2\n");
				assert.strictEqual(doc.comment, " hdr\n");
			}),
		);

		it("keeps the blank line before a nested mapping's terminal comment run (claude.yml reduction, fixed point)", () => {
			for (const text of [
				"m:\n  a: 1\n\n  # c\n",
				"m:\n  a: |\n    text\n\n  # c\n",
				"m:\n  a: |\n    text\n\n  # c1\n  b: 2\n\n  # c2\n  # c3\n\n  # c4\n",
			]) {
				assert.strictEqual(YamlFormat.formatToString(text), text);
			}
		});

		it("keeps the blank line before a block sequence's terminal comment run (fixed point)", () => {
			const text = "s:\n  - 1\n\n  # c\n";
			assert.strictEqual(YamlFormat.formatToString(text, undefined, { indentSequences: true }), text);
		});

		it("controls: pre-existing blank-line shapes stay untouched", () => {
			for (const text of [
				"a: 1\n\nb: 2\n",
				"a: 1\n\n# c\nb: 2\n",
				"a: |\n  text\n\n# c\nb: 2\n",
				"# hdr\nversion: 2\n", // no blank — none invented
				"m:\n  a: 1\n  # c\n", // terminal run without a blank — none invented
				"m:\n  a: 1\n\n# tail\nnext: 2\n", // escaped-to-outer comment keeps its blank
			]) {
				assert.strictEqual(YamlFormat.formatToString(text), text);
			}
		});

		it("accepted normalizations hold: blank runs collapse to one, whitespace-only lines strip", () => {
			assert.strictEqual(YamlFormat.formatToString("a: 1\n\n\nb: 2\n"), "a: 1\n\nb: 2\n");
			assert.strictEqual(YamlFormat.formatToString("# hdr\n\n\nversion: 2\n"), "# hdr\n\nversion: 2\n");
			assert.strictEqual(YamlFormat.formatToString("a: 1\n   \nb: 2\n"), "a: 1\n\nb: 2\n");
		});
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

	// ── Format properties over the fidelity inputs ──────────────────────────
	//
	// Fixed-point fixtures pin bytes for shapes we know about; the two
	// properties below hold for EVERY fidelity input, known or not:
	// idempotence (format∘format === format — a second pass that moves is
	// rewriting content) and meaning preservation (parse∘format === parse).
	// The keep-chomp growth regression violated both while every byte fixture
	// of the day stayed green — hence properties, not more fixtures.
	describe("format properties over the fidelity inputs", () => {
		const fileFixtures: ReadonlyArray<readonly [string, string, { indentSequences?: boolean }]> = [
			[
				"workflow.yaml",
				readFileSync(new URL("./fixtures/comment-fidelity/workflow.yaml", import.meta.url), "utf8"),
				{ indentSequences: true },
			],
			[
				"dependabot.yaml",
				readFileSync(new URL("./fixtures/comment-fidelity/dependabot.yaml", import.meta.url), "utf8"),
				{ indentSequences: true },
			],
		];
		const inlineInputs: ReadonlyArray<string> = [
			"a: 1\n\n# section\nb: 2\n",
			"a: 1 # trailing a\nb: 2\n",
			"a: 1\n# line one\n# line two\nb: 2\n",
			"a: 1\n\nb: 2\n",
			"a:\n  b: 1\n  # end of a\nc: 2\n",
			"steps:\n  # first step\n  - build\n  # mid\n  - test # inline\n",
			"# hdr\n# hdr2\n\nversion: 2\n",
			"# hdr\n\n---\nversion: 2\n",
			"m:\n  a: 1\n\n  # c\n",
			"m:\n  a: |\n    text\n\n  # c\n",
			"m:\n  a: |\n    text\n\n  # c1\n  b: 2\n\n  # c2\n  # c3\n\n  # c4\n",
			"a: 1\n\n# c\nb: 2\n",
			"a: |\n  text\n\n# c\nb: 2\n",
			"m:\n  a: 1\n\n# tail\nnext: 2\n",
			"a: |+\n  text\n\nb: 1\n",
			"a: >+\n  text\n\n# tail\n",
			"# header\n# section\na: 1 # trailing\n...\n# tail\n",
		];

		for (const [name, fixture, options] of fileFixtures) {
			it(`idempotence + meaning preservation — ${name}`, () => {
				const once = YamlFormat.formatToString(fixture, undefined, options);
				assert.strictEqual(YamlFormat.formatToString(once, undefined, options), once);
				assert.deepStrictEqual(Result.getOrThrow(Yaml.parseResult(once)), Result.getOrThrow(Yaml.parseResult(fixture)));
			});
		}

		for (const input of inlineInputs) {
			it(`idempotence + meaning preservation — ${JSON.stringify(input)}`, () => {
				const once = YamlFormat.formatToString(input);
				assert.strictEqual(YamlFormat.formatToString(once), once);
				assert.deepStrictEqual(
					Result.getOrThrow(Yaml.parseAllResult(once)),
					Result.getOrThrow(Yaml.parseAllResult(input)),
				);
			});
		}
	});
});
