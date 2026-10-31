// The README's examples, compiled and run, so the published page cannot drift from the API.
import { assert, layer } from "@effect/vitest";
import { JwksResolver, JwksStore } from "@effected/jwt";
import { TestIssuer } from "@effected/jwt/testing";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SecureRandom, Signature } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { IdTokenClaims, IdentityToken, IdentityTokenError, Oidc } from "../src/index.js";

const CryptoLive = Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto));

// README: Verify an ID token
const verifyIdToken = (token: string) =>
	Oidc.verify(token, {
		issuer: "https://accounts.example.com",
		audience: "my-client-id",
		claims: IdTokenClaims,
	});
export const verifyProgram: Effect.Effect<IdTokenClaims, unknown, JwksResolver | Signature.Signature> =
	verifyIdToken("eyJ...");

// README: Provider claims
const GoogleClaims = Schema.StructWithRest(
	Schema.Struct({
		...IdTokenClaims.schema.fields,
		email: Schema.String,
		email_verified: Schema.Boolean,
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

// README: The IdentityToken contract
const presentIdentity = Effect.gen(function* () {
	const identity = yield* IdentityToken;
	const token = yield* identity.token("https://my-service.example");
	return Redacted.value(token);
});

// README: What to provide
export const OidcLive: Layer.Layer<JwksResolver | Signature.Signature> = Layer.merge(
	JwksResolver.layer.pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, JwksStore.layerMemory))),
	Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);

// README: provider claims, verified
export const verifyGoogle = (token: string) =>
	Oidc.verify(token, { issuer: "https://accounts.google.com", audience: "my-client-id", claims: GoogleClaims });

// README: a token already held
export const program: Effect.Effect<string, IdentityTokenError> = presentIdentity.pipe(
	Effect.provide(IdentityToken.layerStatic(process.env.OIDC_TOKEN ?? "")),
);

layer(CryptoLive, { buildPerTest: true })("README examples", (it) => {
	it.effect("verifies an ID token through discovery, with provider claims", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: "https://accounts.example.com" });
			const token = yield* issuer.sign({
				aud: "my-client-id",
				sub: "user-1",
				email: "user@example.com",
				email_verified: true,
			});
			const claims = yield* Oidc.verify(token, {
				issuer: "https://accounts.example.com",
				audience: "my-client-id",
				claims: GoogleClaims,
			}).pipe(Effect.provide(issuer.resolverLayer));
			assert.strictEqual(claims.email, "user@example.com");
			assert.strictEqual(claims.sub, "user-1");
		}),
	);

	it.effect("serves IdentityToken from a token already held", () =>
		Effect.gen(function* () {
			const token = yield* presentIdentity.pipe(Effect.provide(IdentityToken.layerStatic("abc")));
			assert.strictEqual(token, "abc");
		}),
	);

	it.effect("layerTest answers, and an error carries its audience", () =>
		Effect.gen(function* () {
			assert.isAbove((yield* presentIdentity.pipe(Effect.provide(IdentityToken.layerTest()))).length, 0);
			const failing = IdentityToken.layerTest({
				token: (audience) => Effect.fail(new IdentityTokenError({ audience, cause: new Error("no runner") })),
			});
			const error = yield* Effect.flip(presentIdentity.pipe(Effect.provide(failing)));
			assert.strictEqual(error.audience, "https://my-service.example");
		}),
	);

	it.effect("decodes without verifying", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: "https://accounts.example.com" });
			const token = yield* issuer.sign({ sub: "user-1" });
			const claims = yield* Oidc.decodeUnverified(token, IdTokenClaims);
			assert.strictEqual(claims.sub, "user-1");
		}),
	);
});
