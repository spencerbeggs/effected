import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Jsonc, JsoncParseOptions, JsoncVisitor, JsoncVisitorEvent } from "../src/index.js";

describe("JsoncVisitor", () => {
	describe("visit", () => {
		it.effect("emits a well-formed event sequence for an object", () =>
			Effect.gen(function* () {
				const events = yield* Stream.runCollect(JsoncVisitor.visit('{ "a": 1 }'));
				const tags = events.map((e) => e._tag);
				assert.deepStrictEqual(tags, ["ObjectBegin", "ObjectProperty", "Separator", "LiteralValue", "ObjectEnd"]);
			}),
		);

		it.effect("carries path context on literal events", () =>
			Effect.gen(function* () {
				const events = yield* Stream.runCollect(JsoncVisitor.visit('{ "a": { "b": 42 } }'));
				const literal = events.find(JsoncVisitorEvent.$is("LiteralValue"));
				assert.isDefined(literal);
				assert.deepStrictEqual([...(literal?.path ?? [])], ["a", "b"]);
				assert.strictEqual(literal?.value, 42);
			}),
		);

		it.effect("filter + take enables early termination", () =>
			Effect.gen(function* () {
				const events = yield* JsoncVisitor.visit('{ "a": 1, "b": 2, "c": 3 }').pipe(
					Stream.filter(JsoncVisitorEvent.$is("LiteralValue")),
					Stream.take(1),
					Stream.runCollect,
				);
				assert.strictEqual(events.length, 1);
				assert.strictEqual(events[0].value, 1);
			}),
		);

		it.effect("surfaces malformed input as Error events in the union", () =>
			Effect.gen(function* () {
				const events = yield* Stream.runCollect(JsoncVisitor.visit("{ bad }"));
				assert.isTrue(events.some(JsoncVisitorEvent.$is("Error")));
			}),
		);

		it.effect("emits Comment events by default and Error when comments are disallowed", () =>
			Effect.gen(function* () {
				const withComments = yield* Stream.runCollect(JsoncVisitor.visit('{ "a": 1 } // c'));
				assert.isTrue(withComments.some(JsoncVisitorEvent.$is("Comment")));

				const disallowed = yield* Stream.runCollect(
					JsoncVisitor.visit('{ "a": 1 } // c', JsoncParseOptions.make({ disallowComments: true })),
				);
				assert.isTrue(disallowed.some((e) => JsoncVisitorEvent.$is("Error")(e) && e.code === "InvalidCommentToken"));
			}),
		);
	});

	describe("event constructors", () => {
		it("build tagged, structurally-equal events", () => {
			const event = JsoncVisitorEvent.Comment({ offset: 0, length: 3 });
			assert.strictEqual(event._tag, "Comment");
			assert.strictEqual(event.offset, 0);
		});
	});

	describe("visitCollect replacement", () => {
		it.effect("Stream.filter + runCollect covers the dropped convenience", () =>
			Effect.gen(function* () {
				const props = yield* JsoncVisitor.visit('{ "name": "x", "age": 1 }').pipe(
					Stream.filter(JsoncVisitorEvent.$is("ObjectProperty")),
					Stream.map((e) => e.property),
					Stream.runCollect,
				);
				assert.deepStrictEqual([...props], ["name", "age"]);
				// Sanity: parity with a full parse.
				assert.deepStrictEqual(yield* Jsonc.parse('{ "name": "x", "age": 1 }'), { name: "x", age: 1 });
			}),
		);
	});
});
