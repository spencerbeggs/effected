import { inspect } from "node:util";
import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Duration, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import type { DataBlobTransfer } from "../src/index.js";
import {
	ActionEnvironment,
	ActionOutputs,
	BlobStore,
	GitHubCacheBlobStore,
	OidcTokenIssuer,
	ToolInstaller,
} from "../src/index.js";
import { RESULTS_ENV, resultsEnv, settle } from "./results.js";

/**
 * Every string reachable from `value` through own data properties, core
 * `Headers` included — the walk a custom logger or serializer does, which
 * core's render-time redaction does not cover.
 */
const reachableStrings = (value: unknown, seen = new Set<unknown>()): ReadonlyArray<string> => {
	if (typeof value === "string") return [value];
	if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return [];
	seen.add(value);
	return Reflect.ownKeys(value).flatMap((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor ? reachableStrings(descriptor.value, seen) : [];
	});
};

/** Assert no secret appears in any string reachable from, or rendered off, `error`. */
const assertNoSecret = (error: unknown, secrets: ReadonlyArray<string>): void => {
	const strings = [
		...reachableStrings(error),
		String(error),
		JSON.stringify(error) ?? "",
		inspect(error, { depth: 12, showHidden: true }),
	];
	assert.isAbove(strings.length, 3, "the walk reached the error's strings");
	for (const secret of secrets) for (const s of strings) assert.notInclude(s, secret);
};

/** The redacted `HttpClientError` an error keeps as its cause, at any depth. */
const httpCauseOf = (error: unknown): HttpClientError.HttpClientError => {
	let current: unknown = error;
	for (let depth = 0; depth < 6; depth++) {
		if (HttpClientError.isHttpClientError(current)) return current;
		current = (current as { cause?: unknown } | undefined)?.cause;
	}
	return assert.fail("expected an HttpClientError somewhere in the cause chain");
};

const failureOf = <A, E>(exit: Exit.Exit<A, E>): E => {
	if (Exit.isSuccess(exit)) return assert.fail("expected a failure");
	const error = Cause.findErrorOption(exit.cause);
	if (Option.isNone(error)) return assert.fail("expected a typed failure");
	return error.value;
};

const fetchLayer = (fake: typeof globalThis.fetch) =>
	FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake)));

const refused: typeof globalThis.fetch = async (input) => {
	throw new TypeError(`fetch failed: ${String(input)}`);
};

/** Answers 200, then the body stream fails mid-read. */
const brokenBody: typeof globalThis.fetch = async () =>
	new Response(new ReadableStream({ start: (controller) => controller.error(new Error("socket hang up")) }), {
		status: 200,
	});

describe("positive control", () => {
	it("the walk finds a bearer token on core's own error", () => {
		const raw = new HttpClientError.HttpClientError({
			reason: new HttpClientError.TransportError({
				request: HttpClientRequest.get("https://x.example").pipe(HttpClientRequest.bearerToken("planted_token")),
			}),
		});
		assert.isTrue(reachableStrings(raw).some((s) => s.includes("planted_token")));
	});
});

describe("OidcTokenIssuer keeps no request token on a failure", () => {
	const BEARER = "SECRET_oidc_request_token_a11e";
	const issuer = (fake: typeof globalThis.fetch) =>
		OidcTokenIssuer.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					ActionEnvironment.layerTest({
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: BEARER,
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/?api-version=2.0",
					}),
					fetchLayer(fake),
					ActionOutputs.recording().layer,
				),
			),
		);

	for (const [label, fake] of [
		["requestFailed", refused],
		["malformedResponse", async () => new Response("{ not json", { status: 200 })],
	] as const) {
		it.effect(`${label}: the cause keeps the request, minus the bearer`, () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					Effect.flatMap(OidcTokenIssuer, (i) => i.token()).pipe(Effect.provide(issuer(fake))),
				);
				const error = failureOf(exit);
				assert.strictEqual(error.reason, label);
				const cause = httpCauseOf(error);
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				assert.include(cause.request.url, "token.actions.example");
				assertNoSecret(error, [BEARER]);
			}),
		);
	}
});

describe("the Twirp results client keeps no runtime token on a failure", () => {
	const TOKEN = RESULTS_ENV.ACTIONS_RUNTIME_TOKEN ?? "";
	const noTransfer: DataBlobTransfer = {
		uploadData: () => Effect.die("unused"),
		downloadToBuffer: () => Effect.die("unused"),
	};
	const store = (fake: typeof globalThis.fetch) =>
		GitHubCacheBlobStore.layerWith(noTransfer).pipe(Layer.provide(Layer.mergeAll(resultsEnv(), fetchLayer(fake))));

	for (const [label, fake] of [
		["transport", refused],
		["malformed", async () => new Response("{ not json", { status: 200 })],
	] as const) {
		it.effect(`a ${label} failure: the cause keeps the request, minus the token`, () =>
			Effect.gen(function* () {
				assert.isAbove(TOKEN.length, 20, "the fixture carries a real-shaped runtime token");
				const exit = yield* settle(
					Effect.flatMap(BlobStore, (blobs) => blobs.has("k")).pipe(Effect.provide(store(fake))),
					TestClock.adjust(Duration.minutes(1)),
				);
				const error = failureOf(exit);
				const cause = httpCauseOf(error);
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				assert.include(cause.request.url, "results.example");
				assertNoSecret(error, [TOKEN]);
			}),
		);
	}
});

describe("the S3 BlobStore keeps no signature or session token on a failure", () => {
	const SESSION = "SECRET_s3_session_token_0d0d";

	class Meta extends Schema.Class<Meta>("Meta")({ tag: Schema.String }) {}

	for (const [label, answer] of [
		["transport", refused],
		["body read", brokenBody],
	] as const) {
		it.effect(`a ${label} failure: the cause keeps the request, minus authorization and the session token`, () =>
			Effect.gen(function* () {
				let sentAuthorization: string | null = null;
				const fake: typeof globalThis.fetch = async (input, init) => {
					sentAuthorization = new Headers(init?.headers).get("authorization");
					return answer(input, init);
				};
				const layer = BlobStore.layerS3({
					bucket: "cache",
					region: "auto",
					endpoint: "https://account.r2.cloudflarestorage.com",
					accessKeyId: "AKIAEXAMPLE",
					secretAccessKey: Redacted.make("secret-key"),
					sessionToken: Redacted.make(SESSION),
				}).pipe(Layer.provide(Layer.mergeAll(ActionOutputs.recording().layer, NodeCrypto.layer, fetchLayer(fake))));
				const exit = yield* Effect.exit(
					Effect.flatMap(BlobStore, (blobs) => blobs.get("k", Meta)).pipe(Effect.provide(layer)),
				);
				const error = failureOf(exit);
				const signature = String(sentAuthorization).match(/Signature=([0-9a-f]+)/)?.[1];
				if (signature === undefined) return assert.fail("the request was really signed");
				const cause = httpCauseOf(error);
				assert.strictEqual(cause.request.headers.authorization, "REDACTED");
				assert.strictEqual(cause.request.headers["x-amz-security-token"], "REDACTED");
				assert.strictEqual(cause.request.method, "GET");
				assertNoSecret(error, [SESSION, signature]);
			}),
		);
	}
});

describe("ToolInstaller.download keeps no url credential on a failure", () => {
	const PASSWORD = "SECRET_download_password_7e7e";
	const QUERY = "SECRET_download_sas_sig_1f1f";

	for (const [label, answer] of [
		["transport", refused],
		["body read", brokenBody],
	] as const) {
		it.effect(`a ${label} failure: the subject, message and cause carry the url with its credentials redacted`, () =>
			Effect.gen(function* () {
				const layer = ToolInstaller.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							ActionEnvironment.layerTest({ RUNNER_TOOL_CACHE: "/nonexistent-tool-cache" }),
							NodeServices.layer,
							fetchLayer(answer),
						),
					),
				);
				const url = `https://ci:${PASSWORD}@downloads.example/node.tar.gz?sig=${QUERY}&v=22`;
				const exit = yield* settle(
					Effect.flatMap(ToolInstaller, (installer) => installer.download(url)).pipe(Effect.provide(layer)),
					TestClock.adjust(Duration.minutes(1)),
				);
				const error = failureOf(exit);
				assert.strictEqual(error.reason, "downloadFailed");
				assert.strictEqual(error.subject, "https://REDACTED:REDACTED@downloads.example/node.tar.gz?sig=REDACTED&v=22");
				assert.include(error.message, "downloads.example");
				assertNoSecret(error, [PASSWORD, QUERY]);
				if (label === "body read") {
					assert.strictEqual(httpCauseOf(error).request.url, error.subject);
				}
			}),
		);
	}
});
