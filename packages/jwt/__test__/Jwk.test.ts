import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { Jwk, Jwks } from "../src/Jwk.js";

const actionsJwks: unknown = JSON.parse(
	readFileSync(new URL("./fixtures/actions-jwks.json", import.meta.url), "utf-8"),
);

describe("Jwk", () => {
	it.effect("decodes GitHub's real Actions JWKS, keeping x5c and x5t", () =>
		Effect.gen(function* () {
			const jwks = yield* Schema.decodeUnknownEffect(Jwks)(actionsJwks);
			assert.isAbove(jwks.keys.length, 0);
			for (const key of jwks.keys) {
				assert.strictEqual(key.kty, "RSA");
				assert.isString(key.kid);
				assert.isString(key.n);
				assert.isString(key.e);
			}
			// the fixture's later keys carry certificate chains; decoding must not strip them
			const withChain = jwks.keys.filter((key) => key.x5c !== undefined);
			assert.isAbove(withChain.length, 0);
			assert.isTrue(withChain.every((key) => Array.isArray(key.x5c) && typeof key.x5t === "string"));
		}),
	);

	it.effect("preserves unknown members such as x5c", () =>
		Effect.gen(function* () {
			const input = { kty: "EC", crv: "P-256", x: "AQ", y: "Ag", x5c: ["MIIB"], ext: true } as const;
			const key = yield* Schema.decodeUnknownEffect(Jwk)(input);
			assert.deepStrictEqual(key.x5c, ["MIIB"]);
			assert.strictEqual(key.ext, true);
			assert.deepStrictEqual(yield* Schema.encodeEffect(Jwk)(key), input);
		}),
	);

	it.effect("rejects a symmetric oct key", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(Jwk)({ kty: "oct", k: "c2VjcmV0" }));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);

	it.effect("rejects a known member of the wrong type", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(Jwk)({ kty: "RSA", n: 1, e: "AQAB" }));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);
});

describe("Jwk private member", () => {
	it.effect("decodes d to a Redacted that does not print and encodes it back", () =>
		Effect.gen(function* () {
			const input = { kty: "EC", crv: "P-256", x: "AQ", y: "Ag", d: "c2VjcmV0LXNjYWxhcg" } as const;
			const key = yield* Schema.decodeUnknownEffect(Jwk)(input);
			assert.isTrue(key.d !== undefined && Redacted.isRedacted(key.d));
			if (key.d !== undefined) assert.strictEqual(Redacted.value(key.d), "c2VjcmV0LXNjYWxhcg");
			assert.notInclude(JSON.stringify(key), "c2VjcmV0LXNjYWxhcg");
			assert.notInclude(String(key.d), "c2VjcmV0LXNjYWxhcg");
			assert.deepStrictEqual(yield* Schema.encodeEffect(Jwk)(key), input);
		}),
	);

	it.effect("redacts every RSA private member and rejects multi-prime oth", () =>
		Effect.gen(function* () {
			const secrets = {
				d: "U0VDUkVURA",
				p: "U0VDUkVUUA",
				q: "U0VDUkVUUQ",
				dp: "U0VDUkVURFA",
				dq: "U0VDUkVURFE",
				qi: "U0VDUkVUUUk",
			};
			const input = { kty: "RSA", n: "AQAB", e: "AQAB", ...secrets } as const;
			const key = yield* Schema.decodeUnknownEffect(Jwk)(input);
			const printed = JSON.stringify(key);
			for (const secret of Object.values(secrets)) assert.notInclude(printed, secret);
			assert.deepStrictEqual(yield* Schema.encodeEffect(Jwk)(key), input);
			const error = yield* Effect.flip(
				Schema.decodeUnknownEffect(Jwk)({ ...input, oth: [{ r: "AQ", d: "AQ", t: "AQ" }] }),
			);
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);
});

describe("Jwks", () => {
	it.effect("keeps only the supported keys of a mixed set", () =>
		Effect.gen(function* () {
			const rsa = { kty: "RSA", kid: "r1", n: "AQAB", e: "AQAB" } as const;
			const jwks = yield* Schema.decodeUnknownEffect(Jwks)({
				keys: [
					rsa,
					{ kty: "OKP", crv: "Ed25519", x: "AA" },
					{ kty: "oct", k: "b2N0LXNlY3JldC1tYXRlcmlhbA" },
					{ kty: "EC", crv: 7 },
				],
			});
			assert.deepStrictEqual(jwks.keys, [rsa]);
			assert.notInclude(JSON.stringify(jwks), "b2N0LXNlY3JldC1tYXRlcmlhbA");
			assert.deepStrictEqual(yield* Schema.encodeEffect(Jwks)(jwks), { keys: [rsa] });
		}),
	);

	it.effect("still requires keys to be an array", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Schema.decodeUnknownEffect(Jwks)({ keys: {} }));
			assert.strictEqual(error._tag, "SchemaError");
		}),
	);
});
