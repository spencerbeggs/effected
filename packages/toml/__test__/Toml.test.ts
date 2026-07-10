// The Toml facade: parse, canonical value stringify, and the schema
// factories, plus the boundary rows the emitter contract pins (int64 bigint
// bounds, integral-float-to-integer, -0.0, key quoting, canonical layout).

import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderInlineValue } from "../src/internal/stringifyValue.js";
import { Toml, TomlParseError, TomlStringifyError, TomlStringifyOptions } from "../src/Toml.js";
import { TomlLocalDate } from "../src/TomlDateTime.js";

describe("Toml", () => {
	describe("parse", () => {
		it.effect("parses a representative document", () =>
			Effect.gen(function* () {
				const v = yield* Toml.parse(
					'title = "x"\n[owner]\nname = "y"\ndob = 1979-05-27\n[[srv]]\nport = 1\n[[srv]]\nport = 2\n',
				);
				const doc = v as Record<string, unknown>;
				assert.deepStrictEqual(doc.srv, [{ port: 1 }, { port: 2 }]);
				assert.isTrue((doc.owner as Record<string, unknown>).dob instanceof TomlLocalDate);
			}),
		);

		it.effect("fails typed with a positioned diagnostic", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Toml.parse("a = 1\na = 2\n"));
				assert.instanceOf(e, TomlParseError);
				assert.strictEqual(e.diagnostics[0].code, "DuplicateKey");
				assert.strictEqual(e.diagnostics[0].line, 1);
			}),
		);

		it.effect("fails typed on a syntactically fine but semantically illegal document", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Toml.parse("[a]\nb = 1\n[a]\nc = 2\n"));
				assert.instanceOf(e, TomlParseError);
				assert.strictEqual(e.diagnostics[0].code, "TableRedefined");
				assert.strictEqual(e.diagnostics[0].line, 2);
			}),
		);

		it.effect("surfaces the nesting-depth guard as a typed parse error, never a defect", () =>
			Effect.gen(function* () {
				const bomb = `a = ${"[".repeat(300)}${"]".repeat(300)}\n`;
				const e = yield* Effect.flip(Toml.parse(bomb));
				assert.instanceOf(e, TomlParseError);
				assert.strictEqual(e.diagnostics[0].code, "NestingDepthExceeded");
			}),
		);

		it.effect("carries a summarizing message", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Toml.parse("a = 1\na = 2\n"));
				assert.include(e.message, "TOML parse failed");
				assert.include(e.message, "DuplicateKey");
			}),
		);
	});

	describe("stringify", () => {
		it.effect("emits canonical layout: scalars, then tables, then array tables", () =>
			Effect.gen(function* () {
				const s = yield* Toml.stringify({ z: 1, t: { a: "x" }, arr: [{ n: 1 }, { n: 2 }] });
				assert.strictEqual(s, 'z = 1\n\n[t]\na = "x"\n\n[[arr]]\nn = 1\n\n[[arr]]\nn = 2\n');
			}),
		);

		it.effect("pins the layout byte-exact on nested tables, array tables and a quoted key", () =>
			Effect.gen(function* () {
				const s = yield* Toml.stringify({
					title: "t",
					"k y": { v: 1 },
					db: { server: "s", ports: [1, 2], meta: { on: true } },
					servers: [{ name: "a" }, { name: "b" }],
				});
				assert.strictEqual(
					s,
					'title = "t"\n\n["k y"]\nv = 1\n\n[db]\nserver = "s"\nports = [1, 2]\n\n[db.meta]\non = true\n\n[[servers]]\nname = "a"\n\n[[servers]]\nname = "b"\n',
				);
			}),
		);

		it.effect("round-trips value -> text -> value", () =>
			Effect.gen(function* () {
				const v = {
					a: [1, 2n ** 60n],
					"k y": 'va"l',
					nan: Number.NaN,
					d: TomlLocalDate.make({ year: 2000, month: 2, day: 29 }),
				};
				const back = (yield* Toml.stringify(v).pipe(Effect.flatMap(Toml.parse))) as Record<string, unknown>;
				assert.strictEqual(back["k y"], 'va"l');
				assert.strictEqual((back.a as Array<unknown>)[1], 2n ** 60n);
				assert.isTrue(Number.isNaN(back.nan));
				assert.isTrue(back.d instanceof TomlLocalDate);
				assert.strictEqual(String(back.d), "2000-02-29");
			}),
		);

		it.effect("rejects null, undefined, Date and out-of-range bigint typed", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* Effect.flip(Toml.stringify({ a: null }))).diagnostic.code, "UnsupportedValue");
				assert.strictEqual((yield* Effect.flip(Toml.stringify({ a: undefined }))).diagnostic.code, "UnsupportedValue");
				assert.strictEqual((yield* Effect.flip(Toml.stringify({ a: new Date() }))).diagnostic.code, "UnsupportedValue");
				assert.strictEqual((yield* Effect.flip(Toml.stringify({ a: 2n ** 63n }))).diagnostic.code, "IntegerOutOfRange");
			}),
		);

		it.effect("names the JS type and the key path in UnsupportedValue", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Toml.stringify({ o: { d: new Date() } }));
				assert.instanceOf(e, TomlStringifyError);
				assert.include(e.diagnostic.message, "Date");
				assert.include(e.diagnostic.message, "o.d");
			}),
		);

		it.effect("rejects a non-table root typed", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Toml.stringify(42));
				assert.strictEqual(e.diagnostic.code, "UnsupportedValue");
			}),
		);

		it.effect("accepts the exact int64 bounds and rejects one past them", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({ a: 2n ** 63n - 1n }), "a = 9223372036854775807\n");
				assert.strictEqual(yield* Toml.stringify({ a: -(2n ** 63n) }), "a = -9223372036854775808\n");
				const under = yield* Effect.flip(Toml.stringify({ a: -(2n ** 63n) - 1n }));
				assert.strictEqual(under.diagnostic.code, "IntegerOutOfRange");
			}),
		);

		it.effect("formats numbers: integral as integer, -0 as -0.0, specials, floats", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({ a: 1.0 }), "a = 1\n");
				assert.strictEqual(yield* Toml.stringify({ a: -0 }), "a = -0.0\n");
				assert.strictEqual(yield* Toml.stringify({ a: 0.5 }), "a = 0.5\n");
				assert.strictEqual(
					yield* Toml.stringify({ a: Number.POSITIVE_INFINITY, b: Number.NEGATIVE_INFINITY }),
					"a = inf\nb = -inf\n",
				);
				// Integral but past the int64 range: emitted as a float, so it
				// round-trips instead of overflowing at parse time.
				assert.strictEqual(yield* Toml.stringify({ a: 1e21 }), "a = 1e+21\n");
			}),
		);

		it.effect("quotes non-bare keys, the empty key included", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({ "": 1 }), '"" = 1\n');
				assert.strictEqual(yield* Toml.stringify({ "a.b": 1 }), '"a.b" = 1\n');
			}),
		);

		it.effect("emits empty structures: root, empty sub-table, empty array", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({}), "");
				assert.strictEqual(yield* Toml.stringify({ t: {} }), "[t]\n");
				assert.strictEqual(yield* Toml.stringify({ a: [] }), "a = []\n");
			}),
		);

		it.effect("renders mixed arrays inline with objects as inline tables", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({ a: [{ n: 1 }, 2] }), "a = [{ n = 1 }, 2]\n");
			}),
		);

		it.effect("escapes control characters in basic strings", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* Toml.stringify({ a: "x\ny\u0001" }), 'a = "x\\ny\\u0001"\n');
			}),
		);

		it.effect("fails typed on a circular reference", () =>
			Effect.gen(function* () {
				const o: Record<string, unknown> = { a: 1 };
				o.self = o;
				const e = yield* Effect.flip(Toml.stringify(o));
				assert.strictEqual(e.diagnostic.code, "CircularReference");
			}),
		);

		it.effect("surfaces the stringify depth guard typed, never a defect", () =>
			Effect.gen(function* () {
				let v: unknown = 1;
				for (let i = 0; i < 300; i++) {
					v = [v];
				}
				const e = yield* Effect.flip(Toml.stringify({ a: v }));
				assert.strictEqual(e.diagnostic.code, "NestingDepthExceeded");
			}),
		);

		it.effect("honors the crlf newline option", () =>
			Effect.gen(function* () {
				const s = yield* Toml.stringify({ a: 1 }, TomlStringifyOptions.make({ newline: "\r\n" }));
				assert.strictEqual(s, "a = 1\r\n");
			}),
		);
	});

	describe("schema factories", () => {
		const Config = Schema.Struct({ port: Schema.Number });

		it.effect("TomlFromString decodes TOML text", () =>
			Effect.gen(function* () {
				const v = yield* Schema.decodeUnknownEffect(Toml.TomlFromString)("a = 1\n");
				assert.deepStrictEqual(v, { a: 1 });
			}),
		);

		it.effect("TomlFromString encodes a value back to TOML text", () =>
			Effect.gen(function* () {
				const s = yield* Schema.encodeUnknownEffect(Toml.TomlFromString)({ a: 1 });
				assert.strictEqual(s, "a = 1\n");
			}),
		);

		it.effect("schema(Target) decodes TOML straight into a domain value", () =>
			Effect.gen(function* () {
				const ConfigFromToml = Toml.schema(Config);
				const config = yield* Schema.decodeUnknownEffect(ConfigFromToml)("port = 8080\n");
				assert.deepStrictEqual(config, { port: 8080 });
			}),
		);

		it.effect("a failing decode surfaces a SchemaError carrying the parse message", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Schema.decodeUnknownEffect(Toml.TomlFromString)("a = 1\na = 2\n"));
				assert.strictEqual(e._tag, "SchemaError");
				assert.include(String(e), "TOML parse failed");
			}),
		);

		it.effect("a failing encode surfaces a SchemaError carrying the stringify message", () =>
			Effect.gen(function* () {
				const e = yield* Effect.flip(Schema.encodeUnknownEffect(Toml.TomlFromString)({ a: null }));
				assert.strictEqual(e._tag, "SchemaError");
				assert.include(String(e), "TOML stringify failed");
			}),
		);
	});

	describe("renderInlineValue", () => {
		it("renders a single value as an inline TOML fragment", () => {
			assert.strictEqual(renderInlineValue('va"l'), '"va\\"l"');
			assert.strictEqual(renderInlineValue([1, "x", []]), '[1, "x", []]');
			assert.strictEqual(renderInlineValue({ a: [1, true], b: {} }), "{ a = [1, true], b = {} }");
		});
	});
});
