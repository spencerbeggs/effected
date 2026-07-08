import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { InvalidSpdxLicenseError, SpdxLicense, isValidSpdx } from "../src/License.js";

describe("isValidSpdx", () => {
	it("accepts identifiers, expressions and npm special cases", () => {
		for (const value of ["MIT", "Apache-2.0", "(MIT OR Apache-2.0)", "UNLICENSED", "SEE LICENSE IN LICENSE.txt"]) {
			assert.isTrue(isValidSpdx(value), value);
		}
	});

	it("rejects nonsense and bare SEE LICENSE IN", () => {
		for (const value of ["NOT-A-LICENSE", "totally made up", "SEE LICENSE IN "]) {
			assert.isFalse(isValidSpdx(value), value);
		}
	});
});

describe("SpdxLicense schema", () => {
	it.effect("decodes a valid license and rejects an invalid one", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* Schema.decodeUnknownEffect(SpdxLicense)("MIT"), "MIT");
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(SpdxLicense)("NOT-A-LICENSE"));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);
});

describe("InvalidSpdxLicenseError", () => {
	it("renders a message", () => {
		const error = new InvalidSpdxLicenseError({ input: "NOT-A-LICENSE" });
		assert.strictEqual(error._tag, "InvalidSpdxLicenseError");
		assert.include(error.message, "NOT-A-LICENSE");
	});
});
