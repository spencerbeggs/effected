import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { PackageManager } from "../src/PackageManager.js";

describe("PackageManager.FromString", () => {
	it.effect("parses name, version and integrity", () =>
		Effect.gen(function* () {
			const pm = yield* Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0+sha512.abc");
			assert.strictEqual(pm.name, "pnpm");
			assert.strictEqual(pm.version, "10.33.0");
			assert.deepStrictEqual(pm.integrity, Option.some("sha512.abc"));
			assert.isTrue(pm.hasIntegrity);
		}),
	);

	it.effect("parses without integrity", () =>
		Effect.gen(function* () {
			const pm = yield* Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0");
			assert.deepStrictEqual(pm.integrity, Option.none());
			assert.isFalse(pm.hasIntegrity);
		}),
	);

	it.effect("round-trips encode(decode)", () =>
		Effect.gen(function* () {
			for (const input of ["pnpm@10.33.0+sha512.abc", "yarn@4.1.0", "npm@10.2.3-beta.1"]) {
				const pm = yield* Schema.decodeUnknownEffect(PackageManager.FromString)(input);
				assert.strictEqual(yield* Schema.encodeUnknownEffect(PackageManager.FromString)(pm), input);
			}
		}),
	);

	it.effect("rejects an invalid format", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(PackageManager.FromString)("not-a-pm"));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	// A well-formed `name@version+<integrity>` whose integrity is not a valid
	// `IntegrityHash` must fail typed through the decode, never construct the
	// branded field and escape as an unhandled defect.
	it.effect("rejects a malformed integrity as a typed failure, not a defect", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0+GARBAGE!!"));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	// The `packageManager` field only ever carries corepack's `<algo>.<hex>`
	// integrity. A valid SRI or yarn `10c0/` form — accepted by the wider
	// `IntegrityHash` brand — is too loose here and must fail typed, never
	// construct the field and escape as a defect.
	it.effect("rejects an SRI integrity (not the corepack form)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0+sha512-abcd1234=="),
			);
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	it.effect("rejects a yarn 10c0/ checksum integrity (not the corepack form)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0+10c0/abcdef0123"),
			);
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	it.effect("accepts a real corepack sha512.<hex> integrity", () =>
		Effect.gen(function* () {
			const pm = yield* Schema.decodeUnknownEffect(PackageManager.FromString)("pnpm@10.33.0+sha512.deadbeef");
			assert.deepStrictEqual(pm.integrity, Option.some("sha512.deadbeef"));
			assert.isTrue(pm.hasIntegrity);
		}),
	);
});
