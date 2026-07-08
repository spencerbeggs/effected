import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Person } from "../src/Person.js";

describe("Person.FromString", () => {
	it.effect("parses the Name <email> (url) shorthand", () =>
		Effect.gen(function* () {
			const person = yield* Schema.decodeUnknownEffect(Person.FromString)("Jane Doe <jane@x.com> (https://x.com)");
			assert.strictEqual(person.name, "Jane Doe");
			assert.strictEqual(person.email, "jane@x.com");
			assert.strictEqual(person.url, "https://x.com");
			assert.strictEqual(
				yield* Schema.encodeUnknownEffect(Person.FromString)(person),
				"Jane Doe <jane@x.com> (https://x.com)",
			);
		}),
	);

	it.effect("parses a bare name", () =>
		Effect.gen(function* () {
			const person = yield* Schema.decodeUnknownEffect(Person.FromString)("Solo");
			assert.strictEqual(person.name, "Solo");
			assert.strictEqual(person.email, undefined);
		}),
	);
});

describe("Person.FromValue", () => {
	it.effect("accepts the structured object form", () =>
		Effect.gen(function* () {
			const person = yield* Schema.decodeUnknownEffect(Person.FromValue)({ name: "Bob", email: "b@x.com" });
			assert.strictEqual(person.name, "Bob");
			assert.strictEqual(person.email, "b@x.com");
			assert.deepStrictEqual(yield* Schema.encodeUnknownEffect(Person.FromValue)(person), {
				name: "Bob",
				email: "b@x.com",
			});
		}),
	);

	it.effect("accepts the shorthand string form", () =>
		Effect.gen(function* () {
			const person = yield* Schema.decodeUnknownEffect(Person.FromValue)("Ann <a@x.com>");
			assert.strictEqual(person.name, "Ann");
			assert.strictEqual(person.email, "a@x.com");
		}),
	);
});
