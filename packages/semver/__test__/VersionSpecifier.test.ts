import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Result, Schema } from "effect";
import { InvalidVersionSpecifierError, SemVer, VersionSpecifier } from "../src/index.js";

const OPERATORS = ["", "^", "~", ">=", ">", "<=", "<", "="] as const;

const refused = [
	"^ 1.2.3",
	" ^1.2.3 ",
	"^1.2.3 ",
	"^1.2",
	"1.x",
	"*",
	"",
	"v1.2.3",
	"^v1.2.3",
	">=1.2.3 <2.0.0",
	"1.2.3 || 2.0.0",
	"1.2.3 - 2.0.0",
	"workspace:*",
	"catalog:",
	"^^1.2.3",
	">==1.2.3",
	"=>1.2.3",
	"latest",
];

describe("VersionSpecifier", () => {
	describe("parseResult", () => {
		for (const operator of OPERATORS) {
			it(`round-trips the "${operator}" operator byte-exact`, () => {
				const input = `${operator}1.2.3`;
				const result = VersionSpecifier.parseResult(input);
				assert.isTrue(Result.isSuccess(result));
				if (Result.isSuccess(result)) {
					assert.strictEqual(result.success.operator, operator);
					assert.strictEqual(result.success.version.toString(), "1.2.3");
					assert.strictEqual(result.success.toString(), input);
				}
			});
		}

		it("keeps the longest operator (>= is not > then =)", () => {
			const result = VersionSpecifier.parseResult(">=1.2.3");
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) assert.strictEqual(result.success.operator, ">=");
		});

		it("keeps prerelease and build metadata", () => {
			const result = VersionSpecifier.parseResult("^1.2.3-beta.1+b");
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) assert.strictEqual(result.success.toString(), "^1.2.3-beta.1+b");
		});

		for (const input of refused) {
			it(`refuses ${JSON.stringify(input)}`, () => {
				const result = VersionSpecifier.parseResult(input);
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) {
					assert.instanceOf(result.failure, InvalidVersionSpecifierError);
					assert.strictEqual(result.failure.input, input);
				}
			});
		}
	});

	describe("parse", () => {
		it.effect("agrees with parseResult", () =>
			Effect.gen(function* () {
				const spec = yield* VersionSpecifier.parse("~1.2.3");
				assert.strictEqual(spec.operator, "~");
				const error = yield* Effect.flip(VersionSpecifier.parse(">=1.2.3 <2.0.0"));
				assert.strictEqual(error._tag, "InvalidVersionSpecifierError");
			}),
		);
	});

	describe("withVersion", () => {
		it("keeps the operator and swaps the version", () => {
			const spec = VersionSpecifier.make({ operator: "^", version: SemVer.of(1, 2, 3) });
			assert.strictEqual(spec.withVersion(SemVer.of(2, 0, 0)).toString(), "^2.0.0");
		});
	});

	describe("FromString", () => {
		it("decodes and encodes", () => {
			const decoded = Schema.decodeUnknownSync(VersionSpecifier.FromString)("~1.2.3");
			assert.strictEqual(decoded.operator, "~");
			assert.strictEqual(Schema.encodeSync(VersionSpecifier.FromString)(decoded), "~1.2.3");
		});

		it("refuses a compound range", () => {
			assert.throws(() => Schema.decodeUnknownSync(VersionSpecifier.FromString)(">=1.2.3 <2.0.0"));
		});

		it.effect.prop("round-trips decode(encode(v))", [VersionSpecifier], ([v]) =>
			Effect.gen(function* () {
				const text = Schema.encodeSync(VersionSpecifier.FromString)(v);
				const back = yield* Schema.decodeEffect(VersionSpecifier.FromString)(text);
				assert.isTrue(Equal.equals(back, v));
				assert.strictEqual(back.toString(), text);
			}),
		);
	});
});
