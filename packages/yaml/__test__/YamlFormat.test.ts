import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Yaml, YamlEdit } from "../src/index.js";
import { YamlFormat, YamlFormattingOptions, YamlModificationError } from "../src/YamlFormat.js";

const apply = (text: string, edits: ReadonlyArray<YamlEdit>) => YamlEdit.applyAll(text, edits);

describe("YamlFormat", () => {
	describe("format", () => {
		it("computes edits that reformat indentation", () => {
			const text = "a:\n    b: 1\n";
			const edits = YamlFormat.format(text);
			const out = apply(text, edits);
			assert.strictEqual(Yaml.equalsValue(out, { a: { b: 1 } }), true);
			assert.notStrictEqual(out, text);
		});

		it("is idempotent — formatting a formatted document is a no-op", () => {
			const text = "a:\n    b: 1\nc:\n  - 1\n  -   2\n";
			const once = YamlFormat.formatToString(text);
			const twice = YamlFormat.formatToString(once);
			assert.strictEqual(once, twice);
		});

		it("preserves a leading document comment by default", () => {
			// The stringifier only ever re-emits the document-level leading
			// comment (verified against v3: per-node/per-pair comments are
			// captured on the AST for round-trip detection but are not
			// re-serialized by either engine) — preserveComments governs this.
			const text = "# top comment\na: 1\n";
			const out = YamlFormat.formatToString(text);
			assert.include(out, "# top comment");
		});

		it("strips the document comment when preserveComments is false", () => {
			const text = "# drop me\na: 1\n";
			const out = YamlFormat.formatToString(text, undefined, YamlFormattingOptions.make({ preserveComments: false }));
			assert.notInclude(out, "drop me");
		});

		it("returns no edits for malformed input rather than corrupting it", () => {
			const text = "a: *undefined_alias\n";
			assert.deepStrictEqual(YamlFormat.format(text), []);
			assert.strictEqual(YamlFormat.formatToString(text), text);
		});

		it("restricts returned edits to a positional range", () => {
			const text = "a:\n    b: 1\nc:\n    d: 2\n";
			const full = YamlFormat.format(text);
			assert.isAbove(full.length, 0);
			// A zero-length range at the very start admits no edit.
			const restricted = YamlFormat.format(text, { offset: 0, length: 0 });
			assert.deepStrictEqual(restricted, []);
		});

		it("accepts a plain range object identically to a YamlRange instance", () => {
			const text = "a:\n    b: 1\n";
			const plain = YamlFormat.format(text, { offset: 0, length: 0 });
			assert.deepStrictEqual(plain, []);
		});

		it("honors options.range as a fallback when no positional range is given", () => {
			const text = "a:\n    b: 1\n";
			const viaOptions = YamlFormat.format(
				text,
				undefined,
				YamlFormattingOptions.make({ range: { offset: 0, length: 0 } }),
			);
			assert.deepStrictEqual(viaOptions, []);
		});
	});

	describe("format — indentSequences", () => {
		// Exercises the AST (node-path) stringifier: YamlFormattingOptions
		// derives every YamlStringifyOptions field, including indentSequences.
		it("indents block sequences under mapping keys one level when set", () => {
			const options = YamlFormattingOptions.make({ indentSequences: true });
			assert.strictEqual(YamlFormat.formatToString("key:\n- a\n- b\n", undefined, options), "key:\n  - a\n  - b\n");
		});

		it("default formatting leaves sequences under mapping keys unindented", () => {
			assert.strictEqual(YamlFormat.formatToString("key:\n  - a\n  - b\n"), "key:\n- a\n- b\n");
		});

		it("YamlFormattingOptions.make constructs a validated instance carrying the derived field", () => {
			const options = YamlFormattingOptions.make({ indentSequences: true, preserveComments: false });
			assert.instanceOf(options, YamlFormattingOptions);
			assert.strictEqual(options.indentSequences, true);
			assert.throws(() => YamlFormattingOptions.make({ indentSequences: "yes" as unknown as boolean }));
		});
	});

	describe("quoteStyle", () => {
		// Exercises the AST (node-path) stringifier: YamlFormattingOptions derives
		// every YamlStringifyOptions field, quoteStyle included. On this path the
		// option governs only scalars with no style of their own — a value the
		// caller just inserted — because composed nodes carry their source style.
		it.effect("a modify-inserted value requiring quoting follows the option", () =>
			Effect.gen(function* () {
				const text = "deps:\n  a: 1\n";
				assert.strictEqual(yield* YamlFormat.modifyToString(text, ["deps", "a"], "*"), "deps:\n  a: '*'\n");
				assert.strictEqual(
					yield* YamlFormat.modifyToString(text, ["deps", "a"], "*", { quoteStyle: "double" }),
					'deps:\n  a: "*"\n',
				);
			}),
		);

		it.effect("a modify-inserted value needing no quoting stays plain under either setting", () =>
			Effect.gen(function* () {
				const text = "deps:\n  a: 1\n";
				assert.strictEqual(
					yield* YamlFormat.modifyToString(text, ["deps", "a"], "beta", { quoteStyle: "double" }),
					"deps:\n  a: beta\n",
				);
			}),
		);

		it("formatting preserves an existing scalar's own quote style rather than restyling it", () => {
			// Reformatting is not a restyling pass: a single-quoted source scalar
			// stays single-quoted even under quoteStyle "double".
			const options = YamlFormattingOptions.make({ quoteStyle: "double" });
			assert.strictEqual(YamlFormat.formatToString("k: '*'\n", undefined, options), "k: '*'\n");
		});

		it("YamlFormattingOptions.make constructs a validated instance carrying the derived field", () => {
			const options = YamlFormattingOptions.make({ quoteStyle: "double", preserveComments: false });
			assert.instanceOf(options, YamlFormattingOptions);
			assert.strictEqual(options.quoteStyle, "double");
			assert.throws(() => YamlFormattingOptions.make({ quoteStyle: "backtick" as unknown as "single" }));
		});
	});

	describe("modify — replace", () => {
		it.effect("updates an existing mapping value", () =>
			Effect.gen(function* () {
				const text = "name: John\nage: 30\n";
				const edits = yield* YamlFormat.modify(text, ["name"], "Jane");
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { name: "Jane", age: 30 });
			}),
		);

		it.effect("updates a nested sequence element", () =>
			Effect.gen(function* () {
				const text = "xs:\n  - 1\n  - 2\n  - 3\n";
				const edits = yield* YamlFormat.modify(text, ["xs", 1], 99);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { xs: [1, 99, 3] });
			}),
		);

		it.effect("byte-minimal: an untouched sibling key's line is unaffected", () =>
			Effect.gen(function* () {
				const text = "first: unchanged\nsecond: 2\n";
				const edits = yield* YamlFormat.modify(text, ["second"], 5);
				// Only the changed line's span should appear among the edits.
				for (const edit of edits) {
					assert.isAtLeast(edit.offset, text.indexOf("second"));
				}
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { first: "unchanged", second: 5 });
			}),
		);
	});

	describe("modify — insert", () => {
		it.effect("appends a new key after the last one", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const edits = yield* YamlFormat.modify(text, ["b"], 2);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { a: 1, b: 2 });
			}),
		);

		it.effect("inserts into an existing nested mapping", () =>
			Effect.gen(function* () {
				const text = "server:\n  host: localhost\n";
				const edits = yield* YamlFormat.modify(text, ["server", "port"], 8080);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), {
					server: { host: "localhost", port: 8080 },
				});
			}),
		);

		it.effect("escapes a generated key containing a colon and quotes", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const key = `weird: key "with" quotes`;
				const edits = yield* YamlFormat.modify(text, [key], "value");
				const out = apply(text, edits);
				const parsed = (yield* Yaml.parse(out)) as Record<string, unknown>;
				assert.strictEqual(parsed[key], "value");
			}),
		);

		it.effect("appends beyond the end of a sequence", () =>
			Effect.gen(function* () {
				const text = "xs:\n  - 1\n";
				const edits = yield* YamlFormat.modify(text, ["xs", 5], 2);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { xs: [1, 2] });
			}),
		);
	});

	describe("modify — delete via undefined", () => {
		it.effect("removes a mapping key", () =>
			Effect.gen(function* () {
				const text = "a: 1\nb: 2\n";
				const edits = yield* YamlFormat.modify(text, ["a"], undefined);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { b: 2 });
			}),
		);

		it.effect("removes a sequence element", () =>
			Effect.gen(function* () {
				const text = "xs:\n  - 1\n  - 2\n  - 3\n";
				const edits = yield* YamlFormat.modify(text, ["xs", 1], undefined);
				assert.deepStrictEqual(yield* Yaml.parse(apply(text, edits)), { xs: [1, 3] });
			}),
		);

		it.effect("removing a missing key is a no-op", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const edits = yield* YamlFormat.modify(text, ["missing"], undefined);
				assert.strictEqual(apply(text, edits), text);
			}),
		);
	});

	describe("modify — failure carries diagnostics, never a reason string", () => {
		it.effect("fails on malformed source with a fatal-diagnostic aggregate", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("a: *undefined_alias\n", ["a"], 1));
				assert.instanceOf(error, YamlModificationError);
				assert.strictEqual(error._tag, "YamlModificationError");
				assert.isAbove(error.diagnostics.length, 0);
				assert.deepStrictEqual(error.path, ["a"]);
			}),
		);

		it.effect("fails navigating a missing intermediate key", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("a: 1\n", ["missing", "deep"], 2));
				assert.instanceOf(error, YamlModificationError);
				assert.isAbove(error.diagnostics.length, 0);
				assert.strictEqual(error.diagnostics[0]?.code, "PathNotFound");
			}),
		);

		it.effect("fails navigating through a scalar", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("a: 1\n", ["a", "deep"], 2));
				assert.instanceOf(error, YamlModificationError);
				assert.strictEqual(error.diagnostics[0]?.code, "NotNavigable");
			}),
		);

		it.effect("fails with an out-of-bounds negative sequence index", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("xs:\n  - 1\n", ["xs", -1], 2));
				assert.instanceOf(error, YamlModificationError);
				assert.strictEqual(error.diagnostics[0]?.code, "InvalidIndex");
			}),
		);

		it.effect("fails navigating deeper past the end of a sequence", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("xs:\n  - 1\n", ["xs", 5, "k"], 2));
				assert.instanceOf(error, YamlModificationError);
				assert.strictEqual(error.diagnostics[0]?.code, "InvalidIndex");
			}),
		);

		it.effect("fails navigating an empty document", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(YamlFormat.modify("", ["a"], 1));
				assert.instanceOf(error, YamlModificationError);
				assert.strictEqual(error.diagnostics[0]?.code, "EmptyDocument");
			}),
		);
	});

	describe("modifyToString", () => {
		it.effect("composes applyAll with modify", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const out = yield* YamlFormat.modifyToString(text, ["b"], 2);
				assert.deepStrictEqual(yield* Yaml.parse(out), { a: 1, b: 2 });
			}),
		);

		it.effect("clearing the root via an empty path yields an empty document", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const out = yield* YamlFormat.modifyToString(text, [], undefined);
				assert.deepStrictEqual(yield* Yaml.parse(out), null);
			}),
		);

		it.effect("replacing the root via an empty path replaces the whole document", () =>
			Effect.gen(function* () {
				const text = "a: 1\n";
				const out = yield* YamlFormat.modifyToString(text, [], "just a scalar");
				assert.deepStrictEqual(yield* Yaml.parse(out), "just a scalar");
			}),
		);
	});

	describe("merge key", () => {
		// A plain `<<` mapping key resolves to `tag:yaml.org,2002:merge` and
		// splices the aliased mapping into its parent; `'<<'` is an ordinary
		// string key that merges nothing. Quoting it on re-emission is a silent
		// semantic rewrite — the document still parses and still round-trips,
		// which is exactly why nothing caught it.
		it("leaves a plain merge key unquoted", () => {
			const text = "base: &base\n  a: 1\nderived:\n  <<: *base\n  b: 2\n";
			const out = YamlFormat.formatToString(text);
			assert.include(out, "<<: *base");
			assert.notInclude(out, "'<<'");
			assert.notInclude(out, '"<<"');
		});

		it("leaves a plain merge key unquoted inside a flow mapping", () => {
			const out = YamlFormat.formatToString("derived: {<<: *base, b: 2}\n");
			assert.include(out, "<<: *base");
			assert.notInclude(out, "'<<'");
		});

		it("leaves a plain merge key unquoted when nested several levels deep", () => {
			const out = YamlFormat.formatToString("x:\n  y:\n    z:\n      <<: *base\n");
			assert.include(out, "<<: *base");
			assert.notInclude(out, "'<<'");
		});

		it("is idempotent on a document containing a merge key", () => {
			const text = "base: &base\n  a: 1\nderived:\n  <<: *base\n  b: 2\n";
			const once = YamlFormat.formatToString(text);
			assert.strictEqual(YamlFormat.formatToString(once), once);
		});

		// The carve-out is deliberately narrow: it reads the key's SOURCE style,
		// so a key the author quoted on purpose keeps the quotes that make it a
		// literal string key rather than a merge key.
		it("preserves an explicitly single-quoted '<<' key as a literal string key", () => {
			const out = YamlFormat.formatToString("derived:\n  '<<': *base\n");
			assert.include(out, "'<<': *base");
		});

		it('preserves an explicitly double-quoted "<<" key as a literal string key', () => {
			const out = YamlFormat.formatToString('derived:\n  "<<": *base\n');
			assert.include(out, '"<<": *base');
		});

		// `<<` in value position is an ordinary string either way — plain and
		// quoted resolve to the same scalar — so the carve-out does not reach it
		// and the existing conservative quoting stands.
		it("does not change quoting of `<<` in value position", () => {
			const out = YamlFormat.formatToString("a: <<\n");
			assert.include(out, "'<<'");
		});

		// The value path is the opposite case: a JS object key "<<" is a literal
		// string key with no merge intent, so emitting it plain would CREATE
		// merge semantics that the input never had. It stays quoted.
		it.effect("still quotes a '<<' key on the value path, where there is no merge intent", () =>
			Effect.gen(function* () {
				const out = yield* Yaml.stringify({ "<<": 1 });
				assert.include(out, "'<<'");
			}),
		);
	});
});
