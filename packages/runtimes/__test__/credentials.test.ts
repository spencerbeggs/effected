import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { GitHubAuth, GitHubClient, NetworkError, ResponseParseError } from "../src/index.js";

const TOKEN = "ghp_SECRET_runtime_feed_token_0b5e";
const AUTH = GitHubAuth.token(Redacted.make(TOKEN));

/** A fake `fetch` driving the real client, recording each request's `authorization`. */
const withFetch = (fake: typeof globalThis.fetch) =>
	GitHubClient.layer.pipe(
		Layer.provide(
			Layer.mergeAll(AUTH, FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake)))),
		),
	);

const listing = Effect.gen(function* () {
	const client = yield* GitHubClient;
	return yield* client.listReleases("oven-sh", "bun", { perPage: 2 });
});

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

const everyString = (value: unknown): ReadonlyArray<string> => [
	...reachableStrings(value),
	String(value),
	JSON.stringify(value) ?? "",
	inspect(value, { depth: 12, showHidden: true }),
];

describe("GitHubClient keeps no token on a failure", () => {
	it.effect("a transport failure: NetworkError's cause keeps the request, minus the token", () =>
		Effect.gen(function* () {
			const sent: Array<string | null> = [];
			const fake: typeof globalThis.fetch = async (_input, init) => {
				sent.push(new Headers(init?.headers).get("authorization"));
				throw new TypeError("fetch failed");
			};
			const error = yield* Effect.flip(listing.pipe(Effect.provide(withFetch(fake))));
			assert.strictEqual(sent[0], `Bearer ${TOKEN}`, "the token was really sent");
			assert.instanceOf(error, NetworkError);
			const cause = (error as NetworkError).cause;
			if (!HttpClientError.isHttpClientError(cause)) return assert.fail("expected the HttpClientError cause");
			assert.strictEqual(cause.request.method, "GET");
			assert.include(cause.request.url, "api.github.com");
			assert.strictEqual(cause.request.headers.authorization, "REDACTED");
			const strings = everyString(error);
			assert.isAbove(strings.length, 3);
			for (const s of strings) assert.notInclude(s, TOKEN);
		}),
	);

	it.effect("a malformed body: ResponseParseError's cause keeps the request, minus the token", () =>
		Effect.gen(function* () {
			const fake: typeof globalThis.fetch = async () => new Response("{ not json", { status: 200 });
			const error = yield* Effect.flip(listing.pipe(Effect.provide(withFetch(fake))));
			assert.instanceOf(error, ResponseParseError);
			const cause = (error as ResponseParseError).cause;
			if (!HttpClientError.isHttpClientError(cause)) return assert.fail("expected the HttpClientError cause");
			assert.strictEqual(cause.request.headers.authorization, "REDACTED");
			for (const s of everyString(error)) assert.notInclude(s, TOKEN);
		}),
	);

	it("positive control: the walk finds a token on core's own error", () => {
		const raw = new HttpClientError.HttpClientError({
			reason: new HttpClientError.TransportError({
				request: HttpClientRequest.get("https://api.github.com/x").pipe(HttpClientRequest.bearerToken(TOKEN)),
			}),
		});
		assert.isTrue(
			reachableStrings(raw).some((s) => s.includes(TOKEN)),
			"core keeps the live request",
		);
	});
});
