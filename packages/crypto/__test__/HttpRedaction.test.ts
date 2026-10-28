import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse, UrlParams } from "effect/http";
import { HttpRedaction } from "../src/index.js";

const TOKEN = "SECRET_bearer_token_9d1c";
const COOKIE = "SECRET_session_cookie_51ab";
const API_KEY = "SECRET_api_key_c0de";
const QUERY_TOKEN = "SECRET_query_token_77ee";
const PASSWORD = "SECRET_userinfo_pw_3b3b";
const BODY = "SECRET_body_payload_aa01";
const SET_COOKIE = "SECRET_set_cookie_f00d";
const SIGNATURE = "SECRET_signature_5150";
const SECRETS = [TOKEN, COOKIE, API_KEY, QUERY_TOKEN, PASSWORD, BODY, SET_COOKIE, SIGNATURE];

/**
 * Every string reachable from `value` through own data properties, at any
 * depth, `Headers` and `UrlParams` included — the walk a custom logger or a
 * serializer does, not a rendering.
 */
const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if (typeof value !== "object" && typeof value !== "function") return [];
	if (value === null || seen.has(value)) return [];
	seen.add(value);
	const nested =
		value instanceof Map || value instanceof Set ? [...value].flatMap((v) => reachableStrings(v, seen)) : [];
	return [
		...nested,
		...Reflect.ownKeys(value).flatMap((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
		}),
	];
};

/** Every string a log line could carry: the walk plus every rendering. */
const everyString = (value: unknown): ReadonlyArray<string> => [
	...reachableStrings(value),
	String(value),
	JSON.stringify(value) ?? "",
	inspect(value, { depth: 12, showHidden: true }),
];

const assertClean = (value: unknown): void => {
	const strings = everyString(value);
	assert.isAbove(strings.length, 3, "the walk reached the value's strings");
	for (const secret of SECRETS) for (const s of strings) assert.notInclude(s, secret);
};

const leaked = (value: unknown): ReadonlyArray<string> =>
	SECRETS.filter((secret) => reachableStrings(value).some((s) => s.includes(secret)));

const tokenRequest = HttpClientRequest.post(
	`https://ci:${PASSWORD}@registry.test/pkg?token=${QUERY_TOKEN}&page=2#frag`,
	{
		headers: {
			authorization: `Bearer ${TOKEN}`,
			cookie: `sid=${COOKIE}`,
			"x-api-key": API_KEY,
			accept: "application/json",
		},
		urlParams: { access_token: QUERY_TOKEN, limit: "10" },
		body: HttpBody.text(BODY),
	},
);

/** A client whose fetch rejects with the URL in its message, as undici does. */
const failingClient = HttpClient.make((request, url) =>
	Effect.fail(
		new HttpClientError.HttpClientError({
			reason: new HttpClientError.TransportError({
				request,
				cause: Object.assign(new TypeError(`fetch failed for ${url.href}`), {
					code: "ECONNREFUSED",
					port: 443,
					cause: new Error(`connect ECONNREFUSED; Authorization: Bearer ${TOKEN}`),
				}),
			}),
		}),
	),
);

/** A client answering 401 with a cookie and a signed final URL. */
const rejectingClient = HttpClient.make((request) =>
	Effect.succeed(
		HttpClientResponse.fromWeb(
			request,
			Object.defineProperty(
				new Response(`denied ${BODY}`, {
					status: 401,
					headers: {
						"set-cookie": `sid=${SET_COOKIE}`,
						"x-request-id": "req-1",
						"content-type": "text/plain",
						"www-authenticate": 'Bearer realm="registry"',
					},
				}),
				"url",
				{ value: `https://cdn.test/blob?X-Amz-Signature=${SIGNATURE}&part=1` },
			),
		),
	),
).pipe(HttpClient.filterStatusOk);

const failureOf = <A>(effect: Effect.Effect<A, HttpClientError.HttpClientError>) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(effect);
		if (Exit.isSuccess(exit)) return assert.fail("expected the request to fail");
		const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
		if (reason === undefined || reason._tag !== "Fail") return assert.fail("expected a typed failure");
		return reason.error;
	});

describe("HttpRedaction.error", () => {
	it.effect("positive control: the walk finds the planted credentials on core's own error", () =>
		Effect.gen(function* () {
			const raw = yield* failureOf(failingClient.execute(tokenRequest));
			// Core keeps the live request, and the walk can see it: the scrub
			// test below is not passing because the walk is blind.
			assert.includeMembers([...leaked(raw)], [TOKEN, COOKIE, API_KEY, QUERY_TOKEN, PASSWORD, BODY]);
		}),
	);

	it.effect("a transport failure keeps no credential anywhere reachable", () =>
		Effect.gen(function* () {
			const raw = yield* failureOf(failingClient.execute(tokenRequest));
			const clean = HttpRedaction.error(raw);
			assertClean(clean);
			assert.strictEqual(clean._tag, "HttpClientError");
			assert.strictEqual(clean.reason._tag, "TransportError");
			assert.strictEqual(clean.request.method, "POST");
			assert.strictEqual(clean.request.url, "https://REDACTED:REDACTED@registry.test/pkg?token=REDACTED&page=2#frag");
			assert.strictEqual(clean.request.headers.authorization, "REDACTED");
			assert.strictEqual(clean.request.headers.accept, "application/json");
			assert.deepStrictEqual(UrlParams.toRecord(clean.request.urlParams), { access_token: "REDACTED", limit: "10" });
			const cause = clean.reason.cause as Error & { code?: string; port?: number };
			assert.instanceOf(cause, TypeError, "the nested cause keeps its class");
			assert.strictEqual(cause.name, "TypeError");
			assert.strictEqual(cause.code, "ECONNREFUSED", "primitive debug fields survive");
			assert.strictEqual(cause.port, 443);
			assert.include(cause.message, "registry.test/pkg");
			assert.include(String((cause.cause as Error).message), "ECONNREFUSED");
		}),
	);

	it.effect("a status failure keeps status, response headers and a redacted final URL, minus set-cookie", () =>
		Effect.gen(function* () {
			const raw = yield* failureOf(rejectingClient.execute(tokenRequest));
			assert.include([...leaked(raw)], TOKEN, "positive control");
			const clean = HttpRedaction.error(raw);
			assertClean(clean);
			assert.strictEqual(clean.reason._tag, "StatusCodeError");
			const response = clean.response;
			if (response === undefined) return assert.fail("expected the response to survive");
			assert.strictEqual(response.status, 401);
			assert.strictEqual(response.url, "https://cdn.test/blob?X-Amz-Signature=REDACTED&part=1");
			assert.strictEqual(response.headers["x-request-id"], "req-1");
			assert.strictEqual(response.headers["www-authenticate"], 'Bearer realm="registry"');
			assert.isUndefined(response.headers["set-cookie"]);
			assert.strictEqual(response.request.headers.authorization, "REDACTED");
			assert.include(clean.message, "401");
		}),
	);
});

describe("HttpRedaction.cause", () => {
	it.effect("redacts an HttpClientError, a bare reason, a request and a response", () =>
		Effect.gen(function* () {
			const raw = yield* failureOf(rejectingClient.execute(tokenRequest));
			for (const value of [raw, raw.reason, raw.request, raw.response]) {
				assert.isNotEmpty(leaked(value), "positive control");
				assertClean(HttpRedaction.cause(value));
			}
		}),
	);

	it("leaves a tagged non-HTTP error untouched, by identity", () => {
		class Other extends Schema.TaggedError<Other>()("Other", { detail: Schema.String }) {}
		const other = Other.make({ detail: "kept" });
		assert.strictEqual(HttpRedaction.cause(other), other);
		assert.strictEqual(HttpRedaction.cause(42), 42);
		assert.strictEqual(HttpRedaction.cause(undefined), undefined);
	});

	it("leaves a plain Error and a string untouched: only HTTP values are rebuilt", () => {
		const plain = new TypeError("Invalid URL");
		assert.strictEqual(HttpRedaction.cause(plain), plain);
		assert.strictEqual(HttpRedaction.cause("text"), "text");
	});

	it("text redacts every URL and bearer token in free text", () => {
		const scrubbed = HttpRedaction.text(`GET https://u:${PASSWORD}@h.test/?token=${QUERY_TOKEN} Bearer ${TOKEN}`);
		for (const secret of [PASSWORD, QUERY_TOKEN, TOKEN]) assert.notInclude(scrubbed, secret);
		assert.include(scrubbed, "h.test");
	});
});

describe("HttpRedaction.url", () => {
	it("redacts userinfo and sensitive query values, preserving everything else", () => {
		assert.strictEqual(
			HttpRedaction.url("https://user:pw@registry.test/p?token=a&page=2&X-Amz-Credential=b&sig=c&client_secret=d"),
			"https://REDACTED:REDACTED@registry.test/p?token=REDACTED&page=2&X-Amz-Credential=REDACTED&sig=REDACTED&client_secret=REDACTED",
		);
		assert.strictEqual(HttpRedaction.url("https://registry.test/p?page=2"), "https://registry.test/p?page=2");
		assert.strictEqual(
			HttpRedaction.url("https://app.test/cb#access_token=a&state=s"),
			"https://app.test/cb#access_token=REDACTED&state=s",
		);
	});
});

describe("HttpRedaction.isSensitiveHeader", () => {
	it("flags credential headers and nothing else", () => {
		for (const name of [
			"Authorization",
			"proxy-authorization",
			"cookie",
			"set-cookie",
			"x-api-key",
			"X-Auth-Token",
			"x-github-token",
			"x-amz-security-token",
			"x-goog-api-key",
			"x-hub-signature-256",
			"private-token",
		]) {
			assert.isTrue(HttpRedaction.isSensitiveHeader(name), name);
		}
		for (const name of ["accept", "content-type", "x-request-id", "x-amz-date", "x-amz-content-sha256", "location"]) {
			assert.isFalse(HttpRedaction.isSensitiveHeader(name), name);
		}
	});
});
