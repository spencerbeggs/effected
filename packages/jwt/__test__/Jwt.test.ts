import { assert, describe, it } from "@effect/vitest";
import { Context, Duration, Effect, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { TestClock } from "effect/testing";
import { Jws } from "../src/Jws.js";
import { Jwt, RegisteredClaims } from "../src/Jwt.js";
import type { JwtError } from "../src/JwtError.js";
import type { SigningKey, VerificationKey } from "../src/JwtKey.js";
import { JwtKey } from "../src/JwtKey.js";

// 2026-10-09T00:00:00Z, in seconds.
const NOW = 1_791_504_000;

const Claims = Schema.Struct({ sub: Schema.String });

const reasonOf = <A, R>(effect: Effect.Effect<A, JwtError, R>) =>
	Effect.map(Effect.flip(effect), (error) => error.reason);

const setup = Effect.gen(function* () {
	yield* TestClock.setTime(NOW * 1000);
	return yield* JwtKey.generate("ES256", { kid: "k" });
});

// A token whose payload is raw JSON text, for values JSON.stringify cannot write (1e400).
const rawToken = (pair: { readonly signing: SigningKey }, payloadJson: string) =>
	Effect.gen(function* () {
		const header = Base64Url.encode(JSON.stringify({ alg: "ES256", typ: "JWT" }));
		const input = `${header}.${Base64Url.encode(payloadJson)}`;
		const signature = yield* Effect.promise(() =>
			globalThis.crypto.subtle.sign(
				{ name: "ECDSA", hash: "SHA-256" },
				pair.signing.key,
				new TextEncoder().encode(input),
			),
		);
		return `${input}.${Base64Url.encode(new Uint8Array(signature))}`;
	});

describe("Jwt.verify time claims", () => {
	it.effect("exp at now - 59s passes and at now - 60s is expired (default 60s tolerance)", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const ok = yield* Jwt.sign({ sub: "a", exp: NOW - 59 }, pair.signing);
			assert.deepStrictEqual(yield* Jwt.verify(ok, { key: pair.verification, claims: Claims }), { sub: "a" });
			const late = yield* Jwt.sign({ sub: "a", exp: NOW - 60 }, pair.signing);
			const error = yield* Effect.flip(Jwt.verify(late, { key: pair.verification, claims: Claims }));
			assert.strictEqual(error.reason, "expired");
			assert.strictEqual(error.kid, "k");
		}),
	);

	it.effect("honours a configured tolerance and fractional NumericDates", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const options = { key: pair.verification, claims: Claims, clockTolerance: Duration.seconds(0) };
			const ok = yield* Jwt.sign({ sub: "a", exp: NOW + 0.5 }, pair.signing);
			yield* Jwt.verify(ok, options);
			const edge = yield* Jwt.sign({ sub: "a", exp: NOW }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(edge, options)), "expired");
			yield* TestClock.setTime(NOW * 1000 - 400);
			yield* Jwt.verify(edge, options);
		}),
	);

	it.effect("a negative, infinite or unparseable clock tolerance is claims", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const token = yield* Jwt.sign({ sub: "a", exp: NOW + 600 }, pair.signing);
			for (const clockTolerance of [Duration.seconds(-1), Duration.infinity, "a while" as Duration.Input, Number.NaN]) {
				const reason = yield* reasonOf(Jwt.verify(token, { key: pair.verification, claims: Claims, clockTolerance }));
				assert.strictEqual(reason, "claims", String(clockTolerance));
			}
			yield* Jwt.verify(token, { key: pair.verification, claims: Claims, clockTolerance: "5 seconds" });
			yield* Jwt.verify(token, { key: pair.verification, claims: Claims, clockTolerance: 0 });
		}),
	);

	it.effect("nbf at now + 61s is notYetValid and at now + 60s passes", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const early = yield* Jwt.sign({ sub: "a", exp: NOW + 600, nbf: NOW + 61 }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(early, { key: pair.verification, claims: Claims })), "notYetValid");
			const edge = yield* Jwt.sign({ sub: "a", exp: NOW + 600, nbf: NOW + 60 }, pair.signing);
			yield* Jwt.verify(edge, { key: pair.verification, claims: Claims });
		}),
	);

	it.effect("iat in the future beyond the tolerance is notYetValid", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const future = yield* Jwt.sign({ sub: "a", exp: NOW + 600, iat: NOW + 61 }, pair.signing);
			assert.strictEqual(
				yield* reasonOf(Jwt.verify(future, { key: pair.verification, claims: Claims })),
				"notYetValid",
			);
			const edge = yield* Jwt.sign({ sub: "a", exp: NOW + 600, iat: NOW + 60 }, pair.signing);
			yield* Jwt.verify(edge, { key: pair.verification, claims: Claims });
		}),
	);

	it.effect("a missing exp is claims, and passes with requireExpiry: false", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const token = yield* Jwt.sign({ sub: "a" }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(token, { key: pair.verification, claims: Claims })), "claims");
			const verified = yield* Jwt.verify(token, { key: pair.verification, claims: Claims, requireExpiry: false });
			assert.deepStrictEqual(verified, { sub: "a" });
		}),
	);

	it.effect("a non-finite or non-number exp, nbf or iat is claims", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const options = { key: pair.verification, claims: Claims, requireExpiry: false };
			for (const payload of [
				`{"sub":"a","exp":1e400}`,
				`{"sub":"a","exp":-1e400}`,
				`{"sub":"a","exp":"${NOW + 600}"}`,
				`{"sub":"a","exp":null}`,
				`{"sub":"a","nbf":1e400}`,
				`{"sub":"a","iat":"0"}`,
			]) {
				const token = yield* rawToken(pair, payload);
				assert.strictEqual(yield* reasonOf(Jwt.verify(token, options)), "claims", payload);
			}
		}),
	);

	it("RegisteredClaims refuses NaN, which JSON cannot carry but a decoded value could", () => {
		for (const exp of [Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.isTrue(Schema.decodeUnknownExit(RegisteredClaims)({ exp })._tag === "Failure");
		}
		assert.isTrue(Schema.decodeUnknownExit(RegisteredClaims)({ exp: 1.5 })._tag === "Success");
	});
});

describe("Jwt.verify issuer and audience", () => {
	it.effect("Review Focus 4: an aud array containing the audience passes; a missing aud is wrongAudience", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const options = { key: pair.verification, claims: Claims, audience: "silk" };
			const many = yield* Jwt.sign({ sub: "a", exp: NOW + 600, aud: ["x", "silk"] }, pair.signing);
			yield* Jwt.verify(many, options);
			const single = yield* Jwt.sign({ sub: "a", exp: NOW + 600, aud: "silk" }, pair.signing);
			yield* Jwt.verify(single, options);
			const missing = yield* Jwt.sign({ sub: "a", exp: NOW + 600 }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(missing, options)), "wrongAudience");
			const other = yield* Jwt.sign({ sub: "a", exp: NOW + 600, aud: ["x", "y"] }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(other, options)), "wrongAudience");
			const empty = yield* Jwt.sign({ sub: "a", exp: NOW + 600, aud: [] }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(empty, options)), "wrongAudience");
			// an expected list matches if any expected value is present
			yield* Jwt.verify(many, { ...options, audience: ["nope", "x"] });
		}),
	);

	it.effect("a wrong or missing iss is wrongIssuer; any listed issuer passes", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const options = { key: pair.verification, claims: Claims, issuer: "https://token.actions.githubusercontent.com" };
			const right = yield* Jwt.sign({ sub: "a", exp: NOW + 600, iss: options.issuer }, pair.signing);
			yield* Jwt.verify(right, options);
			const wrong = yield* Jwt.sign({ sub: "a", exp: NOW + 600, iss: "https://evil.example" }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(wrong, options)), "wrongIssuer");
			const missing = yield* Jwt.sign({ sub: "a", exp: NOW + 600 }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(missing, options)), "wrongIssuer");
			yield* Jwt.verify(wrong, { ...options, issuer: ["https://other", "https://evil.example"] });
		}),
	);

	it.effect("quotes and caps an attacker-supplied iss in the detail", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const token = yield* Jwt.sign({ sub: "a", exp: NOW + 600, iss: `\u001b[2J${"x".repeat(5000)}` }, pair.signing);
			const error = yield* Effect.flip(Jwt.verify(token, { key: pair.verification, claims: Claims, issuer: "i" }));
			assert.strictEqual(error.reason, "wrongIssuer");
			assert.isBelow(error.detail.length, 160);
			assert.notInclude(error.detail, "\u001b");
		}),
	);
});

describe("Jwt.verify claims decoding", () => {
	it.effect("decodes with the caller's schema, transformations included", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const token = yield* Jwt.sign({ sub: "a", exp: NOW + 600, run: "42" }, pair.signing);
			const verified = yield* Jwt.verify(token, {
				key: pair.verification,
				claims: Schema.Struct({ sub: Schema.String, run: Schema.NumberFromString }),
			});
			assert.deepStrictEqual(verified, { sub: "a", run: 42 });
		}),
	);

	it.effect("a payload the caller's schema refuses is claims", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const token = yield* Jwt.sign({ sub: 7, exp: NOW + 600 }, pair.signing);
			assert.strictEqual(yield* reasonOf(Jwt.verify(token, { key: pair.verification, claims: Claims })), "claims");
		}),
	);

	it.effect("a payload that is not a JSON object is claims", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			for (const payload of [["a"], "a", 1, null]) {
				const token = yield* Jws.sign(payload, pair.signing);
				const reason = yield* reasonOf(
					Jwt.verify(token, { key: pair.verification, claims: Schema.Unknown, requireExpiry: false }),
				);
				assert.strictEqual(reason, "claims", JSON.stringify(payload));
			}
		}),
	);

	it.effect("signature and algorithm failures surface before any claim is read", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			const other = yield* JwtKey.generate("ES256");
			const expiredAndForged = yield* Jwt.sign({ sub: "a", exp: 1 }, other.signing);
			assert.strictEqual(
				yield* reasonOf(Jwt.verify(expiredAndForged, { key: pair.verification, claims: Claims })),
				"badSignature",
			);
		}),
	);

	it.effect("passes a key resolver's requirements through to R", () =>
		Effect.gen(function* () {
			const pair = yield* setup;
			class Keys extends Context.Service<Keys, { readonly current: VerificationKey }>()("test/Keys") {}
			const token = yield* Jwt.sign({ sub: "a", exp: NOW + 600 }, pair.signing);
			const program = Jwt.verify(token, {
				key: () => Effect.map(Effect.service(Keys), (keys) => keys.current),
				claims: Claims,
			});
			const verified = yield* Effect.provideService(program, Keys, { current: pair.verification });
			assert.deepStrictEqual(verified, { sub: "a" });
		}),
	);
});
