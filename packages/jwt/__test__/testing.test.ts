import { assert, describe, it } from "@effect/vitest";
import type { Layer } from "effect";
import { Cause, Duration, Effect, Exit, Result, Schema } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { JwksResolver, Jws, Jwt } from "../src/index.js";
import { TestIssuer } from "../src/testing.js";

const ISSUER = "https://issuer.test";

const Claims = Schema.Struct({ iss: Schema.String, aud: Schema.String, iat: Schema.Number, exp: Schema.Number });

describe("TestIssuer", () => {
	it.effect("a signed token verifies through the real JwksResolver with no network", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: ISSUER });
			const token = yield* issuer.sign({ aud: "x" });
			const claims = yield* Jwt.verify(token, {
				key: JwksResolver.forIssuer(ISSUER),
				claims: Claims,
				issuer: ISSUER,
				audience: "x",
			}).pipe(Effect.provide(issuer.resolverLayer));
			assert.deepStrictEqual(claims, { iss: ISSUER, aud: "x", iat: 0, exp: 600 });
		}),
	);

	it.effect("fills iss, iat and exp from Clock unless given", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_000_500);
			const issuer = yield* TestIssuer.make({ issuer: ISSUER, kid: "named" });
			const defaults = Result.getOrThrow(Jws.decodeUnverified(yield* issuer.sign({ sub: "a" })));
			assert.deepStrictEqual(defaults.payload, { iss: ISSUER, iat: 1000, exp: 1600, sub: "a" });
			assert.strictEqual(defaults.header.kid, "named");
			assert.strictEqual(defaults.header.alg, "ES256");
			const given = Result.getOrThrow(Jws.decodeUnverified(yield* issuer.sign({ iss: "other", iat: 1, exp: 2 })));
			assert.deepStrictEqual(given.payload, { iss: "other", iat: 1, exp: 2 });
			const header = Result.getOrThrow(Jws.decodeUnverified(yield* issuer.sign({}, { typ: "at+jwt" }))).header;
			assert.strictEqual(header.typ, "at+jwt");
		}),
	);

	it.effect("signs RS256 when asked", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: ISSUER, alg: "RS256" });
			assert.strictEqual(issuer.jwks.keys[0]?.kty, "RSA");
			const token = yield* issuer.sign({ aud: "x" });
			yield* Jwt.verify(token, { key: JwksResolver.forIssuer(ISSUER), claims: Claims }).pipe(
				Effect.provide(issuer.resolverLayer),
			);
		}),
	);

	it.effect("rotate serves both kids, and one resolver picks the new kid up after the refetch interval", () =>
		Effect.gen(function* () {
			const first = yield* TestIssuer.make({ issuer: ISSUER, kid: "k1" });
			const program = Effect.gen(function* () {
				const before = yield* first.sign({ aud: "x" });
				yield* Jwt.verify(before, { key: JwksResolver.forIssuer(ISSUER), claims: Claims });
				const second = yield* TestIssuer.rotate(first, "k2");
				assert.deepStrictEqual(
					second.jwks.keys.map((key) => key.kid),
					["k1", "k2"],
				);
				assert.deepStrictEqual(
					first.jwks.keys.map((key) => key.kid),
					["k1", "k2"],
					"the original shape serves the rotated set too",
				);
				const after = yield* second.sign({ aud: "x" });
				assert.strictEqual(Result.getOrThrow(Jws.decodeUnverified(after)).header.kid, "k2");
				yield* TestClock.adjust(Duration.seconds(30));
				yield* Jwt.verify(after, { key: JwksResolver.forIssuer(ISSUER), claims: Claims });
				yield* Jwt.verify(before, { key: JwksResolver.forIssuer(ISSUER), claims: Claims });
			});
			yield* Effect.provide(program, first.resolverLayer);
		}),
	);

	it.effect("the httpClient serves discovery and the JWKS, and 404s anything else", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: ISSUER });
			const program = Effect.gen(function* () {
				const client = yield* HttpClient.HttpClient;
				const discovery = yield* Effect.flatMap(
					client.get(`${ISSUER}/.well-known/openid-configuration`),
					(r) => r.json,
				);
				assert.deepStrictEqual(discovery, { issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
				const jwks = yield* Effect.flatMap(client.get(`${ISSUER}/.well-known/jwks.json`), (r) => r.json);
				assert.deepStrictEqual(jwks as unknown, { keys: [issuer.jwks.keys[0]] });
				const missing = yield* client.get(`${ISSUER}/nope`);
				assert.strictEqual(missing.status, 404);
				const elsewhere = yield* client.get("https://other.test/.well-known/openid-configuration");
				assert.strictEqual(elsewhere.status, 404);
			});
			yield* Effect.provide(program, issuer.httpClient);
		}),
	);

	it.effect("accepts a localhost http issuer and dies on any other http issuer", () =>
		Effect.gen(function* () {
			const local = yield* TestIssuer.make({ issuer: "http://localhost:4000" });
			const token = yield* local.sign({ aud: "x" });
			yield* Jwt.verify(token, { key: JwksResolver.forIssuer("http://localhost:4000"), claims: Claims }).pipe(
				Effect.provide(local.resolverLayer),
			);
			const exit = yield* Effect.exit(TestIssuer.make({ issuer: "http://issuer.test" }));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		}),
	);

	it.effect("its resolverLayer is self-contained: nothing else to provide", () =>
		Effect.gen(function* () {
			const issuer = yield* TestIssuer.make({ issuer: ISSUER });
			const layer: Layer.Layer<JwksResolver> = issuer.resolverLayer;
			yield* Effect.provide(Effect.service(JwksResolver), layer);
		}),
	);
});
