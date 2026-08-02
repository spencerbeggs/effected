import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { CorepackIntegrityHash, IntegrityHash, InvalidIntegrityHashError, PackageManagerPin } from "../src/index.js";

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
		// sha224 is corepack-only: corepack's transparent default yarn pin emits
		// it, and the SRI spec does not include it.
		assert.isTrue(IntegrityHash.isCorepack("sha224.877304e3c9e5b53431969ee2ca17ee44f366533b0da5a4ba9c2bd447"));
		assert.isFalse(IntegrityHash.isSri("sha224-YWJj"));
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

// The corepack pin tail is the one place the kit meets the `<algo>.<hex>` form,
// and TWO schemas model it — `PackageManagerPin.integrity` here and
// `@effected/package-json`'s `PackageManager.integrity`. Both consume this
// export. The forms the wider brand accepts and this one must not are the
// point of the suite: an SRI or yarn hash in a pin tail is not a near-miss, it
// is a value that field can never legitimately hold.
describe("CorepackIntegrityHash", () => {
	const decode = Schema.decodeUnknownEffect(CorepackIntegrityHash);

	it.effect("accepts every corepack form, including corepack's own sha224 default pins", () =>
		Effect.gen(function* () {
			for (const good of [
				"sha512.deadbeef01",
				"sha256.0badf00d",
				"sha1.ac34549e6aa8e7ead463a7407e1c7390f61a6610",
				// corepack 0.34.0's own package.json pins yarn with a sha224 tail.
				"sha224.877304e3c9e5b53431969ee2ca17ee44f366533b0da5a4ba9c2bd447",
			]) {
				assert.strictEqual(yield* decode(good), good, good);
			}
		}),
	);

	it.effect("rejects the two other forms the IntegrityHash brand accepts", () =>
		Effect.gen(function* () {
			for (const wrongForm of ["sha512-tsPuRLBpQ2xk6+8HB4vP0Wq1v0EYlv6q6qz1oqTgU5U=", "10c0/deadbeef0123"]) {
				// The control: the unrestricted brand DOES accept it, so the failure
				// below is the restriction firing and not a malformed fixture.
				assert.strictEqual(yield* Schema.decodeUnknownEffect(IntegrityHash)(wrongForm), wrongForm, wrongForm);
				const error = yield* Effect.flip(decode(wrongForm));
				assert.strictEqual(error._tag, "SchemaError", wrongForm);
			}
		}),
	);

	it.effect("rejects malformed corepack-shaped hashes", () =>
		Effect.gen(function* () {
			// Uppercase hex, an unknown algorithm, an empty digest and an empty
			// string: each is rejected by the underlying brand or the restriction.
			for (const bad of ["sha512.DEADBEEF", "md5.deadbeef", "sha512.", "", "sha512"]) {
				const error = yield* Effect.flip(decode(bad));
				assert.strictEqual(error._tag, "SchemaError", bad);
			}
		}),
	);

	it.effect("decodes to the same brand as the unrestricted schema — no second brand", () =>
		Effect.gen(function* () {
			const restricted = yield* decode("sha512.deadbeef01");
			// Assignable in both directions at the type level (this line is the
			// assertion; it stops compiling if a second brand is introduced), and
			// equal at the value level.
			const wide: typeof IntegrityHash.Type = restricted;
			assert.strictEqual(wide, yield* Schema.decodeUnknownEffect(IntegrityHash)("sha512.deadbeef01"));
		}),
	);

	// The consolidation guard, and it has to be an IDENTITY assertion.
	//
	// `Schema.check` is erased from the built type, so a consumer that severs
	// this import type-checks; and a faithful private copy of the restriction
	// behaves identically, so the rejection matrix above passes too. Neither
	// `tsc` nor any behavioural test can see the re-fork. What discriminates is
	// the field schema's OBJECT IDENTITY: the pin's `integrity` field must be
	// this very schema, not one that merely agrees with it.
	it("PackageManagerPin.integrity IS this schema, not a copy that agrees with it", () => {
		// `Schema.optionalKey(X)` keeps `X` on `.schema`.
		assert.strictEqual(
			PackageManagerPin.fields.integrity.schema,
			CorepackIntegrityHash,
			"PackageManagerPin must consume the shared corepack schema, not re-derive the restriction",
		);
		// The control: the assertion discriminates. It is NOT satisfied by the
		// unrestricted brand, so it fails if the pin falls back to `IntegrityHash`
		// — the mutant a type error would never catch.
		assert.notStrictEqual(PackageManagerPin.fields.integrity.schema, IntegrityHash);
	});
});
