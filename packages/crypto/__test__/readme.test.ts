// The README's examples, compiled and run, so the published page cannot drift from the API.
import { createHmac } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";
import type { CryptoError } from "effect/crypto";
import { Digest, Mac, SecureRandom } from "effect/crypto";
import { HttpClient, HttpClientError } from "effect/http";
import type { FingerprintError, SigV4Credentials, SigV4PathError } from "../src/index.js";
import { ConstantTime, Fingerprint, Hmac, HttpRedaction, SigV4 } from "../src/index.js";

// README: What to provide
export const CryptoLive: Layer.Layer<Mac.Mac | Digest.Digest> = Layer.mergeAll(
	Digest.layerWebCrypto,
	Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);

// README: What to provide (Node)
export const NodeCryptoLive: Layer.Layer<Mac.Mac | Digest.Digest> = Layer.mergeAll(
	NodeCrypto.layerMac,
	NodeCrypto.layerDigest,
);

// README: Sign and verify an HMAC
export const signDelivery = (
	secret: Redacted.Redacted<string>,
	timestamp: string,
	body: Uint8Array,
): Effect.Effect<string, CryptoError.CryptoError, Mac.Mac> =>
	Hmac.sign({ algorithm: "SHA-256", key: secret, message: [`${timestamp}.`, body], encoding: "hex" });

export const verifyDelivery = (
	secret: Redacted.Redacted<string>,
	timestamp: string,
	body: Uint8Array,
	signature: string,
): Effect.Effect<boolean, CryptoError.CryptoError, Mac.Mac> =>
	Hmac.verify({ algorithm: "SHA-256", key: secret, message: [`${timestamp}.`, body], signature, encoding: "hex" });

// README: Compare in constant time
const expectedHex = "9f86d081884c7d65";
const receivedHex = "9f86d081884c7d65";
// Two digests or MACs, whose length is public:
export const sameDigest: boolean = ConstantTime.equal(expectedHex, receivedHex);

export const checkApiKey = (
	expected: Redacted.Redacted<string>,
	received: string,
): Effect.Effect<boolean, CryptoError.CryptoError, Mac.Mac> => ConstantTime.secretsEqual(expected, received);

// README: Sign an S3 request
export const readFirstBytes = (
	credentials: SigV4Credentials,
	host: string,
	key: string,
	now: Date,
): Effect.Effect<
	{ readonly url: string; readonly headers: Record<string, string> },
	SigV4PathError | CryptoError.CryptoError,
	Digest.Digest | Mac.Mac
> =>
	SigV4.sign(
		{
			method: "GET",
			host,
			path: key,
			headers: { range: "bytes=0-9" },
			payloadHash: SigV4.EMPTY_PAYLOAD_HASH,
			now,
		},
		credentials,
	).pipe(
		Effect.map((signed) => ({
			url: `https://${host}${signed.path}${signed.query === "" ? "" : `?${signed.query}`}`,
			headers: signed.headers,
		})),
	);

// README: Detect drift
export const plan = (
	applied: string | undefined,
	live: unknown,
	desired: unknown,
): Effect.Effect<string, FingerprintError, Digest.Digest> =>
	Effect.gen(function* () {
		const decision = Fingerprint.decide({
			applied,
			live: yield* Fingerprint.of(live),
			desired: yield* Fingerprint.of(desired),
		});
		switch (decision._tag) {
			case "Apply":
				return "apply";
			case "Unchanged":
				return "skip";
			case "Drift":
				return `changed outside this tool: ${decision.applied} is now ${decision.live}`;
		}
	});

// README: Keep an HTTP error without its credentials
export class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
	cause: Schema.Defect(),
}) {}

export const fetchManifest = (
	token: Redacted.Redacted<string>,
	url: string,
): Effect.Effect<unknown, RegistryError, HttpClient.HttpClient> =>
	HttpClient.get(url, { headers: { authorization: `Bearer ${Redacted.value(token)}` } }).pipe(
		Effect.mapError((cause) => new RegistryError({ cause: HttpRedaction.cause(cause) })),
	);

export const redactedUrl: string = HttpRedaction.url("https://user:pw@registry.test/pkg?token=abc&page=2");

// The AWS documented GET Object example (2013-05-24, the AKIAIOSFODNN7EXAMPLE pair).
const awsExample: SigV4Credentials = {
	accessKeyId: "AKIAIOSFODNN7EXAMPLE",
	secretAccessKey: Redacted.make("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
	region: "us-east-1",
	service: "s3",
};
const AWS_SIGNATURE = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("README examples", () => {
	for (const [name, live] of [
		["WebCrypto", CryptoLive],
		["NodeCrypto", NodeCryptoLive],
	] as const) {
		layer(live)(`on ${name}`, (it) => {
			it.effect("signs an HMAC that node:crypto agrees with, then verifies it", () =>
				Effect.gen(function* () {
					const secret = Redacted.make("whsec_test");
					const body = utf8('{"ok":true}');
					const signature = yield* signDelivery(secret, "1700000000", body);
					const oracle = createHmac("sha256", "whsec_test").update("1700000000.").update(body).digest("hex");
					assert.strictEqual(signature, oracle);
					assert.isTrue(yield* verifyDelivery(secret, "1700000000", body, signature));
					assert.isTrue(yield* verifyDelivery(secret, "1700000000", body, signature.toUpperCase()));
					assert.isFalse(yield* verifyDelivery(secret, "1700000001", body, signature));
					assert.isFalse(yield* verifyDelivery(secret, "1700000000", body, "not hex"));
				}),
			);

			it.effect("compares a shared secret through blinded MACs", () =>
				Effect.gen(function* () {
					const expected = Redacted.make("s3cret-key");
					assert.isTrue(yield* checkApiKey(expected, "s3cret-key"));
					assert.isFalse(yield* checkApiKey(expected, "s3cret-kez"));
					assert.isFalse(yield* checkApiKey(expected, "s3cret"));
				}),
			);

			it.effect("signs AWS's documented GET Object example", () =>
				Effect.gen(function* () {
					const { url, headers } = yield* readFirstBytes(
						awsExample,
						"examplebucket.s3.amazonaws.com",
						"/test.txt",
						new Date("2013-05-24T00:00:00Z"),
					);
					assert.strictEqual(url, "https://examplebucket.s3.amazonaws.com/test.txt");
					assert.strictEqual(headers.authorization?.split("Signature=")[1], AWS_SIGNATURE);
					assert.strictEqual(headers["x-amz-date"], "20130524T000000Z");
				}),
			);

			it.effect("refuses a path a URL would collapse", () =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(readFirstBytes(awsExample, "h.test", "/a/../b", new Date(0)));
					assert.strictEqual(error._tag, "SigV4PathError");
				}),
			);

			it.effect("plans Apply, Unchanged and Drift from fingerprints", () =>
				Effect.gen(function* () {
					const applied = yield* Fingerprint.of({ name: "main", rules: ["a"] });
					assert.strictEqual(yield* plan(undefined, {}, { name: "main" }), "apply");
					assert.strictEqual(
						yield* plan(applied, { rules: ["a"], name: "main" }, { name: "main", rules: ["a"] }),
						"skip",
					);
					assert.strictEqual(
						yield* plan(applied, { name: "main", rules: ["a"] }, { name: "main", rules: ["b"] }),
						"apply",
					);
					const drift = yield* plan(applied, { name: "main", rules: ["a", "x"] }, { name: "main", rules: ["a"] });
					assert.isTrue(drift.startsWith(`changed outside this tool: ${applied} is now `));
				}),
			);

			it.effect("refuses a value with no JSON form", () =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(plan(undefined, { size: 1n }, {}));
					assert.strictEqual(error._tag, "FingerprintError");
					assert.strictEqual(error.path, "/size");
				}),
			);
		});
	}

	it("compares digests in constant time", () => {
		assert.isTrue(sameDigest);
		assert.isFalse(ConstantTime.equal("9f86d081884c7d65", "9f86d081884c7d66"));
	});

	it("redacts a URL's userinfo and token", () => {
		assert.strictEqual(redactedUrl, "https://REDACTED:REDACTED@registry.test/pkg?token=REDACTED&page=2");
	});

	it.effect("keeps a failed request's cause without the bearer token", () =>
		Effect.gen(function* () {
			const failing = HttpClient.make((request) =>
				Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({ request, cause: new TypeError("fetch failed") }),
					}),
				),
			);
			const error = yield* Effect.flip(
				fetchManifest(Redacted.make("SECRET_token_1234"), "https://registry.test/pkg").pipe(
					Effect.provideService(HttpClient.HttpClient, failing),
				),
			);
			assert.strictEqual(error._tag, "RegistryError");
			const cause = error.cause as HttpClientError.HttpClientError;
			assert.strictEqual(cause.request.headers.authorization, "REDACTED");
			assert.strictEqual(cause.request.url, "https://registry.test/pkg");
		}),
	);
});
