import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Result, Schema } from "effect";
import type { JsoncModifyOptions } from "../src/index.js";
import {
	Jsonc,
	JsoncEdit,
	JsoncFormattingOptions,
	JsoncModificationError,
	JsoncModifier,
	JsoncStringifyError,
} from "../src/index.js";

const apply = (text: string, edits: ReadonlyArray<JsoncEdit>) => JsoncEdit.applyAll(text, edits);

describe("JsoncModifier", () => {
	describe("replace", () => {
		it.effect("updates an existing object property", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1 }';
				const edits = yield* JsoncModifier.modify(text, ["a"], 2);
				assert.strictEqual(apply(text, edits), '{ "a": 2 }');
			}),
		);

		it.effect("updates a nested array element", () =>
			Effect.gen(function* () {
				const text = '{ "xs": [1, 2, 3] }';
				const edits = yield* JsoncModifier.modify(text, ["xs", 1], 99);
				assert.strictEqual(apply(text, edits), '{ "xs": [1, 99, 3] }');
			}),
		);

		it.effect("preserves comments and surrounding whitespace (byte-minimal)", () =>
			Effect.gen(function* () {
				const text = '{\n  "a": 1, // keep\n  "b": 2\n}';
				const edits = yield* JsoncModifier.modify(text, ["b"], 5);
				const out = apply(text, edits);
				assert.include(out, "// keep");
				assert.include(out, '"b": 5');
			}),
		);
	});

	describe("insert", () => {
		it.effect("appends a new property after the last one", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1 }';
				const edits = yield* JsoncModifier.modify(text, ["b"], 2);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { a: 1, b: 2 });
			}),
		);

		it.effect("inserts into an empty object", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify("{}", ["a"], 1);
				assert.deepStrictEqual(yield* Jsonc.parse(apply("{}", edits)), { a: 1 });
			}),
		);
	});

	describe("delete via undefined", () => {
		it.effect("removes an object property and its comma", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1, "b": 2 }';
				const edits = yield* JsoncModifier.modify(text, ["a"], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { b: 2 });
			}),
		);

		it.effect("removes an array element", () =>
			Effect.gen(function* () {
				const text = "[1, 2, 3]";
				const edits = yield* JsoncModifier.modify(text, [1], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), [1, 3]);
			}),
		);

		it.effect("deleting a missing key is a no-op", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify('{ "a": 1 }', ["missing"], undefined);
				assert.deepStrictEqual(edits, []);
			}),
		);
	});

	describe("whole-document replace", () => {
		it.effect("replaces the entire document at the empty path", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify('{ "old": 1 }', [], { new: true });
				assert.deepStrictEqual(yield* Jsonc.parse(apply('{ "old": 1 }', edits)), { new: true });
			}),
		);
	});

	describe("quote-containing keys (navigation correctness)", () => {
		it.effect("deletes a key that contains a quote character without corrupting siblings", () =>
			Effect.gen(function* () {
				const text = '{ "a\\"b": 1, "c": 2 }';
				const edits = yield* JsoncModifier.modify(text, ['a"b'], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { c: 2 });
			}),
		);

		it.effect("replaces the value of a quote-containing key", () =>
			Effect.gen(function* () {
				const text = '{ "a\\"b": 1 }';
				const edits = yield* JsoncModifier.modify(text, ['a"b'], 42);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { 'a"b': 42 });
			}),
		);
	});

	describe("structural comma handling (never string-searched)", () => {
		it.effect("deleting a key preceded by a comma-bearing block comment does not corrupt the document", () =>
			Effect.gen(function* () {
				const text = '{ "a": 1, /* x, y */ "b": 2 }';
				const edits = yield* JsoncModifier.modify(text, ["b"], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { a: 1 });
			}),
		);

		it.effect("deleting a key after a comma-bearing line comment yields a valid document", () =>
			Effect.gen(function* () {
				// The comment sits between the separator comma and the deleted entry,
				// so it is removed with the entry — what must never happen is a cut
				// INSIDE the comment leaving a corrupt half-comment behind.
				const text = '{\n  "a": 1, // keep, please\n  "b": 2\n}';
				const edits = yield* JsoncModifier.modify(text, ["b"], undefined);
				const out = apply(text, edits);
				assert.deepStrictEqual(yield* Jsonc.parse(out), { a: 1 });
				assert.notInclude(out, "please");
			}),
		);

		it.effect("deleting the first property of a nested object leaves earlier siblings intact", () =>
			Effect.gen(function* () {
				const text = '{ "z": [1, 2], "o": { "a": 1, "b": 2 } }';
				const edits = yield* JsoncModifier.modify(text, ["o", "a"], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), { z: [1, 2], o: { b: 2 } });
			}),
		);

		it.effect("deleting the last array element leaves no dangling comma", () =>
			Effect.gen(function* () {
				const text = "[1, 2, 3]";
				const edits = yield* JsoncModifier.modify(text, [2], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), [1, 2]);
			}),
		);

		it.effect("deleting the first array element sees the separator through a comment", () =>
			Effect.gen(function* () {
				const text = "[ 1 /* c */, 2 ]";
				const edits = yield* JsoncModifier.modify(text, [0], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply(text, edits)), [2]);
			}),
		);
	});

	describe("generated content", () => {
		it.effect("JSON-escapes inserted keys containing special characters", () =>
			Effect.gen(function* () {
				const key = 'he"y\\there';
				const edits = yield* JsoncModifier.modify("{}", [key], 1);
				const parsed = yield* Jsonc.parse(apply("{}", edits));
				assert.deepStrictEqual(parsed, { [key]: 1 });
			}),
		);

		it.effect("honors insertSpaces: false in serialized values", () =>
			Effect.gen(function* () {
				const options = { formattingOptions: JsoncFormattingOptions.make({ insertSpaces: false }) };
				const edits = yield* JsoncModifier.modify("{}", ["a"], { b: 1 }, options);
				assert.include(edits[0].content, '\t"b"');
				assert.deepStrictEqual(yield* Jsonc.parse(apply("{}", edits)), { a: { b: 1 } });
			}),
		);

		it.effect("accepts formattingOptions as a plain literal, identically to an instance", () =>
			Effect.gen(function* () {
				const viaLiteral = yield* JsoncModifier.modify(
					"{}",
					["a"],
					{ b: 1 },
					{
						formattingOptions: { insertSpaces: false, tabSize: 2 },
					},
				);
				const viaInstance = yield* JsoncModifier.modify(
					"{}",
					["a"],
					{ b: 1 },
					{
						formattingOptions: JsoncFormattingOptions.make({ insertSpaces: false, tabSize: 2 }),
					},
				);
				assert.deepStrictEqual(viaLiteral, viaInstance);
				assert.include(viaLiteral[0].content, '\t"b"');
			}),
		);

		it.effect("a literal eol is honored in generated content", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify("{}", ["a"], 1, {
					formattingOptions: { eol: "\r\n" },
				});
				assert.include(edits[0].content, "\r\n");
				assert.deepStrictEqual(yield* Jsonc.parse(apply("{}", edits)), { a: 1 });
			}),
		);
	});

	// Every expectation in this block is the exact output bytes: indentation and
	// line endings are the contract under test, and a parse-equal check cannot
	// see either.
	describe("formatting of edits", () => {
		const edited = (text: string, path: ReadonlyArray<string | number>, value: unknown, options?: JsoncModifyOptions) =>
			Effect.map(JsoncModifier.modify(text, path, value, options), (edits) => apply(text, edits));

		describe("insert", () => {
			it.effect("an inserted multi-line value lands at its member's depth, with and without formattingOptions", () =>
				Effect.gen(function* () {
					const spaces = '{\n  "a": 1,\n  "deps": {\n    "x": "1"\n  }\n}\n';
					assert.strictEqual(
						yield* edited(spaces, ["deps", "catalog"], { effect: "^4" }),
						'{\n  "a": 1,\n  "deps": {\n    "x": "1",\n    "catalog": {\n      "effect": "^4"\n    }\n  }\n}\n',
					);
					const tabs = '{\n\t"private": true\n}\n';
					assert.strictEqual(
						yield* edited(
							tabs,
							["catalog"],
							{ effect: "^4" },
							{ formattingOptions: { insertSpaces: false, tabSize: 2 } },
						),
						'{\n\t"private": true,\n\t"catalog": {\n\t\t"effect": "^4"\n\t}\n}\n',
					);
				}),
			);

			it.effect("a nested object is right at every depth", () =>
				Effect.gen(function* () {
					const text = '{\n    "o": {\n        "p": 1\n    }\n}\n';
					assert.strictEqual(
						yield* edited(text, ["o", "q"], { a: { b: { c: [1] } } }),
						'{\n    "o": {\n        "p": 1,\n        "q": {\n            "a": {\n                "b": {\n                    "c": [\n                        1\n                    ]\n                }\n            }\n        }\n    }\n}\n',
					);
				}),
			);

			it.effect("an array insert of an object is indented", () =>
				Effect.gen(function* () {
					const text = '{\n  "xs": [\n    1\n  ]\n}\n';
					assert.strictEqual(
						yield* edited(text, ["xs", 1], { x: 1 }),
						'{\n  "xs": [\n    1,\n    {\n      "x": 1\n    }\n  ]\n}\n',
					);
				}),
			);

			it.effect("a tab file gets tabs with no formattingOptions", () =>
				Effect.gen(function* () {
					const text = '{\n\t"o": {\n\t\t"p": 1\n\t}\n}\n';
					assert.strictEqual(
						yield* edited(text, ["o", "q"], { r: 1 }),
						'{\n\t"o": {\n\t\t"p": 1,\n\t\t"q": {\n\t\t\t"r": 1\n\t\t}\n\t}\n}\n',
					);
				}),
			);

			it.effect("a CRLF file gets CRLF on every inserted line", () =>
				Effect.gen(function* () {
					const text = '{\r\n\t"a": 1\r\n}\r\n';
					assert.strictEqual(
						yield* edited(text, ["b"], { x: { y: 1 } }),
						'{\r\n\t"a": 1,\r\n\t"b": {\r\n\t\t"x": {\r\n\t\t\t"y": 1\r\n\t\t}\r\n\t}\r\n}\r\n',
					);
				}),
			);

			it.effect("an empty container takes its parent's line plus the document's unit", () =>
				Effect.gen(function* () {
					const text = '{\n    "a": 1,\n    "o": {}\n}\n';
					assert.strictEqual(
						yield* edited(text, ["o", "k"], { x: 1 }),
						'{\n    "a": 1,\n    "o": {\n        "k": {\n            "x": 1\n        }\n    }\n}\n',
					);
				}),
			);

			it.effect("an empty container in a CRLF file is opened with CRLF", () =>
				Effect.gen(function* () {
					const text = '{\r\n  "o": {}\r\n}\r\n';
					assert.strictEqual(yield* edited(text, ["o", "k"], 1), '{\r\n  "o": {\r\n    "k": 1\r\n  }\r\n}\r\n');
				}),
			);

			it.effect("a document with no indented line falls back to two spaces", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited("{}", ["a"], { b: 1 }), '{\n  "a": {\n    "b": 1\n  }\n}');
				}),
			);

			it.effect("an empty container spread over lines leaves no blank line or stray space", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited("{\n}\n", ["a"], 1), '{\n  "a": 1\n}\n');
					assert.strictEqual(yield* edited("{ }", ["a"], 1), '{\n  "a": 1\n}');
					assert.strictEqual(yield* edited("[\n]\n", [0], 1), "[\n  1\n]\n");
				}),
			);

			it.effect("a comment in an empty container stays above the new member", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited("{\n  // keep\n}\n", ["a"], 1), '{\n  // keep\n  "a": 1\n}\n');
					assert.strictEqual(yield* edited("{ /* keep */ }", ["a"], 1), '{ /* keep */\n  "a": 1\n}');
				}),
			);

			it.effect("the unit is not fooled by a block comment's star column", () =>
				Effect.gen(function* () {
					const text = '/*\n * header\n */\n{\n\t"o": {}\n}\n';
					assert.strictEqual(
						yield* edited(text, ["o", "k"], 1),
						'/*\n * header\n */\n{\n\t"o": {\n\t\t"k": 1\n\t}\n}\n',
					);
				}),
			);

			it.effect("an inline sibling gives no member line, so the new member takes the parent's line plus a unit", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{ "a": 1 }', ["b"], { c: 1 }), '{ "a": 1,\n  "b": {\n    "c": 1\n  } }');
				}),
			);

			it.effect("a sibling sharing its line with another still gives the member line", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n\t"a": 1, "b": 2\n}\n', ["c"], 3),
						'{\n\t"a": 1, "b": 2,\n\t"c": 3\n}\n',
					);
				}),
			);

			it.effect("explicit formattingOptions win for the unit, the sibling's line for the position", () =>
				Effect.gen(function* () {
					const text = '{\n\t"a": 1\n}\n';
					assert.strictEqual(
						yield* edited(text, ["b"], { x: 1 }, { formattingOptions: { tabSize: 4 } }),
						'{\n\t"a": 1,\n\t"b": {\n\t    "x": 1\n\t}\n}\n',
					);
					assert.strictEqual(
						yield* edited('{\n    "o": {}\n}\n', ["o", "k"], 1, { formattingOptions: { insertSpaces: false } }),
						'{\n    "o": {\n    \t"k": 1\n    }\n}\n',
					);
				}),
			);

			it.effect("an explicit eol wins over the document's", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n  "a": 1\n}\n', ["b"], { x: 1 }, { formattingOptions: { eol: "\r\n" } }),
						'{\n  "a": 1,\r\n  "b": {\r\n    "x": 1\r\n  }\n}\n',
					);
				}),
			);

			it.effect("eol-only formattingOptions still infer the unit", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n\t"a": 1\n}\n', ["b"], { x: 1 }, { formattingOptions: { eol: "\n" } }),
						'{\n\t"a": 1,\n\t"b": {\n\t\t"x": 1\n\t}\n}\n',
					);
				}),
			);

			it.effect("a trailing comma keeps the insert inside the container", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{\n  "a": 1,\n}\n', ["b"], 2), '{\n  "a": 1,\n  "b": 2,\n}\n');
					assert.strictEqual(yield* edited("[\n  1,\n]\n", [1], 2), "[\n  1,\n  2,\n]\n");
				}),
			);
		});

		describe("replace", () => {
			it.effect("a replaced multi-line value at depth 2 is indented to its member", () =>
				Effect.gen(function* () {
					const text = '{\n\t"o": {\n\t\t"a": 1\n\t}\n}\n';
					const expected = '{\n\t"o": {\n\t\t"a": {\n\t\t\t"x": {\n\t\t\t\t"y": 1\n\t\t\t}\n\t\t}\n\t}\n}\n';
					assert.strictEqual(yield* edited(text, ["o", "a"], { x: { y: 1 } }), expected);
					assert.strictEqual(
						yield* edited(text, ["o", "a"], { x: { y: 1 } }, { formattingOptions: { insertSpaces: false } }),
						expected,
					);
				}),
			);

			it.effect("a replace in a CRLF file gets CRLF on every line", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\r\n  "a": 1\r\n}\r\n', ["a"], { x: 1 }),
						'{\r\n  "a": {\r\n    "x": 1\r\n  }\r\n}\r\n',
					);
				}),
			);

			it.effect("a replace on a one-line scalar stays byte-minimal", () =>
				Effect.gen(function* () {
					const text = '{\n\t"a": 1, // keep\n\t"b": 2\n}\n';
					const edits = yield* JsoncModifier.modify(text, ["b"], 3);
					assert.strictEqual(edits.length, 1);
					assert.strictEqual(edits[0].offset, text.indexOf("2"));
					assert.strictEqual(edits[0].length, 1);
					assert.strictEqual(edits[0].content, "3");
				}),
			);

			it.effect("a whole-document replace follows the document's unit and eol", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{\r\n\t"a": 1\r\n}', [], { b: 2 }), '{\r\n\t"b": 2\r\n}');
				}),
			);
		});

		describe("delete", () => {
			it.effect("deleting the last member leaves {}", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n\t"deps": {\n\t\t"a": "1"\n\t}\n}\n', ["deps", "a"], undefined),
						'{\n\t"deps": {}\n}\n',
					);
					assert.strictEqual(yield* edited("[\n  1\n]\n", [0], undefined), "[]\n");
					assert.strictEqual(yield* edited('{\r\n  "a": 1,\r\n}\r\n', ["a"], undefined), "{}\r\n");
				}),
			);

			it.effect('an inline { "a": 1 } delete gives {}', () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{ "a": 1 }', ["a"], undefined), "{}");
					assert.strictEqual(yield* edited("[ 1 ]", [0], undefined), "[]");
				}),
			);

			it.effect("deleting the first of several leaves no blank line", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{\n  "a": 1,\n  "b": 2\n}', ["a"], undefined), '{\n  "b": 2\n}');
					assert.strictEqual(yield* edited("[\n\t1,\n\t2\n]\n", [0], undefined), "[\n\t2\n]\n");
					assert.strictEqual(
						yield* edited('{\r\n  "a": {\r\n    "x": 1\r\n  },\r\n  "b": 2\r\n}\r\n', ["a"], undefined),
						'{\r\n  "b": 2\r\n}\r\n',
					);
				}),
			);

			it.effect("deleting the first inline member leaves one space", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{ "a": 1, "b": 2 }', ["a"], undefined), '{ "b": 2 }');
					assert.strictEqual(yield* edited("[1, 2, 3]", [0], undefined), "[2, 3]");
				}),
			);

			it.effect("deleting a later inline member keeps the space before the closer", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{ "a": 1, "b": 2 }', ["b"], undefined), '{ "a": 1 }');
				}),
			);

			it.effect("deleting a later member leaves no blank line", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{\n  "a": 1,\n  "b": 2\n}', ["b"], undefined), '{\n  "a": 1\n}');
					assert.strictEqual(yield* edited('{\n  "a": 1\n  , "b": 2\n}', ["b"], undefined), '{\n  "a": 1\n}');
				}),
			);

			it.effect("deleting the first member keeps a trailing comment", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n  "a": 1, // one\n  "b": 2\n}', ["a"], undefined),
						'{\n  // one\n  "b": 2\n}',
					);
				}),
			);

			it.effect("deleting the first member keeps a comment above it", () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* edited('{\n  // above\n  "a": 1,\n  "b": 2\n}', ["a"], undefined),
						'{\n  // above\n  "b": 2\n}',
					);
				}),
			);

			it.effect("deleting the sole member keeps a comment and the braces", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* edited('{\n  // keep\n  "a": 1\n}', ["a"], undefined), "{\n  // keep\n}");
					assert.strictEqual(yield* edited('{\n  "a": 1 // keep\n}', ["a"], undefined), "{\n  // keep\n}");
					assert.strictEqual(yield* edited('{ "a": 1 /* keep */ }', ["a"], undefined), "{ /* keep */ }");
				}),
			);
		});

		describe("every edit's output parses to the expected value", () => {
			const Doc = Schema.Record(Schema.String, Schema.Json);
			const Layout = Schema.Struct({
				indent: Schema.Literals(["  ", "    ", "\t"]),
				eol: Schema.Literals(["\n", "\r\n"]),
				comment: Schema.Boolean,
			});
			const render = (doc: unknown, layout: typeof Layout.Type) => {
				const lines = JSON.stringify(doc, null, layout.indent).split("\n");
				const withComment =
					layout.comment && lines.length > 1
						? [lines[0], `${layout.indent}// a comment, with a comma`, ...lines.slice(1)]
						: lines;
				return withComment.join(layout.eol);
			};
			// JSON.stringify normalizes what the Json arbitrary can produce and a
			// document cannot hold, such as -0.
			const normal = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
			const plainKey = (key: string) => key !== "__proto__";

			it.effect.prop(
				"setting an object member",
				[Doc, Schema.String, Schema.Json, Layout],
				([doc, key, value, layout]) =>
					Effect.gen(function* () {
						if (!plainKey(key) || Object.keys(doc).some((k) => !plainKey(k))) return;
						const out = yield* edited(render(doc, layout), [key], value);
						assert.deepStrictEqual(yield* Jsonc.parse(out), normal({ ...doc, [key]: value }));
					}),
			);

			it.effect.prop("replacing and deleting an object member", [Doc, Schema.Json, Layout], ([doc, value, layout]) =>
				Effect.gen(function* () {
					const keys = Object.keys(doc);
					const key = keys[0];
					if (key === undefined || keys.some((k) => !plainKey(k))) return;
					const text = render(doc, layout);
					const replaced = yield* edited(text, [key], value);
					assert.deepStrictEqual(yield* Jsonc.parse(replaced), normal({ ...doc, [key]: value }));
					const deleted = yield* edited(text, [key], undefined);
					const { [key]: _removed, ...rest } = doc;
					assert.deepStrictEqual(yield* Jsonc.parse(deleted), normal(rest));
				}),
			);

			it.effect.prop(
				"appending to and deleting from an array",
				[Schema.Array(Schema.Json), Schema.Json, Layout],
				([doc, value, layout]) =>
					Effect.gen(function* () {
						const text = render(doc, layout);
						const appended = yield* edited(text, [doc.length], value);
						assert.deepStrictEqual(yield* Jsonc.parse(appended), normal([...doc, value]));
						if (doc.length > 0) {
							const deleted = yield* edited(text, [0], undefined);
							assert.deepStrictEqual(yield* Jsonc.parse(deleted), normal(doc.slice(1)));
						}
					}),
			);
		});
	});

	describe("errors", () => {
		it.effect("fails with JsoncModificationError on a structural mismatch", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(JsoncModifier.modify('{ "a": 1 }', ["a", "b"], 2));
				assert.instanceOf(error, JsoncModificationError);
				assert.strictEqual(error._tag, "JsoncModificationError");
				assert.deepStrictEqual([...error.path], ["a", "b"]);
				assert.strictEqual(error.expected, "object");
				assert.strictEqual(typeof error.depth, "number");
				assert.include(error.message, "Modification failed");
				assert.include(error.message, `expected ${error.expected} at depth ${error.depth}`);
			}),
		);
	});

	describe("hostile input (hardening)", () => {
		it.effect("replaces a value past a deeply nested sibling without a stack-overflow defect", () =>
			Effect.gen(function* () {
				// The scanner-based navigator must skip the deep sibling `d` to reach
				// `a`; its skip is iterative, so hostile nesting cannot overflow.
				const deep = `${"[".repeat(20000)}1${"]".repeat(20000)}`;
				const text = `{ "d": ${deep}, "a": 1 }`;
				const result = yield* Effect.result(JsoncModifier.modify(text, ["a"], 2));
				assert.isTrue(result._tag === "Success");
				const edits = yield* JsoncModifier.modify(text, ["a"], 2);
				assert.strictEqual(JsoncEdit.applyAll(text, edits).includes('"a": 2'), true);
			}),
		);

		it.effect("modifying a value slot that holds a container closer does not swallow the closer", () =>
			Effect.gen(function* () {
				// Malformed input: the `k` value slot is empty, so the token where a
				// value should start is the object's own `}`. skipValue() must not
				// consume that closer as the (absent) value — doing so decrements the
				// bracket level past zero and splices the `}` into the edit range,
				// corrupting the document.
				const text = '{"k":}';
				const edits = yield* JsoncModifier.modify(text, ["k"], 5);
				const out = JsoncEdit.applyAll(text, edits);
				assert.strictEqual(out.endsWith("}"), true);
				assert.deepStrictEqual(yield* Jsonc.parse(out), { k: 5 });
			}),
		);
	});

	describe("unserializable values (JsoncStringifyError)", () => {
		const circular = (): Record<string, unknown> => {
			const self: Record<string, unknown> = {};
			self.self = self;
			return self;
		};
		const fn = () => 1;
		const sym = Symbol("s");
		// One row per branch of the engine: root replace, located replace, insert.
		const branches = [
			{ name: "root ([])", text: '{ "a": 1 }', path: [] as ReadonlyArray<string> },
			{ name: "replace (existing key)", text: '{ "a": 1 }', path: ["a"] },
			{ name: "insert (new key)", text: '{\n  "a": 1\n}', path: ["b"] },
		];
		const values = [
			{ name: "a circular object", value: circular, code: "CircularReference" },
			{ name: "a bigint", value: () => 10n, code: "BigIntValue" },
			{ name: "a function", value: () => fn, code: "TopLevelUnrepresentable" },
			{ name: "a symbol", value: () => sym, code: "TopLevelUnrepresentable" },
		] as const;

		for (const branch of branches) {
			for (const row of values) {
				it.effect(`${branch.name} with ${row.name} fails typed with ${row.code}`, () =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(JsoncModifier.modify(branch.text, branch.path, row.value()));
						assert.instanceOf(error, JsoncStringifyError);
						assert.strictEqual(error._tag, "JsoncStringifyError");
						if (error._tag === "JsoncStringifyError") {
							assert.strictEqual(error.code, row.code);
						}
					}),
				);
			}
		}

		it.effect("inserting a function under a new key never writes the literal text undefined", () =>
			Effect.gen(function* () {
				// Regression: raw JSON.stringify returned undefined here and the insert
				// template interpolated it, reporting success with `"b": undefined`.
				const text = '{\n  "a": 1\n}';
				const result = JsoncModifier.modifyResult(text, ["b"], () => 1);
				assert.isTrue(Result.isFailure(result));
				if (Result.isSuccess(result)) {
					assert.fail(`expected a failure, got ${JsoncEdit.applyAll(text, result.success)}`);
				}
			}),
		);

		it.effect("a function nested inside an object still drops by JSON semantics (positive control)", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify("{}", ["a"], { x: () => 1 });
				assert.deepStrictEqual(yield* Jsonc.parse(apply("{}", edits)), { a: {} });
			}),
		);

		it.effect("a navigation mismatch wins over an unserializable value", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(JsoncModifier.modify('{ "a": 1 }', ["a", "b"], 10n));
				assert.strictEqual(error._tag, "JsoncModificationError");
			}),
		);

		it.effect("a delete never serializes: undefined at an existing key succeeds and removes it", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify('{ "a": 1, "b": 2 }', ["a"], undefined);
				assert.deepStrictEqual(yield* Jsonc.parse(apply('{ "a": 1, "b": 2 }', edits)), { b: 2 });
			}),
		);

		it.effect("a tab indent survives serialization through stringifyResult", () =>
			Effect.gen(function* () {
				const edits = yield* JsoncModifier.modify(
					'{ "a": 1 }',
					["a"],
					{ b: [1] },
					{
						formattingOptions: { insertSpaces: false },
					},
				);
				assert.strictEqual(edits[0].content, '{\n\t"b": [\n\t\t1\n\t]\n}');
			}),
		);
	});

	describe("modifyResult parity with modify", () => {
		const rows: ReadonlyArray<{ name: string; text: string; path: ReadonlyArray<string | number>; value: unknown }> = [
			{ name: "replace", text: '{ "a": 1 }', path: ["a"], value: 2 },
			{ name: "insert", text: '{ "a": 1 }', path: ["b"], value: { c: true } },
			{ name: "root", text: "[1]", path: [], value: [2] },
			{ name: "mismatch", text: '{ "a": 1 }', path: ["a", "b"], value: 2 },
			{ name: "no-op delete", text: '{ "a": 1 }', path: ["z"], value: undefined },
			{ name: "delete with comma", text: '{ "a": 1, "b": 2 }', path: ["a"], value: undefined },
			{ name: "bigint", text: '{ "a": 1 }', path: ["a"], value: 10n },
			{ name: "symbol insert", text: '{ "a": 1 }', path: ["s"], value: Symbol("s") },
		];

		for (const row of rows) {
			it.effect(`${row.name}: the Effect form agrees with the Result form`, () =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(JsoncModifier.modify(row.text, row.path, row.value));
					const result = JsoncModifier.modifyResult(row.text, row.path, row.value);
					if (Result.isSuccess(result)) {
						assert.isTrue(Exit.isSuccess(exit));
						if (Exit.isSuccess(exit)) assert.deepStrictEqual(exit.value, result.success);
					} else {
						const flipped = yield* Effect.flip(JsoncModifier.modify(row.text, row.path, row.value));
						assert.deepStrictEqual(flipped, result.failure);
					}
				}),
			);
		}
	});
});
