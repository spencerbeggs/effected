import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Schema } from "effect";
import { Comparator, InvalidComparatorError, SemVer } from "../src/index.js";

describe("Comparator", () => {
	describe("parse", () => {
		it.effect("parses operator and version", () =>
			Effect.gen(function* () {
				const c = yield* Comparator.parse(">=1.2.3");
				assert.strictEqual(c.operator, ">=");
				assert.strictEqual(c.version.toString(), "1.2.3");
			}),
		);

		it.effect("defaults to = when no operator is given", () =>
			Effect.gen(function* () {
				const c = yield* Comparator.parse("1.2.3");
				assert.strictEqual(c.operator, "=");
			}),
		);

		it.effect("rejects wildcards and range sugar", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Comparator.parse(">=1.x"));
				assert.instanceOf(error, InvalidComparatorError);
				assert.strictEqual(error._tag, "InvalidComparatorError");
				assert.strictEqual(error.input, ">=1.x");
			}),
		);

		it.effect("rejects doubled operators", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Comparator.parse(">>1.0.0"));
				assert.strictEqual(error._tag, "InvalidComparatorError");
			}),
		);
	});

	describe("FromString", () => {
		it.effect("decodes and encodes canonically", () =>
			Effect.gen(function* () {
				const c = yield* Schema.decodeUnknownEffect(Comparator.FromString)("<=2.0.0");
				assert.instanceOf(c, Comparator);
				const encoded = yield* Schema.encodeUnknownEffect(Comparator.FromString)(c);
				assert.strictEqual(encoded, "<=2.0.0");
			}),
		);

		it.effect.prop("round-trips decode(encode(c))", [Comparator], ([c]) =>
			Effect.gen(function* () {
				const encoded = yield* Schema.encodeUnknownEffect(Comparator.FromString)(c);
				const decoded = yield* Schema.decodeUnknownEffect(Comparator.FromString)(encoded);
				assert.isTrue(Equal.equals(decoded, c), `expected ${decoded.toString()} to equal ${c.toString()}`);
				assert.deepStrictEqual([...decoded.version.build], [...c.version.build]);
			}),
		);
	});

	describe("test", () => {
		it.effect("evaluates every operator against SemVer precedence", () =>
			Effect.gen(function* () {
				const v = yield* SemVer.parse("1.5.0");
				assert.isTrue((yield* Comparator.parse(">=1.0.0")).test(v));
				assert.isTrue((yield* Comparator.parse(">1.0.0")).test(v));
				assert.isTrue((yield* Comparator.parse("<2.0.0")).test(v));
				assert.isTrue((yield* Comparator.parse("<=1.5.0")).test(v));
				assert.isTrue((yield* Comparator.parse("1.5.0")).test(v));
				assert.isFalse((yield* Comparator.parse(">2.0.0")).test(v));
				assert.isFalse((yield* Comparator.parse("=1.0.0")).test(v));
			}),
		);

		it.effect("ignores build metadata when matching", () =>
			Effect.gen(function* () {
				const c = yield* Comparator.parse("1.5.0+abc");
				assert.isTrue(c.test(yield* SemVer.parse("1.5.0+xyz")));
			}),
		);
	});

	describe("toString", () => {
		it.effect("prints the operator with = implicit", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* Comparator.parse(">=1.2.3")).toString(), ">=1.2.3");
				assert.strictEqual((yield* Comparator.parse("=1.2.3")).toString(), "1.2.3");
				assert.strictEqual((yield* Comparator.parse("1.2.3")).toString(), "1.2.3");
			}),
		);
	});
});
