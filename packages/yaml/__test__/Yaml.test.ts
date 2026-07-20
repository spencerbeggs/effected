import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Yaml, YamlParseError, YamlParseOptions, YamlStringifyError, YamlStringifyOptions } from "../src/index.js";

describe("Yaml", () => {
	describe("parse", () => {
		it.effect("parses mappings, sequences and scalars", () =>
			Effect.gen(function* () {
				const value = yield* Yaml.parse("name: Alice\nage: 30\ntags:\n  - a\n  - b");
				assert.deepStrictEqual(value, { name: "Alice", age: 30, tags: ["a", "b"] });
			}),
		);

		it.effect("resolves anchors and aliases to the most recent definition", () =>
			Effect.gen(function* () {
				const value = yield* Yaml.parse("base: &x 1\nref: *x");
				assert.deepStrictEqual(value, { base: 1, ref: 1 });
			}),
		);

		it.effect("returns null for empty input", () =>
			Effect.gen(function* () {
				assert.isNull(yield* Yaml.parse(""));
			}),
		);

		it.effect("fails with an aggregate YamlParseError carrying positioned diagnostics", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Yaml.parse("a: *missing"));
				assert.instanceOf(error, YamlParseError);
				assert.strictEqual(error._tag, "YamlParseError");
				assert.isAbove(error.diagnostics.length, 0);
				assert.strictEqual(error.input, "a: *missing");
				const d = error.diagnostics[0];
				assert.strictEqual(d.code, "UndefinedAlias");
				assert.strictEqual(d.line, 0);
				assert.isAtLeast(d.character, 0);
				assert.include(error.message, "UndefinedAlias");
			}),
		);

		it.effect("promotes duplicate keys to failure under the default uniqueKeys", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Yaml.parse("a: 1\na: 2"));
				assert.isTrue(error.diagnostics.some((d) => d.code === "DuplicateKey"));
				const value = yield* Yaml.parse("a: 1\na: 2", { uniqueKeys: false });
				assert.deepStrictEqual(value, { a: 2 });
			}),
		);

		describe("duplicate-key identity distinguishes YAML node type, not just JS value", () => {
			// Keys are the same mapping key only when they are the same YAML node —
			// same type and value. An !!int and an !!float that resolve to equal JS
			// numbers are distinct keys; different presentations of the same !!int
			// are the same key.
			const rejects = [
				["equal integers written differently", "{1: a, 0x1: b}"], // both !!int 1
				["equal integers, decimal vs octal", "{8: a, 0o10: b}"], // both !!int 8
				["the same float twice", "{1.5: a, 1.5: b}"],
				["the same string twice", "{k: a, k: b}"],
				["string vs quoted string", '{k: a, "k": b}'],
			] as const;
			for (const [label, doc] of rejects) {
				it.effect(`rejects ${label}`, () =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(Yaml.parse(doc));
						assert.isTrue(
							error.diagnostics.some((d) => d.code === "DuplicateKey"),
							doc,
						);
					}),
				);
			}

			// These resolve to distinct YAML nodes, so the parse must NOT reject
			// them as duplicate keys — even where the lossy JS object then collapses
			// them onto one property (int vs float, int vs string).
			const accepts = [
				["int vs float, unit value", "{1: a, 1.0: b}"],
				["int vs float via exponent", "{1000: a, 1e3: b}"],
				["int vs string of the same digits", '{1: a, "1": b}'],
				["float vs a different float", "{1.5: a, 2.5: b}"],
			] as const;
			for (const [label, doc] of accepts) {
				it.effect(`accepts ${label}`, () =>
					Effect.gen(function* () {
						const result = yield* Effect.result(Yaml.parse(doc));
						assert.isTrue(result._tag === "Success", `${doc} should parse`);
					}),
				);
			}

			it.effect("an int and a float key with equal JS value are not a duplicate", () =>
				Effect.gen(function* () {
					const value = (yield* Yaml.parse("{1: int, 1.0: float}")) as Record<string, unknown>;
					// The lossy JS object collapses both onto the "1" property (last
					// wins), but the parse itself must not have rejected the document.
					assert.strictEqual(value["1"], "float");
				}),
			);
		});

		it.effect("rejects trailing top-level content after the document value", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Yaml.parse("a: 1\nb"));
				assert.isTrue(error.diagnostics.some((d) => d.code === "UnexpectedToken"));
			}),
		);

		it.effect("enforces the maxAliasCount DoS guard", () =>
			Effect.gen(function* () {
				const text = `x: &a 1\n${Array.from({ length: 5 }, (_, i) => `k${i}: *a`).join("\n")}`;
				const error = yield* Effect.flip(Yaml.parse(text, { maxAliasCount: 3 }));
				assert.isTrue(error.diagnostics.some((d) => d.code === "AliasCountExceeded"));
			}),
		);
	});

	describe("parseAll", () => {
		it.effect("parses a multi-document stream in order", () =>
			Effect.gen(function* () {
				const values = yield* Yaml.parseAll("name: first\n---\nname: second\n---\nname: third");
				assert.deepStrictEqual(values, [{ name: "first" }, { name: "second" }, { name: "third" }]);
			}),
		);

		it.effect("fails when any document carries a fatal diagnostic", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Yaml.parseAll("ok: 1\n---\nbad: *missing"));
				assert.isTrue(error.diagnostics.some((d) => d.code === "UndefinedAlias"));
			}),
		);
	});

	describe("stringify", () => {
		it.effect("round-trips plain values", () =>
			Effect.gen(function* () {
				const value = { name: "Alice", nested: { list: [1, 2, true, null] } };
				const text = yield* Yaml.stringify(value);
				assert.deepStrictEqual(yield* Yaml.parse(text), value);
			}),
		);

		it.effect("fails on circular references with structured diagnostics, never a reason string", () =>
			Effect.gen(function* () {
				const value: Record<string, unknown> = {};
				value.self = value;
				const error = yield* Effect.flip(Yaml.stringify(value));
				assert.instanceOf(error, YamlStringifyError);
				assert.strictEqual(error._tag, "YamlStringifyError");
				assert.strictEqual(error.diagnostics[0]?.code, "CircularReference");
				assert.notProperty(error, "reason");
				assert.strictEqual(error.value, value);
			}),
		);

		it.effect("a deeply nested acyclic value fails typed, never a stack-overflow defect", () =>
			Effect.gen(function* () {
				// The value-stringifier trio is mutually recursive with no natural
				// bound; a 50 000-deep acyclic array would overflow the stack as a
				// RangeError defect. The depth cap must surface it on the typed channel.
				let value: unknown = 1;
				for (let i = 0; i < 50000; i++) value = [value];

				const result = yield* Effect.result(Yaml.stringify(value));
				if (!Result.isFailure(result)) {
					assert.fail("a 50 000-deep acyclic value must fail, not overflow the stack");
				}
				assert.instanceOf(result.failure, YamlStringifyError);
				assert.strictEqual(result.failure.diagnostics[0]?.code, "NestingDepthExceeded");
			}),
		);

		describe("indentSequences", () => {
			// The `indentSequences: true` expected strings are byte-for-byte the
			// `yaml` npm package's (2.9.0) default (`indentSeq: true`) output for
			// the same values; the kit default (false) preserves the legacy
			// unindented form (byte-compatible with yaml-effect 0.7).
			const indented = YamlStringifyOptions.make({ indentSequences: true });

			it.effect("default leaves a block sequence under a mapping key unindented", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* Yaml.stringify({ key: ["a", "b"] }), "key:\n- a\n- b\n");
				}),
			);

			it.effect("true indents a block sequence under a mapping key one level", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* Yaml.stringify({ key: ["a", "b"] }, indented), "key:\n  - a\n  - b\n");
				}),
			);

			it.effect("nested sequence-of-maps renders exactly in both modes", () =>
				Effect.gen(function* () {
					const value = { items: [{ name: "a", value: 1 }, { name: "b" }] };
					assert.strictEqual(
						yield* Yaml.stringify(value, indented),
						"items:\n  - name: a\n    value: 1\n  - name: b\n",
					);
					assert.strictEqual(yield* Yaml.stringify(value), "items:\n- name: a\n  value: 1\n- name: b\n");
				}),
			);

			it.effect("a top-level sequence stays at column zero in both modes", () =>
				Effect.gen(function* () {
					const value = ["a", "b", { k: 1 }];
					const expected = "- a\n- b\n- k: 1\n";
					assert.strictEqual(yield* Yaml.stringify(value), expected);
					assert.strictEqual(yield* Yaml.stringify(value, indented), expected);
				}),
			);

			it.effect("deeper nesting indents each sequence relative to its key", () =>
				Effect.gen(function* () {
					const value = { a: { b: ["x", { c: ["y"] }] } };
					assert.strictEqual(yield* Yaml.stringify(value, indented), "a:\n  b:\n    - x\n    - c:\n        - y\n");
					assert.strictEqual(yield* Yaml.stringify(value), "a:\n  b:\n  - x\n  - c:\n    - y\n");
				}),
			);

			it.effect("sequence-of-sequences under a key keeps compact nested dashes", () =>
				Effect.gen(function* () {
					const value = { k: [["a", "b"], ["c"]] };
					assert.strictEqual(yield* Yaml.stringify(value, indented), "k:\n  - - a\n    - b\n  - - c\n");
				}),
			);

			it.effect("a map with a sequence value inside a sequence item indents relative to the key", () =>
				Effect.gen(function* () {
					const value = [{ key: ["a"] }];
					assert.strictEqual(yield* Yaml.stringify(value, indented), "- key:\n    - a\n");
					assert.strictEqual(yield* Yaml.stringify(value), "- key:\n  - a\n");
				}),
			);
		});

		describe("quoteStyle", () => {
			// The `quoteStyle: "double"` expected strings match the `yaml` npm
			// package's `singleQuote: false` output for the same values; the kit
			// default ("single") preserves the released byte-compatible form.
			const double = YamlStringifyOptions.make({ quoteStyle: "double" });

			it.effect("default falls back to single quotes for a scalar requiring quoting", () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* Yaml.stringify({ version: "*" }), "version: '*'\n");
				}),
			);

			it.effect('"double" falls back to double quotes for a scalar requiring quoting', () =>
				Effect.gen(function* () {
					assert.strictEqual(yield* Yaml.stringify({ version: "*" }, double), 'version: "*"\n');
				}),
			);

			it.effect("a scalar that needs no quoting stays plain under either setting", () =>
				Effect.gen(function* () {
					const value = { name: "alice", count: 3, flag: true };
					const expected = "name: alice\ncount: 3\nflag: true\n";
					assert.strictEqual(yield* Yaml.stringify(value), expected);
					assert.strictEqual(yield* Yaml.stringify(value, double), expected);
				}),
			);

			it.effect("mapping keys requiring quoting honor the option", () =>
				Effect.gen(function* () {
					// The pnpm-workspace.yaml shape from the reported regression: the
					// keys are the scalars that require quoting, not the values.
					const value = {
						allowBuilds: { "@parcel/watcher": true },
						allowedDeprecatedVersions: { "@types/acorn": "*" },
					};
					assert.strictEqual(
						yield* Yaml.stringify(value),
						"allowBuilds:\n  '@parcel/watcher': true\nallowedDeprecatedVersions:\n  '@types/acorn': '*'\n",
					);
					assert.strictEqual(
						yield* Yaml.stringify(value, double),
						'allowBuilds:\n  "@parcel/watcher": true\nallowedDeprecatedVersions:\n  "@types/acorn": "*"\n',
					);
				}),
			);

			it.effect("flow-mapping keys honor the option too", () =>
				Effect.gen(function* () {
					const value = { "@types/acorn": "*" };
					const flow = { defaultCollectionStyle: "flow" as const };
					assert.strictEqual(yield* Yaml.stringify(value, flow), "{'@types/acorn': '*'}\n");
					assert.strictEqual(
						yield* Yaml.stringify(value, { ...flow, quoteStyle: "double" }),
						'{"@types/acorn": "*"}\n',
					);
				}),
			);

			it.effect('an explicit defaultScalarStyle of "single-quoted" still wins', () =>
				Effect.gen(function* () {
					assert.strictEqual(
						yield* Yaml.stringify({ name: "alice" }, { defaultScalarStyle: "single-quoted", quoteStyle: "double" }),
						"name: 'alice'\n",
					);
				}),
			);

			it.effect("a value needing YAML escapes stays double-quoted and round-trips", () =>
				Effect.gen(function* () {
					// Tabs and control characters cannot be expressed in single-quoted
					// YAML, so both settings must emit double-quoted output here.
					const value = { quoted: 'say "hi" now: ok', tabbed: "a\tb: c" };
					const emitted = yield* Yaml.stringify(value, double);
					assert.strictEqual(emitted, 'quoted: "say \\"hi\\" now: ok"\ntabbed: "a\\tb: c"\n');
					assert.deepStrictEqual(yield* Yaml.parse(emitted), value);
				}),
			);

			it.effect("a multi-line value still routes to a block scalar under either setting", () =>
				Effect.gen(function* () {
					const value = { text: "line one\nline two" };
					const expected = "text: |-\n  line one\n  line two\n";
					assert.strictEqual(yield* Yaml.stringify(value), expected);
					assert.strictEqual(yield* Yaml.stringify(value, double), expected);
				}),
			);

			it.effect("round-trips the quoted forms back to the same value", () =>
				Effect.gen(function* () {
					const value = { "@types/acorn": "*", "a: b": " lead", numeric: "123" };
					assert.deepStrictEqual(yield* Yaml.parse(yield* Yaml.stringify(value, double)), value);
					assert.deepStrictEqual(yield* Yaml.parse(yield* Yaml.stringify(value)), value);
				}),
			);

			it("validates the field and reads back off the options class", () => {
				const options = YamlStringifyOptions.make({ quoteStyle: "double", sortKeys: true });
				assert.strictEqual(options.quoteStyle, "double");
				assert.throws(() => YamlStringifyOptions.make({ quoteStyle: "backtick" as unknown as "single" }));
			});
		});

		describe("control characters force quoting (regression)", () => {
			// Released 0.4.0 emitted CR and interior-tab scalars as PLAIN text
			// because `requiresQuoting`'s control-char loop used `isControlChar`
			// alone, which excludes TAB (0x09) and CR (0x0D). The CR case was
			// silent data corruption: `has\rcarriage` round-tripped back as
			// `has carriage`. Each case asserts BOTH that the scalar is quoted
			// and that it survives a parse round-trip unchanged.
			const cases: ReadonlyArray<readonly [label: string, value: string]> = [
				["carriage return", "has\rcarriage"],
				["interior tab", "has\ttab"],
				["leading tab", "\tleading"],
				["trailing tab", "trailing\t"],
				["NUL", "has\0nul"],
				["bell", "has\u0007bell"],
				["escape", "has\u001bescape"],
			];

			for (const [label, value] of cases) {
				it.effect(`quotes and round-trips a scalar containing a ${label}`, () =>
					Effect.gen(function* () {
						const text = yield* Yaml.stringify({ key: value });
						const scalar = text.slice("key: ".length).trimEnd();
						assert.ok(
							scalar.startsWith('"') || scalar.startsWith("'"),
							`expected a quoted scalar for ${label}, got plain: ${JSON.stringify(scalar)}`,
						);
						assert.deepStrictEqual(yield* Yaml.parse(text), { key: value });
					}),
				);
			}

			it.effect("a multi-line value containing a tab still uses a block scalar", () =>
				Effect.gen(function* () {
					// Guards the fix's scope: TAB is quoted only on the single-line
					// plain path. Block scalars can carry tabs and must keep doing so.
					const value = { key: "line one\n\tindented line\n" };
					const text = yield* Yaml.stringify(value);
					assert.ok(text.includes("|"), `expected a block scalar, got: ${JSON.stringify(text)}`);
					assert.deepStrictEqual(yield* Yaml.parse(text), value);
				}),
			);
		});

		describe("lineWidth folding", () => {
			const long = "the quick brown fox jumps over the lazy dog and keeps running far away into the sunset";

			it.effect("a positive lineWidth folds a long plain scalar transparently (round-trips)", () =>
				Effect.gen(function* () {
					const value = { text: long };
					const wrapped = yield* Yaml.stringify(value, { lineWidth: 30 });
					const lines = wrapped.trimEnd().split("\n");
					// Folding fired: the scalar spans several physical lines.
					assert.isAbove(lines.length, 1);
					// Each line stays near the target column (folding is approximate but
					// bounded — never wildly over the requested width).
					for (const line of lines) assert.isAtMost(line.length, 40);
					// A fold is a semantically transparent break: it re-parses identically.
					assert.deepStrictEqual(yield* Yaml.parse(wrapped), value);
				}),
			);

			it.effect("folds double-quoted and block-folded scalars, round-tripping each", () =>
				Effect.gen(function* () {
					const value = { text: long };
					for (const defaultScalarStyle of ["double-quoted", "block-folded"] as const) {
						const wrapped = yield* Yaml.stringify(value, { lineWidth: 30, defaultScalarStyle });
						assert.isAbove(wrapped.trimEnd().split("\n").length, 1);
						assert.deepStrictEqual(yield* Yaml.parse(wrapped), value);
					}
				}),
			);

			it.effect("folds a scalar in a sequence item and at the document root", () =>
				Effect.gen(function* () {
					const seq = yield* Yaml.stringify([long], { lineWidth: 30 });
					assert.isAbove(seq.trimEnd().split("\n").length, 1);
					assert.deepStrictEqual(yield* Yaml.parse(seq), [long]);

					const root = yield* Yaml.stringify(long, { lineWidth: 30 });
					assert.isAbove(root.trimEnd().split("\n").length, 1);
					assert.strictEqual(yield* Yaml.parse(root), long);
				}),
			);

			it.effect("never folds block-literal content (literal blocks preserve bytes)", () =>
				Effect.gen(function* () {
					// A multi-line string renders as a block literal (`|`); its long first
					// line must survive uncut so the literal round-trips byte-for-byte.
					const value = { text: `${long}\nsecond line` };
					const out = yield* Yaml.stringify(value, { lineWidth: 20 });
					assert.isTrue(out.split("\n").some((l) => l.length > 40));
					assert.deepStrictEqual(yield* Yaml.parse(out), value);
				}),
			);

			it.effect("lineWidth 0, negative and absent all produce byte-identical no-wrap output", () =>
				Effect.gen(function* () {
					const value = { text: long };
					const absent = yield* Yaml.stringify(value);
					const zero = yield* Yaml.stringify(value, { lineWidth: 0 });
					const negative = yield* Yaml.stringify(value, { lineWidth: -10 });
					assert.strictEqual(zero, absent);
					assert.strictEqual(negative, absent);
					// No-wrap keeps the long scalar on a single physical line.
					assert.strictEqual(absent, `text: ${long}\n`);
				}),
			);

			it.effect("mutation guard: folding actually fires (wrapped differs from no-wrap)", () =>
				Effect.gen(function* () {
					// Pins that the fold is not a no-op: were foldRenderedScalar inert,
					// wrapped and unwrapped would be equal and this test would fail.
					const value = { text: long };
					const wrapped = yield* Yaml.stringify(value, { lineWidth: 30 });
					const unwrapped = yield* Yaml.stringify(value, { lineWidth: 0 });
					assert.notStrictEqual(wrapped, unwrapped);
					assert.isAbove(wrapped.split("\n").length, unwrapped.split("\n").length);
				}),
			);
		});
	});

	describe("parseResult / stringifyResult (synchronous Result escape hatch)", () => {
		it.effect("parseResult succeeds and matches Yaml.parse on valid input", () =>
			Effect.gen(function* () {
				const text = "name: Alice\nage: 30\ntags:\n  - a\n  - b";
				const result = Yaml.parseResult(text);
				if (!Result.isSuccess(result)) {
					assert.fail("parseResult must succeed on valid input");
				}
				assert.deepStrictEqual(result.success, yield* Yaml.parse(text));
			}),
		);

		it("parseResult returns a Failure with a typed YamlParseError on malformed input, never a throw", () => {
			let result!: Result.Result<unknown, YamlParseError>;
			assert.doesNotThrow(() => {
				result = Yaml.parseResult("a: *missing");
			});
			assert.isTrue(Result.isFailure(result));
			if (!Result.isFailure(result)) return;
			assert.instanceOf(result.failure, YamlParseError);
			assert.isTrue(result.failure.diagnostics.some((d) => d.code === "UndefinedAlias"));
		});

		it.effect("stringifyResult succeeds and matches Yaml.stringify on valid input", () =>
			Effect.gen(function* () {
				const value = { name: "Alice", nested: { list: [1, 2, true, null] } };
				const result = Yaml.stringifyResult(value);
				if (!Result.isSuccess(result)) {
					assert.fail("stringifyResult must succeed on valid input");
				}
				assert.strictEqual(result.success, yield* Yaml.stringify(value));
			}),
		);

		it("stringifyResult returns a Failure with CircularReference on a cycle, never a throw", () => {
			const value: Record<string, unknown> = {};
			value.self = value;
			let result!: Result.Result<string, YamlStringifyError>;
			assert.doesNotThrow(() => {
				result = Yaml.stringifyResult(value);
			});
			assert.isTrue(Result.isFailure(result));
			if (!Result.isFailure(result)) return;
			assert.instanceOf(result.failure, YamlStringifyError);
			assert.strictEqual(result.failure.diagnostics[0]?.code, "CircularReference");
		});

		it("stringifyResult surfaces a deep-nesting overflow as a typed Failure, never a stack overflow", () => {
			let value: unknown = 1;
			for (let i = 0; i < 50000; i++) value = [value];
			let result!: Result.Result<string, YamlStringifyError>;
			assert.doesNotThrow(() => {
				result = Yaml.stringifyResult(value);
			});
			assert.isTrue(Result.isFailure(result));
			if (!Result.isFailure(result)) return;
			assert.strictEqual(result.failure.diagnostics[0]?.code, "NestingDepthExceeded");
		});

		it("parseResult surfaces an alias 'billion laughs' bomb as a typed Failure, never OOM", () => {
			const width = 10;
			const depth = 8;
			const lines: string[] = [`a1: &a1 [${Array.from({ length: width }, () => "x").join(", ")}]`];
			for (let i = 2; i <= depth; i++) {
				lines.push(`a${i}: &a${i} [${Array.from({ length: width }, () => `*a${i - 1}`).join(", ")}]`);
			}
			lines.push(`top: *a${depth}`);
			let result!: Result.Result<unknown, YamlParseError>;
			assert.doesNotThrow(() => {
				result = Yaml.parseResult(lines.join("\n"));
			});
			assert.isTrue(Result.isFailure(result));
			if (!Result.isFailure(result)) return;
			assert.isTrue(result.failure.diagnostics.some((d) => d.code === "AliasCountExceeded"));
		});
	});

	describe("options classes", () => {
		it("constructs validated instances via .make (kit convention, never new)", () => {
			const parse = YamlParseOptions.make({ maxAliasCount: 50 });
			assert.instanceOf(parse, YamlParseOptions);
			assert.strictEqual(parse.maxAliasCount, 50);
			const stringify = YamlStringifyOptions.make({ indentSequences: true, sortKeys: true });
			assert.instanceOf(stringify, YamlStringifyOptions);
			assert.strictEqual(stringify.indentSequences, true);
		});

		it(".make validates its input", () => {
			assert.throws(() => YamlStringifyOptions.make({ indent: "four" as unknown as number }));
			assert.throws(() => YamlParseOptions.make({ strict: 1 as unknown as boolean }));
		});
	});

	describe("stripComments", () => {
		it("removes comment characters while keeping line breaks", () => {
			assert.strictEqual(Yaml.stripComments("a: 1 # trailing\nb: 2"), "a: 1 \nb: 2");
		});

		it("preserves offsets when a replacement character is given", () => {
			const input = "a: 1 # comment\nb: 2";
			const stripped = Yaml.stripComments(input, " ");
			assert.strictEqual(stripped.length, input.length);
			assert.strictEqual(stripped.indexOf("b: 2"), input.indexOf("b: 2"));
		});

		it("treats # inside quoted scalars as content", () => {
			assert.strictEqual(Yaml.stripComments('a: "x # y"'), 'a: "x # y"');
			assert.strictEqual(Yaml.stripComments("a: 'x # y'"), "a: 'x # y'");
		});

		it("only starts comments after whitespace or line start", () => {
			assert.strictEqual(Yaml.stripComments("a: x#y"), "a: x#y");
		});
	});

	describe("equals / equalsValue", () => {
		it("is key-order independent for mappings", () => {
			assert.isTrue(Yaml.equals("a: 1\nb: 2", "b: 2\na: 1"));
		});

		it("is order-sensitive for sequences", () => {
			assert.isFalse(Yaml.equals("- 1\n- 2", "- 2\n- 1"));
		});

		it("ignores comments and formatting", () => {
			assert.isTrue(Yaml.equals("a: 1 # note", "a:   1"));
		});

		it("treats NaN as equal to NaN", () => {
			assert.isTrue(Yaml.equals("a: .nan", "a: .NaN"));
		});

		it("malformed input is never equal to anything — including itself", () => {
			assert.isFalse(Yaml.equals("a: *missing", "a: *missing"));
			assert.isFalse(Yaml.equalsValue("a: *missing", { a: null }));
		});

		it("duplicate keys make input malformed for equality purposes", () => {
			assert.isFalse(Yaml.equals("a: 1\na: 2", "a: 2"));
		});

		it("compares a document against a JavaScript value", () => {
			assert.isTrue(Yaml.equalsValue("items:\n  - one\n  - two", { items: ["one", "two"] }));
			assert.isFalse(Yaml.equalsValue("items: []", { items: ["one"] }));
		});
	});

	describe("hostile input", () => {
		it.effect("__proto__ becomes an own data property, never a prototype mutation", () =>
			Effect.gen(function* () {
				const value = (yield* Yaml.parse('"__proto__":\n  polluted: true')) as Record<string, unknown>;
				assert.strictEqual(Object.getPrototypeOf(value), Object.prototype);
				assert.isTrue(Object.hasOwn(value, "__proto__"));
				assert.isFalse("polluted" in {});
			}),
		);

		it.effect("rejects unescaped C0 control characters in scalars", () =>
			Effect.gen(function* () {
				const plain = yield* Effect.flip(Yaml.parse(`a: x${String.fromCharCode(7)}y`));
				assert.isTrue(plain.diagnostics.some((d) => d.code === "UnexpectedCharacter"));
				const quoted = yield* Effect.flip(Yaml.parse(`a: "x${String.fromCharCode(7)}y"`));
				assert.isTrue(quoted.diagnostics.some((d) => d.code === "UnexpectedCharacter"));
			}),
		);

		it.effect("escaped control characters in double-quoted scalars stay valid", () =>
			Effect.gen(function* () {
				const value = yield* Yaml.parse('a: "x\\ay"');
				assert.deepStrictEqual(value, { a: `x${String.fromCharCode(7)}y` });
			}),
		);

		it.effect("a \\U escape above U+10FFFF fails with a typed error, never a defect", () =>
			Effect.gen(function* () {
				// The largest valid Unicode code point is U+10FFFF; \U00110000 is one
				// past it. It must surface as a YamlParseError, not a RangeError defect
				// from String.fromCodePoint escaping the typed error channel.
				const error = yield* Effect.flip(Yaml.parse('"\\U00110000"'));
				assert.strictEqual(error._tag, "YamlParseError");
				const valid = yield* Yaml.parse('"\\U0001F600"');
				assert.strictEqual(valid, "😀");
			}),
		);

		it.effect("deeply nested flow collections fail with NestingDepthExceeded, not a stack overflow", () =>
			Effect.gen(function* () {
				const n = 5000;
				const error = yield* Effect.flip(Yaml.parse(`${"[".repeat(n)}1${"]".repeat(n)}`));
				assert.isTrue(error.diagnostics.some((d) => d.code === "NestingDepthExceeded"));
			}),
		);

		it.effect("deeply nested block mappings fail with NestingDepthExceeded, not a stack overflow", () =>
			Effect.gen(function* () {
				let text = "";
				for (let i = 0; i < 4000; i++) text += `${" ".repeat(i)}k:\n`;
				const error = yield* Effect.flip(Yaml.parse(text));
				assert.isTrue(error.diagnostics.some((d) => d.code === "NestingDepthExceeded"));
			}),
		);

		it.effect("an alias-expansion 'billion laughs' bomb under the token budget fails typed, not OOM", () =>
			Effect.gen(function* () {
				// A chain of anchored flow sequences, each referencing the previous
				// ten times: a1=[x×10], a2=[*a1×10], … a8=[*a7×10], top: *a8.
				// Only 71 alias TOKENS (7×10 + 1) — under the default maxAliasCount of
				// 100 — but *a8 expands to ~10^8 materialized nodes. The composer's
				// per-token guard cannot catch it; the value-extraction budget must.
				const width = 10;
				const depth = 8;
				const lines: string[] = [`a1: &a1 [${Array.from({ length: width }, () => "x").join(", ")}]`];
				for (let i = 2; i <= depth; i++) {
					lines.push(`a${i}: &a${i} [${Array.from({ length: width }, () => `*a${i - 1}`).join(", ")}]`);
				}
				lines.push(`top: *a${depth}`);
				const bomb = lines.join("\n");

				const result = yield* Effect.result(Yaml.parse(bomb));
				if (!Result.isFailure(result)) {
					assert.fail("expected the alias bomb to fail, not materialize");
				}
				assert.instanceOf(result.failure, YamlParseError);
				assert.isTrue(result.failure.diagnostics.some((d) => d.code === "AliasCountExceeded"));
			}),
		);

		it.effect("a benign document with many small distinct aliases still parses (budget does not false-positive)", () =>
			Effect.gen(function* () {
				// 90 distinct anchors, each a small scalar, each referenced once — well
				// under any expansion bound. Proves the budget counts real expanded
				// output, not raw alias tokens, so legitimate alias-heavy documents pass.
				const anchors = Array.from({ length: 90 }, (_, i) => `a${i}: &n${i} ${i}`);
				const refs = Array.from({ length: 90 }, (_, i) => `r${i}: *n${i}`);
				const doc = [...anchors, ...refs].join("\n");

				const result = yield* Effect.result(Yaml.parse(doc));
				if (!Result.isSuccess(result)) {
					assert.fail("a benign alias-heavy document must not trip the expansion budget");
				}
				const value = result.success as Record<string, number>;
				assert.strictEqual(value.r0, 0);
				assert.strictEqual(value.r89, 89);
			}),
		);
	});

	describe("schema pipeline", () => {
		const Config = Schema.Struct({ host: Schema.String, port: Schema.Number });

		it.effect("YamlFromString decodes YAML to unknown", () =>
			Effect.gen(function* () {
				const value = yield* Schema.decodeUnknownEffect(Yaml.YamlFromString)("host: localhost\nport: 3000");
				assert.deepStrictEqual(value, { host: "localhost", port: 3000 });
			}),
		);

		it.effect("schema(Target) decodes YAML straight into a domain value", () =>
			Effect.gen(function* () {
				const ConfigFromYaml = Yaml.schema(Config);
				const config = yield* Schema.decodeUnknownEffect(ConfigFromYaml)("host: localhost\nport: 3000");
				assert.deepStrictEqual(config, { host: "localhost", port: 3000 });
			}),
		);

		it.effect("encodes a value back to YAML text", () =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeUnknownEffect(Yaml.YamlFromString)({ a: 1 });
				assert.strictEqual(encoded, "a: 1\n");
			}),
		);

		it.effect("allFromString decodes and encodes multi-document streams", () =>
			Effect.gen(function* () {
				const codec = Yaml.allFromString();
				const values = yield* Schema.decodeUnknownEffect(codec)("a: 1\n---\nb: 2");
				assert.deepStrictEqual(values, [{ a: 1 }, { b: 2 }]);
				const encoded = yield* Schema.encodeUnknownEffect(codec)([{ a: 1 }, { b: 2 }]);
				assert.strictEqual(encoded, "a: 1\n---\nb: 2\n");
				const roundTripped = yield* Schema.decodeUnknownEffect(codec)(encoded);
				assert.deepStrictEqual(roundTripped, [{ a: 1 }, { b: 2 }]);
			}),
		);

		it.effect("boundary: Yaml.parse yields YamlParseError, never SchemaError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Yaml.parse("a: *missing"));
				assert.strictEqual(error._tag, "YamlParseError");
			}),
		);

		it.effect("schema decode surfaces a SchemaError carrying the aggregate parse message", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(Yaml.YamlFromString)("a: *missing"));
				assert.strictEqual(error._tag, "SchemaError");
				assert.include(String(error), "YAML parse failed");
			}),
		);
	});

	describe("bind", () => {
		const Config = Schema.Struct({ host: Schema.String, port: Schema.Number });
		const config = Yaml.bind(Config);

		it.effect("decode parses YAML straight into a validated domain value", () =>
			Effect.gen(function* () {
				const value = yield* config.decode("host: localhost\nport: 3000");
				assert.deepStrictEqual(value, { host: "localhost", port: 3000 });
			}),
		);

		it.effect("decode surfaces a SchemaError carrying the aggregate parse message on malformed text", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(config.decode("host: *missing"));
				assert.strictEqual(error._tag, "SchemaError");
				assert.include(String(error), "YAML parse failed");
			}),
		);

		it.effect("decode surfaces a SchemaError from the target schema, distinct from a parse failure", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(config.decode("host: localhost\nport: not-a-number"));
				assert.strictEqual(error._tag, "SchemaError");
				assert.notInclude(String(error), "YAML parse failed");
			}),
		);

		it.effect("encode writes YAML text that decode round-trips", () =>
			Effect.gen(function* () {
				const text = yield* config.encode({ host: "localhost", port: 3000 });
				assert.strictEqual(text, "host: localhost\nport: 3000\n");
				const value = yield* config.decode(text);
				assert.deepStrictEqual(value, { host: "localhost", port: 3000 });
			}),
		);

		it.effect("schema is the Yaml.schema composition, usable with generic Schema machinery", () =>
			Effect.gen(function* () {
				const value = yield* Schema.decodeUnknownEffect(config.schema)("host: localhost\nport: 3000");
				assert.deepStrictEqual(value, { host: "localhost", port: 3000 });
			}),
		);
	});

	describe("stringify ∘ parse roundtrip (property)", () => {
		const Sample = Schema.Struct({
			name: Schema.String,
			count: Schema.Int,
			enabled: Schema.Boolean,
			tags: Schema.Array(Schema.String),
		});

		it.effect.prop("parse recovers what stringify produced", [Sample], ([value]) =>
			Effect.gen(function* () {
				const text = yield* Yaml.stringify(value);
				const parsed = yield* Yaml.parse(text);
				assert.deepStrictEqual(parsed, value);
			}),
		);
	});
});
