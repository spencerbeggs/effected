import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { IntegrityHash, InvalidIntegrityHashError } from "../src/index.js";

describe("IntegrityHash schema", () => {
	const sri = "sha512-tsPuRLBpQ2xk6+8HB4vP0Wq1v0EYlv6q6qz1oqTgU5U+lgY7Zp3Xf5sT2xM2mQ==";
	const corepack = "sha512.5be7cee7ff4d9c25bda31e3b5f6f3f9f2a";
	const yarn = "10c0/99a4b0f0e7991796b1e7e3f52dceb9137cae2a9dfc8fc0784a550dc4c558e15a";

	it.effect("accepts all three textual forms", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)(sri), sri);
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)(corepack), corepack);
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)(yarn), yarn);
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)("sha1-abcd"), "sha1-abcd");
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)("sha256.deadbeef"), "sha256.deadbeef");
			assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)("9c0/deadbeef"), "9c0/deadbeef");
		}),
	);

	it.effect("rejects malformed hashes", () =>
		Effect.gen(function* () {
			for (const bad of ["", "md5-abcd", "sha512-", "sha512.NOTHEX", "sha512.", "abc", "sha999.deadbeef"]) {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(IntegrityHash)(bad));
				assert.strictEqual(error._tag, "SchemaError", bad);
			}
		}),
	);
});

describe("IntegrityHash statics", () => {
	it("classifies SRI vs corepack vs yarn", () => {
		assert.isTrue(IntegrityHash.isSri("sha512-abc/def+=="));
		assert.isTrue(IntegrityHash.isSri("sha512-YWJj"));
		assert.isFalse(IntegrityHash.isCorepack("sha512-YWJj"));
		assert.isTrue(IntegrityHash.isCorepack("sha512.abc"));
		assert.isFalse(IntegrityHash.isSri("sha512.abc"));
		assert.isTrue(IntegrityHash.isYarnChecksum("10c0/deadbeef"));
		assert.isTrue(IntegrityHash.isYarnChecksum("9c0/abc123"));
		assert.isFalse(IntegrityHash.isYarnChecksum("sha512-YWJj"));
		assert.isFalse(IntegrityHash.isSri("10c0/deadbeef"));
		assert.isFalse(IntegrityHash.isCorepack("10c0/deadbeef"));
		assert.isTrue(IntegrityHash.isValid("10c0/deadbeef"));
		assert.isFalse(IntegrityHash.isValid("nope"));
	});

	it("extracts the algorithm from the SRI and corepack forms, none from yarn", () => {
		assert.deepStrictEqual(IntegrityHash.algorithmOf("sha512-YWJj"), Option.some("sha512"));
		assert.deepStrictEqual(IntegrityHash.algorithmOf("sha1.abcd"), Option.some("sha1"));
		assert.deepStrictEqual(IntegrityHash.algorithmOf("sha256.deadbeef"), Option.some("sha256"));
		// The yarn form is a valid integrity hash but names no algorithm.
		assert.isTrue(Option.isNone(IntegrityHash.algorithmOf("10c0/deadbeef")));
		assert.isTrue(Option.isNone(IntegrityHash.algorithmOf("not-a-hash")));
	});

	it.effect("decode returns the branded value and fails typed on garbage", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* IntegrityHash.decode("sha512.abc"), "sha512.abc");
			const error = yield* Effect.flip(IntegrityHash.decode("garbage"));
			assert.instanceOf(error, InvalidIntegrityHashError);
			assert.strictEqual(error._tag, "InvalidIntegrityHashError");
			assert.strictEqual(error.input, "garbage");
		}),
	);
});
