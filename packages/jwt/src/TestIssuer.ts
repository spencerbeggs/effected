// Root types are named through the package's own name, so the emitted testing.d.ts imports them from "@effected/jwt"
// instead of carrying copies. Runtime values are imported relatively; the build emits one module per source file, so the
// classes here are the same runtime instances the root exports.
import type * as Root from "@effected/jwt";
import { Clock, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { isAcceptedIssuer } from "./internal/issuer.js";
import { JwksResolver } from "./JwksResolver.js";
import { JwksStore } from "./JwksStore.js";
import { Jwt } from "./Jwt.js";
import { JwtKey } from "./JwtKey.js";

/**
 * A test issuer: a generated key pair, its JWKS and discovery document
 * served by an in-memory `HttpClient`, and a signer.
 *
 * @public
 */
export interface TestIssuerShape {
	/** The issuer URL, as `iss` and as the discovery document's `issuer`. */
	readonly issuer: string;
	/** The key set currently served: every key this issuer and its rotations have made. */
	readonly jwks: Root.Jwks;
	/**
	 * Sign `claims` with this issuer's current key.
	 *
	 * @remarks
	 * Fills `iss` (the issuer), `iat` (now on `Clock`, in whole seconds) and
	 * `exp` (`iat` plus 10 minutes) unless `claims` gives them.
	 */
	readonly sign: (
		claims: Readonly<Record<string, unknown>>,
		header?: Readonly<Record<string, unknown>>,
	) => Effect.Effect<string, Root.JwtError>;
	/**
	 * An `HttpClient` serving this issuer's discovery document
	 * (`<issuer>/.well-known/openid-configuration`) and JWKS
	 * (`<issuer>/.well-known/jwks.json`), and 404 for anything else.
	 */
	readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
	/**
	 * The real `JwksResolver` with default options, over
	 * {@link TestIssuerShape.httpClient} and a fresh in-memory
	 * `JwksStore`: one provide for a consumer test.
	 *
	 * @remarks
	 * Each `Effect.provide` of this layer builds a new resolver and store, so
	 * provide it once around the whole test when the test relies on caching or
	 * on a rotation being picked up. The resolver's rules apply unchanged:
	 * a new `kid` is refetched at most once per 30 seconds.
	 */
	readonly resolverLayer: Layer.Layer<Root.JwksResolver>;
}

interface IssuerState {
	readonly issuer: string;
	readonly alg: Root.JwtAlgorithm;
	readonly keys: Array<Root.Jwk>;
	readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
	readonly resolverLayer: Layer.Layer<Root.JwksResolver>;
}

const states = new WeakMap<TestIssuerShape, IssuerState>();

const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], status: number, body: unknown) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
	);

const serve = (issuer: string, keys: ReadonlyArray<Root.Jwk>): Layer.Layer<HttpClient.HttpClient> => {
	const base = issuer.replace(/\/$/, "");
	const discoveryUrl = `${base}/.well-known/openid-configuration`;
	const jwksUri = `${base}/.well-known/jwks.json`;
	return Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				const target = url.toString();
				if (target === discoveryUrl) return json(request, 200, { issuer, jwks_uri: jwksUri });
				if (target === jwksUri) return json(request, 200, { keys });
				return json(request, 404, { error: "not found" });
			}),
		),
	);
};

const shapeFor = (state: IssuerState, signing: Root.SigningKey): TestIssuerShape => {
	const shape: TestIssuerShape = {
		issuer: state.issuer,
		get jwks() {
			return { keys: [...state.keys] };
		},
		sign: (claims, header) =>
			Effect.gen(function* () {
				const iat = Math.floor((yield* Clock.currentTimeMillis) / 1000);
				return yield* Jwt.sign({ iss: state.issuer, iat, exp: iat + 600, ...claims }, signing, header);
			}),
		httpClient: state.httpClient,
		resolverLayer: state.resolverLayer,
	};
	states.set(shape, state);
	return shape;
};

const make = (options: {
	readonly issuer: string;
	readonly alg?: Root.JwtAlgorithm;
	readonly kid?: string;
}): Effect.Effect<TestIssuerShape, Root.JwtError> =>
	Effect.gen(function* () {
		if (!isAcceptedIssuer(options.issuer)) {
			return yield* Effect.die(
				new Error(
					`TestIssuer: ${options.issuer} is not an https issuer (or http://localhost / http://127.0.0.1), which JwksResolver refuses`,
				),
			);
		}
		const alg = options.alg ?? "ES256";
		const pair = yield* JwtKey.generate(alg, { kid: options.kid ?? "test-key" });
		const keys: Array<Root.Jwk> = [pair.jwk];
		const httpClient = serve(options.issuer, keys);
		const resolverLayer = JwksResolver.layer.pipe(Layer.provide(Layer.merge(httpClient, JwksStore.layerMemory)));
		return shapeFor({ issuer: options.issuer, alg, keys, httpClient, resolverLayer }, pair.signing);
	});

const rotate = (issuer: TestIssuerShape, kid: string): Effect.Effect<TestIssuerShape, Root.JwtError> =>
	Effect.gen(function* () {
		const state = states.get(issuer);
		if (state === undefined) {
			return yield* Effect.die(new Error("TestIssuer.rotate: the issuer was not made by TestIssuer.make"));
		}
		const pair = yield* JwtKey.generate(state.alg, { kid });
		state.keys.push(pair.jwk);
		return shapeFor(state, pair.signing);
	});

/**
 * A network-free OIDC issuer for consumer tests: sign tokens with
 * {@link TestIssuerShape.sign}, and verify them through the real
 * `JwksResolver` by providing {@link TestIssuerShape.resolverLayer}.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { JwksResolver, Jwt } from "@effected/jwt";
 * import { TestIssuer } from "@effected/jwt/testing";
 *
 * const program = Effect.gen(function* () {
 * 	const issuer = yield* TestIssuer.make({ issuer: "https://issuer.test" });
 * 	const token = yield* issuer.sign({ aud: "my-app", sub: "user-1" });
 * 	return yield* Jwt.verify(token, {
 * 		key: JwksResolver.forIssuer("https://issuer.test"),
 * 		claims: Schema.Struct({ sub: Schema.String }),
 * 		issuer: "https://issuer.test",
 * 		audience: "my-app",
 * 	}).pipe(Effect.provide(issuer.resolverLayer));
 * });
 * // => { sub: "user-1" }
 * ```
 *
 * @public
 */
export const TestIssuer: {
	/**
	 * Make an issuer with a fresh key pair (`ES256` by default, `kid`
	 * `"test-key"` by default).
	 *
	 * @remarks
	 * The issuer must be `https:`, or `http://localhost` /
	 * `http://127.0.0.1`, because `JwksResolver` refuses any other
	 * issuer; anything else is a defect.
	 */
	readonly make: (options: {
		readonly issuer: string;
		readonly alg?: Root.JwtAlgorithm;
		readonly kid?: string;
	}) => Effect.Effect<TestIssuerShape, Root.JwtError>;
	/**
	 * Rotate: a second key under `kid`, served alongside every earlier one.
	 *
	 * @remarks
	 * The returned issuer signs with the new key; the original keeps signing
	 * with its own, and both serve the same, grown key set through the same
	 * `httpClient` and `resolverLayer`. A resolver that already fetched the
	 * set picks the new `kid` up only after its refetch interval, so a test
	 * under `TestClock` must `TestClock.adjust("30 seconds")` after rotating
	 * before verifying a token signed with the new key.
	 */
	readonly rotate: (issuer: TestIssuerShape, kid: string) => Effect.Effect<TestIssuerShape, Root.JwtError>;
} = { make, rotate };
