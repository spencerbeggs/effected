// The README's examples, compiled and run, so the published page cannot drift from the API.
import { generateKeyPairSync } from "node:crypto";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import type { Jwk } from "../src/index.js";
import { JwksResolver, JwksStore, Jwt, JwtKey } from "../src/index.js";
import { TestIssuer } from "../src/testing.js";

// README: What to provide
const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

// README: Sign a JWT
const signAppJwt = (pem: Redacted.Redacted<string>, appId: string, nowSeconds: number) =>
	Effect.gen(function* () {
		const key = yield* JwtKey.fromPkcs8Pem(pem, { alg: "RS256" });
		return yield* Jwt.sign({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }, key);
	});

// README: Verify against an issuer's published keys
const Claims = Schema.Struct({ sub: Schema.String });
const verifyFromIssuer = (token: string) =>
	Jwt.verify(token, {
		key: JwksResolver.forIssuer("https://issuer.example"),
		claims: Claims,
		issuer: "https://issuer.example",
		audience: "my-service",
	});
// Typechecked only: the live layer needs a real HttpClient.
export const verifyProgram: Effect.Effect<{ readonly sub: string }, unknown, JwksResolver | Signature.Signature> =
	verifyFromIssuer("eyJ...");
export const resolverLayer: Layer.Layer<JwksResolver, never, import("effect/http").HttpClient.HttpClient> =
	JwksResolver.layer.pipe(Layer.provide(JwksStore.layerMemory));

// README: What to provide (the whole edge layer)
export const JwtLive: Layer.Layer<JwksResolver | Signature.Signature> = Layer.merge(
	JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory))),
	CryptoLive,
);

// README: Verify with a key you hold
export const verifyWith = (jwk: Jwk, token: string) =>
	Effect.gen(function* () {
		const key = yield* JwtKey.fromJwk(jwk);
		return yield* Jwt.verify(token, { key, claims: Schema.Struct({ sub: Schema.String }) });
	});

layer(CryptoLive, { buildPerTest: true })("README examples", (it) => {
	it.effect("signs a GitHub App JWT from a PKCS#1 key", () =>
		Effect.gen(function* () {
			const { privateKey } = generateKeyPairSync("rsa", {
				modulusLength: 2048,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			const token = yield* signAppJwt(Redacted.make(privateKey), "12345", 1_800_000_000);
			assert.strictEqual(token.split(".").length, 3);
		}),
	);

	// README: Verify with a key you hold
	it.effect("verifies with a key imported from a JWK", () =>
		Effect.gen(function* () {
			const pair = yield* JwtKey.generate("ES256", { kid: "k1" });
			const token = yield* Jwt.sign({ sub: "user-1", exp: 4_000_000_000 }, pair.signing);
			const claims = yield* verifyWith(pair.jwk, token);
			assert.strictEqual(claims.sub, "user-1");
		}),
	);

	// README: Testing
	it.effect("verifies a TestIssuer token through the real resolver", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: "https://issuer.test" });
			const token = yield* issuer.sign({ aud: "my-app", sub: "user-1" });
			const claims = yield* Jwt.verify(token, {
				key: JwksResolver.forIssuer("https://issuer.test"),
				claims: Claims,
				issuer: "https://issuer.test",
				audience: "my-app",
			}).pipe(Effect.provide(issuer.resolverLayer));
			assert.strictEqual(claims.sub, "user-1");
		}),
	);
});
