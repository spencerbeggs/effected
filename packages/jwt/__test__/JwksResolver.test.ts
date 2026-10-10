import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
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
	/** The final URL the response reports, as after a redirect. */
	readonly finalUrl?: string;
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
				const response = new Response(body, { status: result.status ?? 200 });
				if (result.finalUrl !== undefined) Object.defineProperty(response, "url", { value: result.finalUrl });
				return HttpClientResponse.fromWeb(request, response);
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

describe("JwksResolver freshness and bounds", () => {
	const ttlLayer = (client: Layer.Layer<HttpClient.HttpClient>, store: Layer.Layer<JwksStore>) =>
		JwksResolver.layerWith({ ttl: "1 minute" }).pipe(Layer.provide(Layer.mergeAll(client, store)));

	const staleForever = (): Layer.Layer<JwksStore> => {
		let held: Option.Option<{ readonly jwks: Jwks; readonly fetchedAtMillis: number }> = Option.none();
		return Layer.succeed(JwksStore, {
			get: () => Effect.succeed(held),
			set: (_issuer, value) =>
				Effect.sync(() => {
					held = Option.some(value);
				}),
		});
	};

	for (const [name, store] of [
		["the memory store", () => JwksStore.layerMemory],
		[
			"a dying store (the resolver's own fallback)",
			() => Layer.succeed(JwksStore, { get: () => Effect.die("down"), set: () => Effect.die("down") }),
		],
		["a store that ignores the TTL", staleForever],
	] as const) {
		it.effect(`a key the issuer removes stops verifying after the TTL, with ${name}`, () =>
			Effect.gen(function* () {
				const a = yield* generate("a");
				let published: ReadonlyArray<unknown> = [a.jwk];
				const http = stub(issuerRoutes(() => published));
				const token = yield* Jws.sign({}, a.signing);
				const program = Effect.gen(function* () {
					yield* verify(token);
					yield* TestClock.adjust(Duration.seconds(59));
					yield* verify(token);
					assert.strictEqual(http.count(JWKS_URI), 1, "within the TTL the cached set serves");
					published = [];
					yield* TestClock.adjust(Duration.seconds(1));
					const reason = yield* reasonOf(verify(token));
					assert.strictEqual(reason, "unknownKid");
					assert.strictEqual(http.count(JWKS_URI), 2, "past the TTL the set is refetched");
				});
				yield* Effect.provide(program, ttlLayer(http.layer, store()));
			}),
		);
	}

	for (const [name, store] of [
		["the memory store", () => JwksStore.layerMemory],
		[
			"a dying store (the resolver's own fallback)",
			() => Layer.succeed(JwksStore, { get: () => Effect.die("down"), set: () => Effect.die("down") }),
		],
		["a store that ignores the TTL", staleForever],
	] as const) {
		it.effect(`failing refetches never extend a revoked key past the TTL, with ${name}`, () =>
			Effect.gen(function* () {
				const a = yield* generate("a");
				let status = 200;
				let published: ReadonlyArray<unknown> = [a.jwk];
				const http = stub((url) =>
					url === DISCOVERY ? discovery : url === JWKS_URI ? { status, body: { keys: published } } : { status: 404 },
				);
				const token = yield* Jws.sign({}, a.signing);
				const program = Effect.gen(function* () {
					yield* verify(token); // fetchedAt = 0, ttl = 60s
					status = 500;
					published = [];
					// Before the TTL the cached set still serves; refetches are not needed.
					yield* TestClock.adjust(Duration.seconds(45));
					yield* verify(token);
					// Step past the TTL in increments, across several failed refetch windows.
					yield* TestClock.adjust(Duration.seconds(15));
					const outcomes: Array<string> = [];
					for (let step = 0; step < 16; step++) {
						const exit = yield* Effect.exit(verify(token));
						outcomes.push(Exit.isSuccess(exit) ? "success" : (Cause.squash(exit.cause) as JwtError).reason);
						yield* TestClock.adjust(Duration.seconds(25));
					}
					assert.notInclude(outcomes, "success", outcomes.join(","));
					for (const reason of outcomes) assert.include(["unknownKid", "jwksFetch"], reason);
					assert.isAbove(http.count(JWKS_URI), 2, "refetches were attempted, and failed");
				});
				yield* Effect.provide(program, ttlLayer(http.layer, store()));
			}),
		);
	}

	it.effect("a lagging store does not shadow the resolver's newer fetch after a rotation", () =>
		Effect.gen(function* () {
			const [k1, k2] = [yield* generate("k1"), yield* generate("k2")];
			const http = stub(issuerRoutes(() => [k1.jwk, k2.jwk]));
			// An eventually consistent store (KV read through an edge cache): every
			// write is lost, and every read returns the pre-rotation set, fetched
			// 40 seconds ago and still inside the TTL.
			const preRotation = Schema.decodeUnknownSync(Jwks)({ keys: [k1.jwk] });
			const lagging = Layer.succeed(JwksStore, {
				get: () => Effect.succeed(Option.some({ jwks: preRotation, fetchedAtMillis: 60_000 })),
				set: () => Effect.void,
			});
			const token = yield* Jws.sign({}, k2.signing);
			const program = Effect.gen(function* () {
				yield* TestClock.adjust(Duration.seconds(100));
				yield* verify(token);
				assert.strictEqual(http.count(JWKS_URI), 1, "the unknown kid refetched once");
				yield* verify(token);
				yield* verify(yield* Jws.sign({}, k1.signing));
				assert.strictEqual(http.count(JWKS_URI), 1, "the resolver's own fetch serves the second verification");
			});
			yield* Effect.provide(program, resolverLayer(http.layer, lagging));
		}),
	);

	it.effect("a newer store set without the kid is not overridden by the resolver's older fetch", () =>
		Effect.gen(function* () {
			const [k1, k2] = [yield* generate("k1"), yield* generate("k2")];
			const http = stub(issuerRoutes(() => [k1.jwk]));
			// Another isolate fetches after this one and writes a set that dropped k1.
			let held: Option.Option<{ readonly jwks: Jwks; readonly fetchedAtMillis: number }> = Option.none();
			const shared = Layer.succeed(JwksStore, { get: () => Effect.sync(() => held), set: () => Effect.void });
			const token = yield* Jws.sign({}, k1.signing);
			const program = Effect.gen(function* () {
				yield* verify(token);
				assert.strictEqual(http.count(JWKS_URI), 1);
				yield* TestClock.adjust(Duration.seconds(10));
				held = Option.some({ jwks: Schema.decodeUnknownSync(Jwks)({ keys: [k2.jwk] }), fetchedAtMillis: 10_000 });
				yield* TestClock.adjust(Duration.seconds(10));
				assert.strictEqual(yield* reasonOf(verify(token)), "unknownKid");
				assert.strictEqual(http.count(JWKS_URI), 1, "inside the refetch interval, no fetch");
			});
			yield* Effect.provide(program, resolverLayer(http.layer, shared));
		}),
	);

	it.effect("a store that retains nothing does not serialize known-key verifications behind a refetch", () =>
		Effect.gen(function* () {
			const [a, c] = [yield* generate("a"), yield* generate("c")];
			let gate: Deferred.Deferred<void> | undefined;
			const http = stub((url) => {
				const base = issuerRoutes(() => [a.jwk])(url);
				return url === JWKS_URI && gate !== undefined ? { ...base, gate } : base;
			});
			const forgetful = Layer.succeed(JwksStore, { get: () => Effect.succeed(Option.none()), set: () => Effect.void });
			const token = yield* Jws.sign({}, a.signing);
			const program = Effect.gen(function* () {
				yield* verify(token);
				yield* TestClock.adjust(Duration.seconds(31));
				gate = yield* Deferred.make<void>();
				// An unknown kid holds the issuer's lock across a refetch that does not answer.
				const miss = yield* Effect.forkChild(Effect.flip(verify(yield* Jws.sign({}, c.signing))));
				for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
				// The known kid must verify while the refetch is still parked on the
				// gate. Joining before the gate opens makes that the assertion: were the
				// verification serialized behind the lock, this join would never return
				// and the test would time out. Polling after a fixed number of yields was
				// flaky, because verification awaits a real WebCrypto promise.
				yield* verify(token);
				assert.isUndefined(miss.pollUnsafe(), "the refetch was still in flight");
				yield* Deferred.succeed(gate, undefined);
				assert.strictEqual((yield* Fiber.join(miss)).reason, "unknownKid");
			});
			yield* Effect.provide(program, resolverLayer(http.layer, forgetful));
		}),
	);

	it.effect("an attacker-chosen kid is capped before it reaches JwtError.kid", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const long = yield* generate("x".repeat(10_000));
			const http = stub(issuerRoutes(() => [a.jwk]));
			const error = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, long.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(error.reason, "unknownKid");
			assert.strictEqual(error.kid, `${"x".repeat(128)}…`);
			assert.isBelow(error.detail.length, 300);
			// a GitHub-shaped 36-character kid appears whole in both
			const uuid = yield* generate("cc413527-173f-5a05-976e-9c52b1d7b431");
			const uuidError = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, uuid.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(uuidError.kid, "cc413527-173f-5a05-976e-9c52b1d7b431");
			assert.include(uuidError.detail, '"cc413527-173f-5a05-976e-9c52b1d7b431"');
			// control: a kid inside the bound is carried whole
			const short = yield* generate("k".repeat(128));
			const shortError = yield* Effect.flip(
				Effect.provide(verify(yield* Jws.sign({}, short.signing)), resolverLayer(http.layer)),
			);
			assert.strictEqual(shortError.kid, "k".repeat(128));
		}),
	);

	it.effect("a fetch that never answers is jwksFetch after the fetch timeout", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const never = yield* Deferred.make<void>();
			const http = stub(issuerRoutes(() => [a.jwk], { gate: never }));
			const token = yield* Jws.sign({}, a.signing);
			const program = Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(Effect.flip(verify(token)));
				for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
				yield* TestClock.adjust(Duration.seconds(10));
				const error = yield* Fiber.join(fiber);
				assert.strictEqual(error.reason, "jwksFetch");
				assert.include(error.detail, "within 10000 ms");
			});
			yield* Effect.provide(program, resolverLayer(http.layer));
		}),
	);

	it.effect("a discovery document or JWKS redirected off https is jwksFetch", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const token = yield* Jws.sign({}, a.signing);
			const jwksDowngrade = stub(issuerRoutes(() => [a.jwk], { finalUrl: "http://issuer.example/keys" }));
			const error = yield* Effect.flip(Effect.provide(verify(token), resolverLayer(jwksDowngrade.layer)));
			assert.strictEqual(error.reason, "jwksFetch");
			assert.include(error.detail, "redirected off https");
			const discoveryDowngrade = stub((url) =>
				url === DISCOVERY
					? { ...discovery, finalUrl: "http://issuer.example/.well-known/openid-configuration" }
					: { body: { keys: [a.jwk] } },
			);
			assert.strictEqual(
				yield* reasonOf(Effect.provide(verify(token), resolverLayer(discoveryDowngrade.layer))),
				"jwksFetch",
			);
			assert.strictEqual(discoveryDowngrade.count(JWKS_URI), 0);
			// control: a redirect that stays on https is fine
			const sideways = stub(issuerRoutes(() => [a.jwk], { finalUrl: "https://cdn.issuer.example/keys" }));
			yield* Effect.provide(verify(token), resolverLayer(sideways.layer));
		}),
	);

	it.effect("an http issuer other than localhost is jwksFetch, and discovery is never requested", () =>
		Effect.gen(function* () {
			const a = yield* generate("a");
			const token = yield* Jws.sign({}, a.signing);
			const http = stub(() => ({ body: { issuer: "http://idp.example", jwks_uri: "https://idp.example/keys" } }));
			const error = yield* Effect.flip(
				Effect.provide(Jws.verify(token, JwksResolver.forIssuer("http://idp.example")), resolverLayer(http.layer)),
			);
			assert.strictEqual(error.reason, "jwksFetch");
			assert.strictEqual(http.count("http://idp.example/.well-known/openid-configuration"), 0);
		}),
	);

	it.effect("a non-positive or non-finite ttl, minRefetchInterval or fetchTimeout dies building the layer", () =>
		Effect.gen(function* () {
			const http = stub(() => ({ status: 404 }));
			for (const name of ["ttl", "minRefetchInterval", "fetchTimeout"] as const) {
				for (const value of [0, -1, Number.NaN, Duration.infinity, Duration.seconds(-5)]) {
					const layer = JwksResolver.layerWith({ [name]: value }).pipe(
						Layer.provide(Layer.mergeAll(http.layer, JwksStore.layerMemory)),
					);
					const exit = yield* Effect.exit(Effect.provide(Effect.service(JwksResolver), layer));
					assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause), `${name}=${String(value)}`);
					if (Exit.isFailure(exit)) assert.include(String(Cause.squash(exit.cause)), name);
				}
			}
			const ok = JwksResolver.layerWith({ ttl: "5 minutes", minRefetchInterval: 1, fetchTimeout: "2 seconds" }).pipe(
				Layer.provide(Layer.mergeAll(http.layer, JwksStore.layerMemory)),
			);
			yield* Effect.provide(Effect.service(JwksResolver), ok);
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
