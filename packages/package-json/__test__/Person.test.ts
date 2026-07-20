import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
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

// A formatter must not rewrite legal input into a different-but-equivalent
// encoding, so the wire form a person was read from survives the round trip.
describe("Person wire-form preservation", () => {
	const roundTrip = (input: unknown) =>
		Effect.flatMap(Schema.decodeUnknownEffect(Person.FromValue)(input), (person) =>
			Schema.encodeUnknownEffect(Person.FromValue)(person),
		);

	it.effect("re-encodes the shorthand string as a string, not an object", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				yield* roundTrip("Ann Lee <ann@x.dev> (https://x.dev)"),
				"Ann Lee <ann@x.dev> (https://x.dev)",
			);
		}),
	);

	it.effect("re-encodes a bare-name shorthand as a string", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* roundTrip("Solo"), "Solo");
		}),
	);

	it.effect("replays unusual-but-legal shorthand spacing and ordering verbatim", () =>
		Effect.gen(function* () {
			// Segment order and doubled spaces are not what the canonical
			// serializer would emit, so only verbatim replay reproduces them.
			assert.strictEqual(yield* roundTrip("Ann  (https://x.dev)  <ann@x.dev>"), "Ann  (https://x.dev)  <ann@x.dev>");
		}),
	);

	it.effect("keeps unknown keys on the object form instead of dropping them", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* roundTrip({ name: "Dee", twitter: "@dee" }), { name: "Dee", twitter: "@dee" });
		}),
	);

	it.effect("preserves the key order of the object form", () =>
		Effect.gen(function* () {
			const encoded = yield* roundTrip({ email: "e@x.dev", name: "Eve" });
			assert.deepStrictEqual(Object.keys(encoded as Record<string, unknown>), ["email", "name"]);
		}),
	);

	it.effect("re-encodes a hand-built person canonically as an object", () =>
		Effect.gen(function* () {
			const person = Person.make({ name: "Ed", email: "ed@x.dev" });
			assert.deepStrictEqual(yield* Schema.encodeUnknownEffect(Person.FromValue)(person), {
				name: "Ed",
				email: "ed@x.dev",
			});
		}),
	);

	it.effect("a rebuilt person loses its provenance and encodes as an object", () =>
		Effect.gen(function* () {
			// Rebuilding produces a new instance with no recorded wire form. Emitting
			// shorthand for it would be inventing an encoding this person was never
			// read in, so the canonical object form wins.
			const person = yield* Schema.decodeUnknownEffect(Person.FromValue)("Ann <ann@x.dev>");
			const edited = Person.make({ ...person, email: "new@x.dev" });
			assert.isTrue(Option.isNone(Person.wireStringOf(edited)));
			assert.deepStrictEqual(yield* Schema.encodeUnknownEffect(Person.FromValue)(edited), {
				name: "Ann",
				email: "new@x.dev",
			});
		}),
	);

	it.effect("an explicitly string-typed field re-serializes a rebuilt person canonically", () =>
		Effect.gen(function* () {
			// `FromString` has no object form to fall back to, so it rebuilds the
			// shorthand from the fields rather than replaying stale text.
			const person = yield* Schema.decodeUnknownEffect(Person.FromString)("Ann <ann@x.dev>");
			const edited = Person.make({ ...person, email: "new@x.dev" });
			assert.strictEqual(yield* Schema.encodeUnknownEffect(Person.FromString)(edited), "Ann <new@x.dev>");
		}),
	);

	it.effect("reports the shorthand text via wireStringOf, and None for the object form", () =>
		Effect.gen(function* () {
			const fromString = yield* Schema.decodeUnknownEffect(Person.FromValue)("Ann <ann@x.dev>");
			const fromObject = yield* Schema.decodeUnknownEffect(Person.FromValue)({ name: "Ann", email: "ann@x.dev" });
			assert.deepStrictEqual(Person.wireStringOf(fromString), Option.some("Ann <ann@x.dev>"));
			assert.isTrue(Option.isNone(Person.wireStringOf(fromObject)));
		}),
	);

	it.effect("still rejects a malformed person object", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(Schema.decodeUnknownEffect(Person.FromValue)({ name: 123 }));
			assert.isTrue(result._tag === "Failure");
		}),
	);
});
