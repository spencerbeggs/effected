import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Comparator, InvalidComparatorError, SemVer } from "../src/index.js";

const parse = (input: string) => Effect.runSync(Comparator.parse(input));
const version = (input: string) => Effect.runSync(SemVer.parse(input));

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
	});

	describe("test", () => {
		it("evaluates every operator against SemVer precedence", () => {
			const v = version("1.5.0");
			assert.isTrue(parse(">=1.0.0").test(v));
			assert.isTrue(parse(">1.0.0").test(v));
			assert.isTrue(parse("<2.0.0").test(v));
			assert.isTrue(parse("<=1.5.0").test(v));
			assert.isTrue(parse("1.5.0").test(v));
			assert.isFalse(parse(">2.0.0").test(v));
			assert.isFalse(parse("=1.0.0").test(v));
		});

		it("ignores build metadata when matching", () => {
			assert.isTrue(parse("1.5.0+abc").test(version("1.5.0+xyz")));
		});
	});

	describe("toString", () => {
		it("prints the operator with = implicit", () => {
			assert.strictEqual(parse(">=1.2.3").toString(), ">=1.2.3");
			assert.strictEqual(parse("=1.2.3").toString(), "1.2.3");
			assert.strictEqual(parse("1.2.3").toString(), "1.2.3");
		});
	});
});
