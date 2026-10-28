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

describe("HttpRedaction.text — URLs", () => {
	// The pattern `text` used to scan with: kept here as the differential
	// oracle. It is quadratic on a long scheme-shaped run with no `://`.
	const ORACLE = /[a-z][a-z\d+.-]*:\/\/[^\s"'<>`]+/gi;
	const oracle = (raw: string): string => raw.replace(ORACLE, (match) => HttpRedaction.url(match));

	it("finds the same URLs as the regex it replaced, on a generated corpus", () => {
		// No letters from `bearer` / `basic` / `token`, so only the URL pass can
		// change a string. `ſ` and the Kelvin sign are non-ASCII case-fold traps.
		const alphabet = [
			"a",
			"Z",
			"1",
			"+",
			".",
			"-",
			":",
			"/",
			"//",
			"://",
			" ",
			'"',
			"@",
			"?",
			"=",
			"u:p@",
			"?code=v",
			String.fromCodePoint(0x17f),
			String.fromCodePoint(0x212a),
			"\t",
		];
		let state = 0x2545f491;
		const next = (): number => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return (state >>> 0) / 0x100000000;
		};
		let matched = 0;
		let redacted = 0;
		for (let index = 0; index < 20_000; index++) {
			let raw = "";
			const length = 1 + Math.floor(next() * 24);
			for (let k = 0; k < length; k++) raw += alphabet[Math.floor(next() * alphabet.length)];
			const expected = oracle(raw);
			if (raw.search(ORACLE) !== -1) matched++;
			if (expected !== raw) redacted++;
			assert.strictEqual(HttpRedaction.text(raw), expected, JSON.stringify(raw));
		}
		// Both counts gate the corpus: a corpus of identity redactions would not
		// see a scan that finds the wrong span.
		assert.isAbove(matched, 1000, "the corpus held URLs");
		assert.isAbove(redacted, 400, "the corpus held URLs a redaction changes");
	});

	it("redacts a URL whose run starts with a digit, `.`, `+` or `-`", () => {
		for (const lead of ["1", ".", "+", "-", "..."]) {
			const scrubbed = HttpRedaction.text(`see ${lead}https://u:${PASSWORD}@h.test/x`);
			assert.strictEqual(scrubbed, `see ${lead}https://REDACTED:REDACTED@h.test/x`);
		}
	});

	it("scans a 1 MB adversarial input in linear time", () => {
		const inputs = [
			"a".repeat(1 << 20),
			"a1+.-".repeat(1 << 18),
			`${"a".repeat(1 << 20)}:/`,
			"a:".repeat(1 << 19),
			"a://".repeat(1 << 18),
			"1://".repeat(1 << 18),
			"a:// ".repeat(1 << 18),
		];
		for (const input of inputs) {
			const start = performance.now();
			HttpRedaction.text(input);
			const elapsed = performance.now() - start;
			assert.isBelow(elapsed, 500, `${JSON.stringify(input.slice(0, 8))}… took ${elapsed.toFixed(0)} ms`);
		}
	});
});

describe("HttpRedaction.text — credentials", () => {
	const TOKENS = [
		"npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
		"ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
		["gi", "thub_pat_11AbCdEfG0123456789_abcdefghijklmnopqrstuvwxyz"].join(""),
		"ghs_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
		"eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
	];

	it("replaces a Bearer, Basic or token credential whatever the scheme's case", () => {
		for (const scheme of ["Bearer", "bearer", "BEARER", "token", "Token", "Basic", "basic"]) {
			for (const credential of TOKENS) {
				const scrubbed = HttpRedaction.text(`401: ${scheme} ${credential} rejected`);
				assert.strictEqual(scrubbed, `401: ${scheme} REDACTED rejected`, `${scheme} ${credential}`);
			}
		}
		assert.strictEqual(HttpRedaction.text("Authorization: basic dXNlcjpwYXNz"), "Authorization: basic REDACTED");
	});

	it("leaves prose that only mentions a scheme intact", () => {
		for (const prose of [
			"invalid token provided by the server",
			"the token expired; request a fresh token",
			"Bearer authentication failed for registry",
			"basic configuration is required, token missing",
			"token rejected. Tokens: provided, revoked",
		]) {
			assert.strictEqual(HttpRedaction.text(prose), prose);
		}
	});

	it("scans a 1 MB adversarial input in linear time", () => {
		for (const input of [`token${" ".repeat(1 << 20)}`, "token ".repeat(1 << 18), `Bearer ${"a".repeat(1 << 20)}`]) {
			const start = performance.now();
			HttpRedaction.text(input);
			assert.isBelow(performance.now() - start, 500);
		}
	});
});
