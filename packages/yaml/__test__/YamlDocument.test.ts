import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import {
	YamlAlias,
	YamlDocument,
	YamlMap,
	YamlParseError,
	YamlScalar,
	YamlSeq,
	YamlStringifyError,
} from "../src/index.js";

describe("YamlDocument", () => {
	describe("parse", () => {
		it.effect("keeps the AST, directives and framing flags", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("%YAML 1.2\n---\nname: Alice\n...\n");
				assert.instanceOf(doc.contents, YamlMap);
				assert.deepStrictEqual(
					doc.directives.map((d) => ({ name: d.name, parameters: [...d.parameters] })),
					[{ name: "YAML", parameters: ["1.2"] }],
				);
				assert.isTrue(doc.hasDocumentStart);
				assert.isTrue(doc.hasDocumentEnd);
				assert.deepStrictEqual(doc.errors, []);
			}),
		);

		it.effect("surfaces recoverable issues as warnings-as-data instead of failing", () =>
			Effect.gen(function* () {
				// A duplicate mapping key is recorded as a warning on the document;
				// only the value-level Yaml.parse promotes it under uniqueKeys.
				const doc = yield* YamlDocument.parse("a: 1\na: 2");
				assert.isTrue(doc.warnings.some((w) => w.code === "DuplicateKey"));
				assert.isAbove(doc.warnings[0]?.line ?? -1, -1);
			}),
		);

		it.effect("fails with YamlParseError on fatal diagnostics", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlDocument.parse("a: *missing"));
				assert.instanceOf(error, YamlParseError);
				assert.isTrue(error.diagnostics.some((d) => d.code === "UndefinedAlias"));
			}),
		);

		it.effect("returns an empty document for empty input", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("");
				assert.isNull(doc.contents);
				assert.deepStrictEqual(doc.errors, []);
			}),
		);
	});

	describe("parseAll", () => {
		it.effect("parses documents in order with per-document framing", () =>
			Effect.gen(function* () {
				const docs = yield* YamlDocument.parseAll("a: 1\n---\nb: 2");
				assert.strictEqual(docs.length, 2);
				assert.deepStrictEqual(docs[0]?.toValue(), { a: 1 });
				assert.deepStrictEqual(docs[1]?.toValue(), { b: 2 });
				assert.isFalse(docs[0]?.hasDocumentStart ?? true);
				assert.isTrue(docs[1]?.hasDocumentStart);
			}),
		);
	});

	describe("stringify", () => {
		it.effect("round-trips a parsed document", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("name: Alice\nage: 30\n");
				const text = yield* doc.stringify();
				const again = yield* YamlDocument.parse(text);
				assert.deepStrictEqual(again.toValue(), { name: "Alice", age: 30 });
			}),
		);

		it.effect("a synthetic AST deeper than the cap fails typed, never a stack-overflow defect", () =>
			Effect.gen(function* () {
				// The node-path stringifier (stringifyNodeLines &co.) is mutually
				// recursive with no natural bound. Parsed ASTs are composer-bounded to
				// MAX_NESTING_DEPTH (256), but a hand-built tree nested past it would
				// overflow the stack as a RangeError defect on this public boundary.
				// Nest 300 YamlSeq nodes around a scalar leaf — beyond the 256 cap.
				let contents: YamlSeq | YamlScalar = YamlScalar.make({ value: 1, style: "plain", offset: 0, length: 0 });
				for (let i = 0; i < 300; i++) {
					contents = YamlSeq.make({ items: [contents], style: "block", offset: 0, length: 0 });
				}
				const doc = YamlDocument.make({ contents, errors: [], warnings: [], directives: [] });

				const result = yield* Effect.result(doc.stringify());
				if (!Result.isFailure(result)) {
					assert.fail("a 300-deep synthetic AST must fail, not overflow the stack");
				}
				assert.instanceOf(result.failure, YamlStringifyError);
				assert.strictEqual(result.failure.diagnostics[0]?.code, "NestingDepthExceeded");
			}),
		);
	});

	describe("toValue", () => {
		it.effect("resolves anchors and aliases", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("base: &x 1\nref: *x");
				assert.deepStrictEqual(doc.toValue(), { base: 1, ref: 1 });
			}),
		);

		it.effect("returns null for empty documents", () =>
			Effect.gen(function* () {
				const doc = yield* YamlDocument.parse("");
				assert.isNull(doc.toValue());
			}),
		);
	});

	describe("schema", () => {
		it.effect("decodes text into a document and encodes it back", () =>
			Effect.gen(function* () {
				const codec = YamlDocument.schema();
				const doc = yield* Schema.decodeUnknownEffect(codec)("key: value\n");
				assert.instanceOf(doc, YamlDocument);
				assert.deepStrictEqual(doc.toValue(), { key: "value" });
				const text = yield* Schema.encodeUnknownEffect(codec)(doc);
				assert.strictEqual(text, "key: value\n");
			}),
		);

		it.effect("decode failures surface as SchemaError carrying the aggregate message", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(YamlDocument.schema())("a: *missing"));
				assert.strictEqual(error._tag, "SchemaError");
				assert.include(String(error), "YAML parse failed");
			}),
		);
	});

	describe("source spans", () => {
		it.effect("alias node spans include the * sigil so findAtOffset resolves the last name character", () =>
			Effect.gen(function* () {
				const text = "a: &anc 1\nb: *anc\n";
				const doc = yield* YamlDocument.parse(text);
				const root = doc.contents;
				if (!(root instanceof YamlMap)) {
					return assert.fail("expected a mapping root");
				}
				const alias = root.items[1]?.value;
				if (!(alias instanceof YamlAlias)) {
					return assert.fail("expected an alias value");
				}
				assert.strictEqual(text.slice(alias.offset, alias.offset + alias.length), "*anc");
				const lastNameChar = text.indexOf("*anc") + "*anc".length - 1;
				const found = root.findAtOffset(lastNameChar);
				if (Option.isNone(found)) {
					return assert.fail("findAtOffset missed the last character of the alias");
				}
				assert.strictEqual(found.value, alias);
			}),
		);
	});
});
