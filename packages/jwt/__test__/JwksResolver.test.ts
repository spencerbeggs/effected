import { assert, describe, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { Jwks } from "../src/Jwk.js";
import { JwksResolver } from "../src/JwksResolver.js";
import { JwksStore } from "../src/JwksStore.js";
import { Jws } from "../src/Jws.js";
import type { JwtError } from "../src/JwtError.js";
import { JwtKey } from "../src/JwtKey.js";

const ISSUER = "https://issuer.example";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_URI = `${ISSUER}/keys`;

interface Route {
	readonly status?: number;
	readonly body?: unknown;
	readonly raw?: string;
	/** Hold the response until this latch opens. */
	readonly gate?: Deferred.Deferred<void>;
}

/** A scripted `HttpClient` counting requests per URL. */
const stub = (route: (url: string) => Route) => {
	const counts = new Map<string, number>();
	const layer = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.gen(function* () {
				const key = url.toString();
				counts.set(key, (counts.get(key) ?? 0) + 1);
				const result = route(key);
				if (result.gate !== undefined) yield* Deferred.await(result.gate);
				const body = result.raw ?? JSON.stringify(result.body ?? {});
				return HttpClientResponse.fromWeb(request, new Response(body, { status: result.status ?? 200 }));
			}),
		),
	);
	return { layer, count: (url: string) => counts.get(url) ?? 0 };
};

const discovery = { status: 200, body: { issuer: ISSUER, jwks_uri: JWKS_URI } };

const issuerRoutes =
	(keys: () => ReadonlyArray<unknown>, jwks: Partial<Route> = {}) =>
	(url: string): Route => {
		if (url === DISCOVERY) return discovery;
		if (url === JWKS_URI) return { body: { keys: keys() }, ...jwks };
		return { status: 404 };
	};

const resolverLayer = (client: Layer.Layer<HttpClient.HttpClient>, store = JwksStore.layerMemory) =>
	JwksResolver.layer.pipe(Layer.provide(Layer.mergeAll(client, store)));

const verify = (token: string) => Jws.verify(token, JwksResolver.forIssuer(ISSUER));

const reasonOf = <A, R>(effect: Effect.Effect<A, JwtError, R>) =>
	Effect.map(Effect.flip(effect), (error) => error.reason);

const generate = (kid: string) => JwtKey.generate("ES256", { kid });

describe("JwksResolver", () => {
	it.effect("discovers and fetches the JWKS once for two verifications", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [a.jwk]));
			const token = yield* Jws.sign({ sub: "x" }, a.signing);
			yield* Effect.provide(Effect.all([verify(token), verify(token)]), resolverLayer(http.layer));
			assert.strictEqual(http.count(DISCOVERY), 1);
			assert.strictEqual(http.count(JWKS_URI), 1);
		}),
	);

	it.effect("Review Focus 2: a rotated kid refetches once; a second unknown kid within 30s does not", () =>
		Effect.gen(function* () {
			const [a, b, c] = [yield* generate("a"), yield* generate("b"), yield* generate("c")];
			let published = [a.jwk];
			const http = stub(issuerRoutes(() => published));
			const program = Effect.gen(function* () {
				yield* verify(yield* Jws.sign({}, a.signing));
				assert.strictEqual(http.count(JWKS_URI), 1);

				yield* TestClock.adjust(Duration.seconds(31));
				published = [a.jwk, b.jwk];
				yield* verify(yield* Jws.sign({}, b.signing));
				assert.strictEqual(http.count(JWKS_URI), 2);

				const unknown = yield* Effect.flip(verify(yield* Jws.sign({}, c.signing)));
				assert.strictEqual(unknown.reason, "unknownKid");
				assert.strictEqual(unknown.kid, "c");
				assert.strictEqual(http.count(JWKS_URI), 2, "no fetch inside the refetch interval");

				yield* TestClock.adjust(Duration.seconds(30));
				published = [a.jwk, b.jwk, c.jwk];
				yield* verify(yield* Jws.sign({}, c.signing));
				assert.strictEqual(http.count(JWKS_URI), 3);
			});
			yield* Effect.provide(program, resolverLayer(http.layer));
		}),
	);

	it.effect("two concurrent misses on a new kid share one fetch, and both succeed", () =>
		Effect.gen(function* () {
			const [a, b] = [yield* generate("a"), yield* generate("b")];
			let published = [a.jwk];
			let gate: Deferred.Deferred<void> | undefined;
			const gated = stub((url) => {
				const base = issuerRoutes(() => published)(url);
				return url === JWKS_URI && gate !== undefined ? { ...base, gate } : base;
			});
			const program = Effect.gen(function* () {
				yield* verify(yield* Jws.sign({}, a.signing));
				yield* TestClock.adjust(Duration.seconds(31));
				published = [a.jwk, b.jwk];
				gate = yield* Deferred.make<void>();
				const token = yield* Jws.sign({}, b.signing);
				const first = yield* Effect.forkChild(verify(token));
				const second = yield* Effect.forkChild(verify(token));
				for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
				yield* Deferred.succeed(gate, undefined);
				yield* Fiber.join(first);
				yield* Fiber.join(second);
				assert.strictEqual(gated.count(JWKS_URI), 2, "one initial fetch plus one shared refetch");
			});
			yield* Effect.provide(program, resolverLayer(gated.layer));
		}),
	);

	it.effect("a 500 from the JWKS is jwksFetch", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [a.jwk], { status: 500 }));
			const reason = yield* reasonOf(Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)));
			assert.strictEqual(reason, "jwksFetch");
		}),
	);

	it.effect("a JWKS whose every key is unsupported is jwksFetch, not unknownKid", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(
				issuerRoutes(() => [
					{ kty: "oct", kid: "a", k: "c2VjcmV0" },
					{ kty: "OKP", kid: "a", crv: "Ed25519", x: "AA" },
				]),
			);
			const error = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(error.reason, "jwksFetch");
			assert.include(error.detail, "no supported keys");
		}),
	);

	it.effect("a key whose alg differs from the header's is not a match", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [{ ...a.jwk, alg: "RS256" }]));
			const reason = yield* reasonOf(Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)));
			assert.strictEqual(reason, "unknownKid");
		}),
	);

	it.effect("a matching kid that does not import is key, not unknownKid", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [{ ...a.jwk, use: "enc" }]));
			const reason = yield* reasonOf(Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)));
			assert.strictEqual(reason, "key");
		}),
	);

	it.effect("a header without kid matches only a single-key JWKS", () =>
		Effect.gen(function* () {
			const [a, b] = [yield* generate("a"), yield* generate("b")];
			const bare = yield* JwtKey.generate("ES256");
			const single = stub(issuerRoutes(() => [{ ...bare.jwk }]));
			yield* Effect.provide(verify(yield* Jws.sign({}, bare.signing)), resolverLayer(single.layer));
			const two = stub(issuerRoutes(() => [a.jwk, b.jwk]));
			const reason = yield* reasonOf(
				Effect.provide(verify(yield* Jws.sign({}, bare.signing)), resolverLayer(two.layer)),
			);
			assert.strictEqual(reason, "unknownKid");
		}),
	);

	it.effect("refuses a discovery document naming another issuer", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub((url) =>
				url === DISCOVERY
					? { body: { issuer: "https://evil.example", jwks_uri: JWKS_URI } }
					: { body: { keys: [a.jwk] } },
			);
			const error = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(error.reason, "jwksFetch");
			assert.strictEqual(http.count(JWKS_URI), 0);
		}),
	);

	it.effect("refuses a discovered http: jwks_uri, except for a localhost issuer", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const token = yield* Jws.sign({}, a.signing);
			const plain = stub((url) =>
				url === DISCOVERY
					? { body: { issuer: ISSUER, jwks_uri: "http://issuer.example/keys" } }
					: { body: { keys: [a.jwk] } },
			);
			assert.strictEqual(yield* reasonOf(Effect.provide(verify(token), resolverLayer(plain.layer))), "jwksFetch");
			assert.strictEqual(plain.count("http://issuer.example/keys"), 0);

			for (const local of ["http://localhost:8080", "http://127.0.0.1:9000"]) {
				const localHttp = stub((url) =>
					url === `${local}/.well-known/openid-configuration`
						? { body: { issuer: local, jwks_uri: `${local}/keys` } }
						: { body: { keys: [a.jwk] } },
				);
				yield* Effect.provide(Jws.verify(token, JwksResolver.forIssuer(local)), resolverLayer(localHttp.layer));
				assert.strictEqual(localHttp.count(`${local}/keys`), 1);
			}
		}),
	);

	it.effect("caps the response body", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const padding = "x".repeat(2 * 1024 * 1024);
			const http = stub(issuerRoutes(() => [a.jwk], { raw: JSON.stringify({ keys: [a.jwk], padding }) }));
			const error = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, a.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(error.reason, "jwksFetch");
			assert.include(error.detail, "larger than");
		}),
	);

	it.effect("a store whose methods die never fails a verification", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [a.jwk]));
			const dying = Layer.succeed(JwksStore, {
				get: () => Effect.die(new Error("store down")),
				set: () => Effect.die(new Error("store down")),
			});
			const token = yield* Jws.sign({}, a.signing);
			yield* Effect.provide(Effect.all([verify(token), verify(token)]), resolverLayer(http.layer, dying));
			assert.strictEqual(http.count(JWKS_URI), 1, "the last fetch is reused inside the refetch interval");
		}),
	);

	it.effect("a jwksUri option skips discovery", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const http = stub(issuerRoutes(() => [a.jwk]));
			const layer = JwksResolver.layerWith({ jwksUri: () => JWKS_URI }).pipe(
				Layer.provide(Layer.mergeAll(http.layer, JwksStore.layerMemory)),
			);
			yield* Effect.provide(verify(yield* Jws.sign({}, a.signing)), layer);
			assert.strictEqual(http.count(DISCOVERY), 0);
			assert.strictEqual(http.count(JWKS_URI), 1);
		}),
	);
});

describe("JwksStore.layerMemory", () => {
	it.effect("expires an entry after its TTL", () =>
		Effect.gen(function* () {
			const store = yield* JwksStore;
			const jwks = Schema.decodeUnknownSync(Jwks)({ keys: [] });
			yield* store.set(ISSUER, { jwks, fetchedAtMillis: 0 }, Duration.seconds(10));
			assert.isTrue(Option.isSome(yield* store.get(ISSUER)));
			yield* TestClock.adjust(Duration.seconds(9));
			assert.isTrue(Option.isSome(yield* store.get(ISSUER)));
			yield* TestClock.adjust(Duration.seconds(1));
			assert.isTrue(Option.isNone(yield* store.get(ISSUER)));
			assert.isTrue(Option.isNone(yield* store.get("https://other.example")));
		}).pipe(Effect.provide(JwksStore.layerMemory)),
	);
});
