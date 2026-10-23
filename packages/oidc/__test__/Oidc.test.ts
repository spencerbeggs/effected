import { assert, describe, it } from "@effect/vitest";
import { TestIssuer } from "@effected/jwt/testing";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { IdTokenClaims, Oidc } from "../src/index.js";

const ISSUER = "https://accounts.example.com";
const NOW_MILLIS = 1_800_000_000_000;
const NOW = NOW_MILLIS / 1000;

type Issuer = Effect.Success<ReturnType<typeof TestIssuer.make>>;

/** Run `use` against a fresh issuer double, with the clock pinned. */
const withIssuer = <A, E>(use: (issuer: Issuer) => Effect.Effect<A, E, never>) =>
	Effect.gen(function* () {
		yield* TestClock.setTime(NOW_MILLIS);
		const issuer = yield* TestIssuer.make({ issuer: ISSUER });
		return yield* use(issuer);
	});

const ID_TOKEN = {
	sub: "user-1",
	aud: "client-1",
	azp: "client-1",
	nonce: "n-0S6_WzA2Mj",
	auth_time: NOW - 5,
	acr: "urn:example:loa:2",
	amr: ["pwd", "mfa"],
	email: "user@example.com",
};

describe("Oidc.verify", () => {
	it.effect("verifies an ID token into IdTokenClaims, keeping claims the schema does not name", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign(ID_TOKEN);
				const claims = yield* Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
					Effect.provide(issuer.resolverLayer),
				);
				assert.strictEqual(claims.iss, ISSUER);
				assert.strictEqual(claims.sub, "user-1");
				assert.strictEqual(claims.azp, "client-1");
				assert.strictEqual(claims.nonce, "n-0S6_WzA2Mj");
				assert.strictEqual(claims.auth_time, NOW - 5);
				assert.strictEqual(claims.acr, "urn:example:loa:2");
				assert.deepStrictEqual(claims.amr, ["pwd", "mfa"]);
				assert.strictEqual(claims.email, "user@example.com");
			}),
		),
	);

	it.effect("accepts any of several audiences", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign(ID_TOKEN);
				const claims = yield* Oidc.verify(token, {
					issuer: ISSUER,
					audience: ["other", "client-1"],
					claims: IdTokenClaims,
				}).pipe(Effect.provide(issuer.resolverLayer));
				assert.strictEqual(claims.aud, "client-1");
			}),
		),
	);

	it.effect("decodes with a caller-supplied provider schema", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const Provider = Schema.Struct({ email: Schema.String, sub: Schema.String });
				const token = yield* issuer.sign(ID_TOKEN);
				const claims = yield* Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: Provider }).pipe(
					Effect.provide(issuer.resolverLayer),
				);
				assert.deepStrictEqual(claims, { email: "user@example.com", sub: "user-1" });
			}),
		),
	);

	it.effect("refuses a token minted for another audience as wrongAudience", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign({ ...ID_TOKEN, aud: "someone-else" });
				const error = yield* Effect.flip(
					Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
						Effect.provide(issuer.resolverLayer),
					),
				);
				assert.strictEqual(error.reason, "wrongAudience");
			}),
		),
	);

	it.effect("refuses an empty audience before reading the token", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				// The token is not even a JWS: had the guard run after the split, every
				// case would fail as malformed instead. A token whose aud is "" signed
				// by the real issuer would otherwise verify against audience "".
				const signed = yield* issuer.sign({ ...ID_TOKEN, aud: "" });
				const cases: ReadonlyArray<readonly [string, string | ReadonlyArray<string>]> = [
					["not-a-token", ""],
					["not-a-token", []],
					["not-a-token", ["client-1", ""]],
					[signed, ""],
				];
				const reasons = yield* Effect.forEach(cases, ([token, audience]) =>
					Effect.flip(
						Oidc.verify(token, { issuer: ISSUER, audience, claims: IdTokenClaims }).pipe(
							Effect.provide(issuer.resolverLayer),
						),
					).pipe(Effect.map((error) => error.reason)),
				);
				assert.deepStrictEqual(reasons, ["wrongAudience", "wrongAudience", "wrongAudience", "wrongAudience"]);
				// The control: the same garbage with a real audience is malformed.
				const control = yield* Effect.flip(
					Oidc.verify("not-a-token", { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
						Effect.provide(issuer.resolverLayer),
					),
				);
				assert.strictEqual(control.reason, "malformed");
			}),
		),
	);

	it.effect("refuses a token signed by the issuer's key but naming another issuer as wrongIssuer", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign({ ...ID_TOKEN, iss: "https://evil.example" });
				const error = yield* Effect.flip(
					Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
						Effect.provide(issuer.resolverLayer),
					),
				);
				assert.strictEqual(error.reason, "wrongIssuer");
			}),
		),
	);

	it.effect("looks keys up for the configured issuer, never the token's own iss", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const ownKid = yield* TestIssuer.make({ issuer: "https://evil.example", kid: "evil-key" });
				const reusedKid = yield* TestIssuer.make({ issuer: "https://evil.example" });
				const reasons = yield* Effect.forEach([ownKid, reusedKid], (foreign) =>
					Effect.gen(function* () {
						const token = yield* foreign.sign(ID_TOKEN);
						const error = yield* Effect.flip(
							Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
								Effect.provide(issuer.resolverLayer),
							),
						);
						return error.reason;
					}),
				);
				assert.deepStrictEqual(reasons, ["unknownKid", "badSignature"]);
			}),
		),
	);

	it.effect("refuses a payload whose OIDC claims are the wrong type as claims", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign({ ...ID_TOKEN, amr: "pwd" });
				const error = yield* Effect.flip(
					Oidc.verify(token, { issuer: ISSUER, audience: "client-1", claims: IdTokenClaims }).pipe(
						Effect.provide(issuer.resolverLayer),
					),
				);
				assert.strictEqual(error.reason, "claims");
			}),
		),
	);

	it.effect("passes clockTolerance through", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				// Expired 30 seconds ago: inside the default 60-second tolerance, outside zero.
				const token = yield* issuer.sign({ ...ID_TOKEN, iat: NOW - 600, exp: NOW - 30 });
				const run = (clockTolerance?: "0 seconds") =>
					Oidc.verify(token, {
						issuer: ISSUER,
						audience: "client-1",
						claims: IdTokenClaims,
						...(clockTolerance !== undefined ? { clockTolerance } : {}),
					}).pipe(Effect.provide(issuer.resolverLayer));
				const claims = yield* run();
				assert.strictEqual(claims.exp, NOW - 30);
				const error = yield* Effect.flip(run("0 seconds"));
				assert.strictEqual(error.reason, "expired");
			}),
		),
	);
});

describe("Oidc.decodeUnverified", () => {
	it.effect("decodes a token's claims without checking signature, issuer, audience or time", () =>
		withIssuer(() =>
			Effect.gen(function* () {
				// Signed by an issuer nobody trusts, for a stranger, long expired.
				const stranger = yield* TestIssuer.make({ issuer: "https://evil.example" });
				const token = yield* stranger.sign({ ...ID_TOKEN, aud: "nobody", iat: 1, exp: 2 });
				const claims = yield* Oidc.decodeUnverified(token, IdTokenClaims);
				assert.strictEqual(claims.iss, "https://evil.example");
				assert.strictEqual(claims.aud, "nobody");
				assert.strictEqual(claims.nonce, ID_TOKEN.nonce);
			}),
		),
	);

	it.effect("fails as malformed when the token is not a compact JWS", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Oidc.decodeUnverified("a.b", IdTokenClaims));
			assert.strictEqual(error._tag, "JwtError");
			assert.strictEqual(error.reason, "malformed");
		}),
	);

	it.effect("fails as claims when the payload does not decode", () =>
		withIssuer((issuer) =>
			Effect.gen(function* () {
				const token = yield* issuer.sign({ ...ID_TOKEN, auth_time: "yesterday" });
				const error = yield* Effect.flip(Oidc.decodeUnverified(token, IdTokenClaims));
				assert.strictEqual(error.reason, "claims");
			}),
		),
	);
});
