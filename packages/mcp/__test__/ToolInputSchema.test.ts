import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ToolInputSchema } from "../src/index.js";

const str = { type: "string" };
const closed = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	type: "object",
	properties,
	additionalProperties: false,
	...extra,
});

/** The input document McpServer serves (McpServer.ts:1924-1931), strict or not. */
const served = (schema: Schema.Constraint, strict: boolean) => {
	const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: strict ? "error" : "ignore" });
	return Object.keys(document.definitions).length === 0
		? document.schema
		: { ...document.schema, $defs: document.definitions };
};

describe("ToolInputSchema.unknownKeys", () => {
	it("reports every unknown key of a closed root, in payload order, with the accepted keys", () => {
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ text: "a", extra: 1, other: 2 }, closed({ text: str })), [
			{ path: [], unknown: ["extra", "other"], accepted: ["text"] },
		]);
	});

	it("an open node (additionalProperties true) reports nothing — the non-strict served shape", () => {
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys(
				{ text: "a", extra: 1 },
				{ type: "object", properties: { text: str }, additionalProperties: true },
			),
			[],
		);
	});

	it("a missing additionalProperties keyword is open, as JSON Schema says", () => {
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys({ text: "a", extra: 1 }, { type: "object", properties: { text: str } }),
			[],
		);
	});

	it("reports each nested level separately, with its path", () => {
		const schema = closed({ text: str, nested: closed({ flag: { type: "boolean" } }) });
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys({ text: "a", extra: 1, nested: { flag: true, bogus: 2 } }, schema),
			[
				{ path: [], unknown: ["extra"], accepted: ["text", "nested"] },
				{ path: ["nested"], unknown: ["bogus"], accepted: ["flag"] },
			],
		);
	});

	it("a zero-parameter tool (EmptyParams) rejects any key and accepts none", () => {
		const emptyParams = { type: "object", additionalProperties: false };
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ x: 1 }, emptyParams), [
			{ path: [], unknown: ["x"], accepted: [] },
		]);
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({}, emptyParams), []);
	});

	it("merges allOf members' properties before judging a key", () => {
		const schema = { allOf: [closed({ a: str }), closed({ b: str })] };
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ a: "1", b: "2", c: 3 }, schema), [
			{ path: [], unknown: ["c"], accepted: ["a", "b"] },
		]);
	});

	it("selects a union member by its action discriminant, and flags a key that only a sibling accepts", () => {
		const schema = {
			anyOf: [
				closed({ action: { type: "string", enum: ["start"] }, id: str }),
				closed({ action: { type: "string", enum: ["stop"] }, reason: str }),
			],
		};
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ action: "start", id: "1", reason: "x" }, schema), [
			{ path: [], unknown: ["reason"], accepted: ["action", "id"] },
		]);
	});

	it("finds unknown keys inside a union member nested under a property, discriminated by kind", () => {
		const filter = {
			oneOf: [closed({ kind: { const: "tag" }, tag: str }), closed({ kind: { const: "text" }, text: str })],
		};
		const schema = closed({ query: str, filter });
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys({ query: "q", filter: { kind: "tag", tag: "t", text: "sneaky" } }, schema),
			[{ path: ["filter"], unknown: ["text"], accepted: ["kind", "tag"] }],
		);
	});

	it("skips a union whose discriminant value matches no member — decoding reports that", () => {
		const schema = { anyOf: [closed({ action: { const: "a" } }), closed({ action: { const: "b" } })] };
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ action: "zzz", extra: 1 }, schema), []);
	});

	it("walks array items and positional prefixItems with index paths", () => {
		const schema = closed({
			list: { type: "array", items: closed({ id: str }) },
			pair: { type: "array", prefixItems: [closed({ a: str }), closed({ b: str })] },
		});
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys(
				{ list: [{ id: "1" }, { id: "2", x: 0 }], pair: [{ a: "1" }, { b: "2", y: 0 }] },
				schema,
			),
			[
				{ path: ["list", "1"], unknown: ["x"], accepted: ["id"] },
				{ path: ["pair", "1"], unknown: ["y"], accepted: ["b"] },
			],
		);
	});

	it("follows $ref into $defs", () => {
		const schema = { ...closed({ inner: { $ref: "#/$defs/Inner" } }), $defs: { Inner: closed({ ok: str }) } };
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ inner: { ok: "1", nope: 2 } }, schema), [
			{ path: ["inner"], unknown: ["nope"], accepted: ["ok"] },
		]);
	});

	it("accepts a key matched by patternProperties", () => {
		const schema = closed({ id: str }, { patternProperties: { "^x-": str } });
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ id: "1", "x-trace": "t", y: 1 }, schema), [
			{ path: [], unknown: ["y"], accepted: ["id"] },
		]);
	});

	it("stops descending at depth 256 instead of overflowing the stack on a hostile payload", () => {
		const schema = {
			$ref: "#/$defs/Node",
			$defs: { Node: closed({ child: { $ref: "#/$defs/Node" } }) },
		};
		let payload: Record<string, unknown> = { deepExtra: 1 };
		for (let i = 0; i < 10_000; i++) payload = { child: payload };
		(
			((payload.child as Record<string, unknown>).child as Record<string, unknown>).child as Record<string, unknown>
		).shallow = 1;
		const levels = ToolInputSchema.unknownKeys(payload, schema);
		assert.deepStrictEqual(levels, [{ path: ["child", "child", "child"], unknown: ["shallow"], accepted: ["child"] }]);
	});

	it("agrees with the document core actually serves for a strict tool, and finds nothing in a lenient one", () => {
		const params = Schema.Struct({
			text: Schema.String,
			nested: Schema.optionalKey(Schema.Struct({ flag: Schema.Boolean })),
		});
		const payload = { text: "a", extra: 1, nested: { flag: true, bogus: 2 } };
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys(payload, served(params, true)).map((level) => [level.path.join("."), level.unknown]),
			[
				["", ["extra"]],
				["nested", ["bogus"]],
			],
		);
		assert.deepStrictEqual(ToolInputSchema.unknownKeys(payload, served(params, false)), []);
	});

	it("honours patternProperties on a closed node with no properties, as core serves a pattern-keyed Record", () => {
		const params = Schema.Struct({
			headers: Schema.Record(Schema.String.check(Schema.isPattern(/^x-/)), Schema.String),
		});
		const schema = served(params, true);
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ headers: { "x-a": "1" } }, schema), []);
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ headers: { "x-a": "1", "y-b": "2" } }, schema), [
			{ path: ["headers"], unknown: ["y-b"], accepted: [] },
		]);
	});

	it("descends into a pattern-matched value with its pattern schema", () => {
		const bare = { type: "object", patternProperties: { "^x-": closed({ ok: str }) }, additionalProperties: false };
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ "x-a": { ok: "1", bad: 2 } }, bare), [
			{ path: ["x-a"], unknown: ["bad"], accepted: ["ok"] },
		]);
		const withProperties = closed({ id: str }, { patternProperties: { "^x-": closed({ ok: str }) } });
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ id: "1", "x-a": { ok: "1", bad: 2 } }, withProperties), [
			{ path: ["x-a"], unknown: ["bad"], accepted: ["ok"] },
		]);
	});

	it("selects a member of an Effect tagged union by its _tag, as core serves it", () => {
		const params = Schema.Struct({
			op: Schema.Union([
				Schema.TaggedStruct("A", { a: Schema.String }),
				Schema.TaggedStruct("B", { b: Schema.String }),
			]),
		});
		assert.deepStrictEqual(
			ToolInputSchema.unknownKeys({ op: { _tag: "A", a: "x", b: "sneaky" } }, served(params, true)),
			[{ path: ["op"], unknown: ["b"], accepted: ["_tag", "a"] }],
		);
	});

	it("selects a union member by a type literal", () => {
		const schema = {
			anyOf: [closed({ type: { const: "circle" }, r: str }), closed({ type: { const: "square" }, side: str })],
		};
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ type: "circle", r: "1", side: "2" }, schema), [
			{ path: [], unknown: ["side"], accepted: ["type", "r"] },
		]);
	});

	it("unescapes a JSON Pointer $ref, as core emits for an identifier containing / and ~", () => {
		const params = Schema.Struct({ inner: Schema.Struct({ ok: Schema.String }).annotate({ identifier: "a/b~c" }) });
		const schema = served(params, true);
		assert.strictEqual((schema.properties as Record<string, Record<string, unknown>>).inner.$ref, "#/$defs/a~1b~0c");
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ inner: { ok: "1", nope: 2 } }, schema), [
			{ path: ["inner"], unknown: ["nope"], accepted: ["ok"] },
		]);
	});

	it("accepts a declared property literally named __proto__ without flagging it", () => {
		const schema = JSON.parse(
			'{"type":"object","properties":{"__proto__":{"type":"string"},"id":{"type":"string"}},"additionalProperties":false}',
		);
		const payload = JSON.parse('{"__proto__":"x","id":"1","extra":1}');
		assert.deepStrictEqual(ToolInputSchema.unknownKeys(payload, schema), [
			{ path: [], unknown: ["extra"], accepted: ["__proto__", "id"] },
		]);
	});

	it("skips a discriminated union when the payload omits the discriminant entirely", () => {
		const schema = {
			anyOf: [closed({ action: { const: "start" }, id: str }), closed({ action: { const: "stop" }, reason: str })],
		};
		assert.deepStrictEqual(ToolInputSchema.unknownKeys({ id: "1", extra: 1 }, schema), []);
	});

	it("examines an object 256 levels deep and stops at 257", () => {
		const schema = { $ref: "#/$defs/Node", $defs: { Node: closed({ child: { $ref: "#/$defs/Node" } }) } };
		const nest = (levels: number): unknown => {
			let payload: Record<string, unknown> = { extra: 1 };
			for (let i = 0; i < levels; i++) payload = { child: payload };
			return payload;
		};
		const at256 = ToolInputSchema.unknownKeys(nest(256), schema);
		assert.strictEqual(at256.length, 1);
		assert.strictEqual(at256[0]?.path.length, 256);
		assert.deepStrictEqual(at256[0]?.unknown, ["extra"]);
		assert.deepStrictEqual(ToolInputSchema.unknownKeys(nest(257), schema), []);
	});
});

describe("ToolInputSchema.formatUnknownKeys", () => {
	it("renders one sentence pair per level, qualified by path", () => {
		assert.strictEqual(
			ToolInputSchema.formatUnknownKeys([
				{ path: [], unknown: ["extra"], accepted: ["text", "nested"] },
				{ path: ["nested"], unknown: ["bogus"], accepted: ["flag"] },
			]),
			"Unrecognized parameter(s): extra. Accepted params: text, nested. Unrecognized parameter(s): nested.bogus. Accepted params: flag.",
		);
	});

	it("says (none) for a level that accepts nothing", () => {
		assert.strictEqual(
			ToolInputSchema.formatUnknownKeys([{ path: [], unknown: ["x"], accepted: [] }]),
			"Unrecognized parameter(s): x. Accepted params: (none).",
		);
	});

	it("truncates each echoed key path at echoLimit", () => {
		assert.strictEqual(
			ToolInputSchema.formatUnknownKeys([{ path: [], unknown: ["k".repeat(50)], accepted: [] }], { echoLimit: 10 }),
			`Unrecognized parameter(s): ${"k".repeat(10)}…. Accepted params: (none).`,
		);
	});

	it("caps the levels at 20 and ends with a sentence saying how many were left out", () => {
		const levels = Array.from({ length: 25 }, (_, i) => ({ path: [`p${i}`], unknown: ["x"], accepted: [] }));
		const text = ToolInputSchema.formatUnknownKeys(levels);
		assert.include(text, "p19.x");
		assert.notInclude(text, "p20.x");
		assert.isTrue(text.endsWith("Accepted params: (none). (and 5 more levels)."), text);
	});

	it("caps a hostile flood of keys at 20 and says how many were left out", () => {
		const unknown = Array.from({ length: 25 }, (_, i) => `k${i}`);
		const text = ToolInputSchema.formatUnknownKeys([{ path: [], unknown, accepted: [] }]);
		assert.include(text, "k19");
		assert.notInclude(text, "k20,");
		assert.include(text, "(and 5 more)");
	});
});

describe("ToolInputSchema.objectRooted", () => {
	it("rewrites a top-level action union to an object root with oneOf and x-discriminator", () => {
		const start = closed({ action: { const: "start" }, id: str });
		const stop = closed({ action: { const: "stop" }, reason: str });
		assert.deepStrictEqual(ToolInputSchema.objectRooted({ anyOf: [start, stop] }), {
			type: "object",
			oneOf: [start, stop],
			"x-discriminator": "action",
		});
	});

	it("inlines a root $ref, keeping $defs", () => {
		const defs = { Root: closed({ id: str }) };
		assert.deepStrictEqual(ToolInputSchema.objectRooted({ $ref: "#/$defs/Root", $defs: defs }), {
			...closed({ id: str }),
			$defs: defs,
		});
	});

	it("returns an already object-rooted schema as the same value", () => {
		const schema = closed({ id: str });
		assert.strictEqual(ToolInputSchema.objectRooted(schema), schema);
	});

	it("leaves a union with no shared discriminant alone", () => {
		const schema = { anyOf: [closed({ a: str }), closed({ b: str })] };
		assert.strictEqual(ToolInputSchema.objectRooted(schema), schema);
	});
});
