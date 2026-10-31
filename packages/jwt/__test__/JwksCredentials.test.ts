import { inspect } from "node:util";
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { JwksResolver } from "../src/JwksResolver.js";
import { JwksStore } from "../src/JwksStore.js";
import { Jws } from "../src/Jws.js";
import { JwtKey } from "../src/JwtKey.js";
import { CryptoLive } from "./crypto.js";

const ISSUER = "https://issuer.example";
const TOKEN = "SECRET_jwks_gateway_token_6d2a";

type Answer = "transport" | "brokenBody";

/**
 * A consumer's client that authenticates every request to a gated JWKS
 * endpoint, over a transport that fails as `answer` says.
 */
const authenticatedClient = (answer: Answer) =>
	HttpClient.make((request, url) =>
		answer === "transport"
			? Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, cause: new TypeError(`fetch failed: ${url.href}`) }),
					}),
				)
			: Effect.succeed(
					HttpClientResponse.fromWeb(
						request,
						new Response(new ReadableStream({ start: (controller) => controller.error(new Error("reset")) }), {
							status: 200,
						}),
					),
				),
	).pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(TOKEN)));

const resolverOver = (client: HttpClient.HttpClient) =>
	JwksResolver.layer.pipe(
		Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, client), JwksStore.layerMemory)),
	);

/** Every string reachable from `value` through own data properties, `Headers` included. */
const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return [];
	seen.add(value);
	return Reflect.ownKeys(value).flatMap((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
	});
};

layer(CryptoLive, { buildPerTest: true })("JwksResolver keeps no credential on a fetch failure", (it) => {
	it.effect("positive control: the walk finds the token on core's own error", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(authenticatedClient("transport").get(`${ISSUER}/keys`));
			assert.isTrue(
				reachableStrings(error).some((s) => s.includes(TOKEN)),
				"core keeps the live request",
			);
		}),
	);

	for (const answer of ["transport", "brokenBody"] as const) {
		it.effect(`a ${answer} failure: the JwtError's cause keeps the request, minus the token`, () =>
			Effect.gen(function* () {
				const key = yield* JwtKey.generate("ES256", { kid: "a" });
				const token = yield* Jws.sign({ sub: "x" }, key.signing);
				const error = yield* Effect.flip(
					Jws.verify(token, JwksResolver.forIssuer(ISSUER)).pipe(
						Effect.provide(resolverOver(authenticatedClient(answer))),
					),
				);
				assert.strictEqual(error.reason, "jwksFetch");
				const cause = error.cause;
				if (!HttpClientError.isHttpClientError(cause)) return assert.fail("expected the HttpClientError cause");
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				assert.include(cause.request.url, "issuer.example");
				const strings = [
					...reachableStrings(error),
					String(error),
					JSON.stringify(error) ?? "",
					inspect(error, { depth: 12, showHidden: true }),
				];
				assert.isAbove(strings.length, 3);
				for (const s of strings) assert.notInclude(s, TOKEN);
			}),
		);
	}
});
