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
