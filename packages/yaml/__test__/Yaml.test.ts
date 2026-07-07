import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Yaml, YamlParseError, YamlStringifyError } from "../src/index.js";

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
