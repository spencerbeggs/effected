import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { SigV4, SigV4PathError } from "@effected/crypto";
import { Crypto, DateTime, Effect, Layer, Option, PlatformError, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import type { S3Config } from "../src/index.js";
import { ActionOutputs, BlobStore, BlobStoreError, NotABlobEnvelopeError } from "../src/index.js";

class Meta extends Schema.Class<Meta>("Meta")({ tag: Schema.String, durationMs: Schema.Number }) {}

const CONFIG: S3Config = {
	bucket: "cache",
	region: "auto",
	endpoint: "https://account.r2.cloudflarestorage.com",
	accessKeyId: "AKIAEXAMPLE",
	secretAccessKey: Redacted.make("secret-key"),
};

/** Records every mask, so the declassification ordering is observable. */
const recordingOutputs = () => {
	const masked: Array<string> = [];
	const layer = ActionOutputs.layerTest({
		setSecret: (value) =>
			Effect.suspend(() => {
				masked.push(value);
				return Effect.void;
			}),
	});
	return { masked, layer };
};

// The signing algorithm itself is `@effected/crypto`'s, pinned there against
// AWS's published vectors. What is tested here is the store's use of it: what
// it signs, with which clock, and what it sends.
const s3 = (
	fake: typeof globalThis.fetch,
	config: S3Config = CONFIG,
	outputs = recordingOutputs(),
	crypto: Layer.Layer<Crypto.Crypto> = NodeCrypto.layer,
) =>
	BlobStore.layerS3(config).pipe(
		Layer.provide(
			Layer.mergeAll(
				outputs.layer,
				crypto,
				FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake))),
			),
		),
	);

/** Every request the fake store saw: url, method and headers, names lower-cased. */
const recordingFetch = () => {
	const seen: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
	const fake: typeof globalThis.fetch = async (input, init) => {
		seen.push({
			url: String(input),
			method: init?.method ?? "GET",
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
		});
		return new Response(null, { status: 200 });
	};
	return { seen, fake };
};

describe("BlobStore", () => {
	describe("the S3 backend", () => {
		it.effect("puts a framed blob at a path-style url", () =>
			Effect.gen(function* () {
				const seen: Array<{ url: string; method: string; authorization: string | null }> = [];
				const fake: typeof globalThis.fetch = async (input, init) => {
					seen.push({
						url: String(input),
						method: init?.method ?? "GET",
						authorization: new Headers(init?.headers).get("authorization"),
					});
					return new Response(null, { status: 200 });
				};
				yield* Effect.gen(function* () {
					yield* (yield* BlobStore).put(
						"build/1",
						{ metadata: Meta.make({ tag: "x", durationMs: 12 }), body: new Uint8Array([9]) },
						Meta,
					);
				}).pipe(Effect.provide(s3(fake)));

				// Path-style, not virtual-host: that is what makes one layer work
				// against R2, MinIO and Spaces as well as AWS.
				assert.strictEqual(seen[0]?.url, "https://account.r2.cloudflarestorage.com/cache/build/1");
				assert.strictEqual(seen[0]?.method, "PUT");
				assert.include(seen[0]?.authorization ?? "", "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/");
			}),
		);

		it.effect("applies the key prefix", () =>
			Effect.gen(function* () {
				const seen: Array<string> = [];
				const fake: typeof globalThis.fetch = async (input) => {
					seen.push(String(input));
					return new Response(null, { status: 200 });
				};
				yield* Effect.gen(function* () {
					yield* (yield* BlobStore).has("k");
				}).pipe(Effect.provide(s3(fake, { ...CONFIG, prefix: "ci" })));
				assert.strictEqual(seen[0], "https://account.r2.cloudflarestorage.com/cache/ci/k");
			}),
		);

		it.effect("reports a miss as nothing, not as a failure", () =>
			Effect.gen(function* () {
				const fake: typeof globalThis.fetch = async () => new Response("", { status: 404 });
				const found = yield* Effect.gen(function* () {
					return yield* (yield* BlobStore).get("absent", Meta);
				}).pipe(Effect.provide(s3(fake)));
				assert.isTrue(Option.isNone(found));
			}),
		);

		it.effect("has() is false for 404 and true for 200", () =>
			Effect.gen(function* () {
				const present: typeof globalThis.fetch = async () => new Response(null, { status: 200 });
				const absent: typeof globalThis.fetch = async () => new Response(null, { status: 404 });
				assert.isTrue(
					yield* Effect.gen(function* () {
						return yield* (yield* BlobStore).has("k");
					}).pipe(Effect.provide(s3(present))),
				);
				assert.isFalse(
					yield* Effect.gen(function* () {
						return yield* (yield* BlobStore).has("k");
					}).pipe(Effect.provide(s3(absent))),
				);
			}),
		);

		it.effect("fails typed, carrying the status, when the store refuses", () =>
			Effect.gen(function* () {
				const fake: typeof globalThis.fetch = async () => new Response("denied", { status: 403 });
				const error = yield* Effect.flip(
					Effect.flatMap(BlobStore, (store) => store.get("k", Meta)).pipe(Effect.provide(s3(fake))),
				);
				assert.instanceOf(error, BlobStoreError);
				assert.strictEqual(error.reason === "refused" ? error.status : undefined, 403);
			}),
		);

		it.effect("round-trips metadata and body through the real frame", () =>
			Effect.gen(function* () {
				const stored = new Map<string, Uint8Array>();
				const fake: typeof globalThis.fetch = async (input, init) => {
					const key = String(input);
					if ((init?.method ?? "GET") === "PUT") {
						stored.set(key, new Uint8Array(await new Response(init?.body).arrayBuffer()));
						return new Response(null, { status: 200 });
					}
					const found = stored.get(key);
					return found === undefined ? new Response(null, { status: 404 }) : new Response(found, { status: 200 });
				};
				const layer = s3(fake);
				yield* Effect.gen(function* () {
					const store = yield* BlobStore;
					yield* store.put(
						"k",
						{ metadata: Meta.make({ tag: "turbo", durationMs: 4200 }), body: new Uint8Array([1, 2, 3]) },
						Meta,
					);
					const found = yield* store.get("k", Meta);
					assert.isTrue(Option.isSome(found));
					if (Option.isSome(found)) {
						assert.deepStrictEqual(found.value.metadata, Meta.make({ tag: "turbo", durationMs: 4200 }));
						assert.deepStrictEqual([...found.value.body], [1, 2, 3]);
					}
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("reports an unframed legacy blob as a typed miss, not as garbage metadata", () =>
			Effect.gen(function* () {
				// The reason the magic prefix exists: a store holding pre-envelope
				// entries must produce a clean, named failure rather than decoding
				// arbitrary bytes as metadata.
				const fake: typeof globalThis.fetch = async () =>
					new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 });
				const error = yield* Effect.flip(
					Effect.flatMap(BlobStore, (store) => store.get("legacy", Meta)).pipe(Effect.provide(s3(fake))),
				);
				assert.instanceOf(error, NotABlobEnvelopeError);
			}),
		);

		it.effect("masks the signing key once, at layer construction", () =>
			Effect.gen(function* () {
				const outputs = recordingOutputs();
				const fake: typeof globalThis.fetch = async () => new Response(null, { status: 200 });
				const layer = s3(fake, { ...CONFIG, sessionToken: Redacted.make("session") }, outputs);
				yield* Effect.gen(function* () {
					const store = yield* BlobStore;
					yield* store.has("a");
					yield* store.has("b");
				}).pipe(Effect.provide(layer));
				// Both credentials masked; once each, not once per request.
				assert.deepStrictEqual(outputs.masked, ["secret-key", "session"]);
			}),
		);
	});

	describe("signing", () => {
		it.effect("sends exactly the headers it signed, session token included", () =>
			Effect.gen(function* () {
				const { seen, fake } = recordingFetch();
				yield* Effect.flatMap(BlobStore, (store) =>
					store.put("k", { metadata: Meta.make({ tag: "x", durationMs: 1 }), body: new Uint8Array([7]) }, Meta),
				).pipe(Effect.provide(s3(fake, { ...CONFIG, sessionToken: Redacted.make("session") })));
				const headers = seen[0]?.headers ?? {};
				const signed = /SignedHeaders=([^,]+)/.exec(headers.authorization ?? "")?.[1]?.split(";") ?? [];
				// The HTTP client adds headers after signing (`content-type` for the
				// body, trace propagation), which SigV4 permits unsigned. What it does
				// not permit is an unsigned `host` or `x-amz-*`, or a signed header
				// that is never sent.
				const mustSign = Object.keys(headers)
					.filter((name) => name === "host" || name.startsWith("x-amz-"))
					.sort();
				assert.deepStrictEqual([...signed].sort(), mustSign, "every host and x-amz-* header sent must be signed");
				for (const name of signed) assert.property(headers, name, `${name} is signed but not sent`);
				assert.include(signed, "x-amz-security-token");
				assert.strictEqual(headers["x-amz-security-token"], "session");
				assert.strictEqual(headers.host, "account.r2.cloudflarestorage.com");
			}),
		);

		it.effect("sends the store no trace context", () =>
			Effect.gen(function* () {
				const { seen, fake } = recordingFetch();
				const transport = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fake)));
				// The control: the same client, used directly, does propagate, so the
				// fake observes these headers when they are sent.
				yield* HttpClient.get("https://elsewhere.example/").pipe(Effect.provide(transport));
				assert.property(seen[0]?.headers, "traceparent");
				assert.property(seen[0]?.headers, "b3");
				yield* Effect.flatMap(BlobStore, (store) => store.has("k")).pipe(Effect.provide(s3(fake)));
				assert.strictEqual(seen.length, 2);
				assert.notProperty(seen[1]?.headers, "traceparent");
				assert.notProperty(seen[1]?.headers, "b3");
			}),
		);

		it.effect("signs at the Clock's instant, not the wall clock's", () =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.UTC(2024, 0, 2, 3, 4, 5));
				const { seen, fake } = recordingFetch();
				yield* Effect.flatMap(BlobStore, (store) => store.has("k")).pipe(Effect.provide(s3(fake)));
				assert.strictEqual(seen[0]?.headers["x-amz-date"], "20240102T030405Z");
				assert.include(seen[0]?.headers.authorization ?? "", "Credential=AKIAEXAMPLE/20240102/auto/s3/aws4_request");
			}),
		);

		it.effect("requests the path it signed, encoding the characters encodeURIComponent leaves alone", () =>
			Effect.gen(function* () {
				const { seen, fake } = recordingFetch();
				yield* Effect.flatMap(BlobStore, (store) => store.has("it's (a)*!")).pipe(Effect.provide(s3(fake)));
				assert.strictEqual(seen[0]?.url, "https://account.r2.cloudflarestorage.com/cache/it%27s%20%28a%29%2A%21");
			}),
		);

		it.effect("sends the very target and headers SigV4.sign returned, never a re-encoding", () =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.UTC(2024, 0, 2, 3, 4, 5));
				const key = "it's (a)*!/v1.2/.../ü";
				const { seen, fake } = recordingFetch();
				yield* Effect.flatMap(BlobStore, (store) => store.has(key)).pipe(Effect.provide(s3(fake)));
				// Signed independently, at the same instant, with the same inputs.
				const signed = yield* SigV4.sign(
					{
						method: "HEAD",
						host: "account.r2.cloudflarestorage.com",
						path: `cache/${key}`,
						body: new Uint8Array(0),
						now: DateTime.makeUnsafe(Date.UTC(2024, 0, 2, 3, 4, 5)),
					},
					{ accessKeyId: "AKIAEXAMPLE", secretAccessKey: CONFIG.secretAccessKey, region: "auto", service: "s3" },
				).pipe(Effect.provide(NodeCrypto.layer));
				assert.strictEqual(signed.path, "/cache/it%27s%20%28a%29%2A%21/v1.2/.../%C3%BC");
				assert.strictEqual(seen[0]?.url, `https://account.r2.cloudflarestorage.com${signed.path}`);
				assert.strictEqual(seen[0]?.headers.authorization, signed.headers.authorization);
			}),
		);

		it.effect("fails a key with a . or .. segment as invalidKey, typed, and sends nothing", () =>
			Effect.gen(function* () {
				// Why the refusal exists: the WHATWG URL the client resolves collapses them.
				assert.strictEqual(new URL("https://h.example/cache/a/../b/./c").pathname, "/cache/b/c");
				for (const key of ["a/../b", "./a", "a/.", "..", "a/./b"]) {
					const { seen, fake } = recordingFetch();
					const error = yield* Effect.flip(
						Effect.flatMap(BlobStore, (store) => store.has(key)).pipe(Effect.provide(s3(fake))),
					);
					assert.instanceOf(error, BlobStoreError, key);
					assert.strictEqual(error.reason, "invalidKey", key);
					assert.strictEqual(error.key, key);
					assert.match(error.detail ?? "", /"\.\.?" segment/, key);
					assert.include(error.message, `"${key}"`);
					// The cause is crypto's own typed refusal, carrying the signed path and the segment.
					assert.instanceOf(error.cause, SigV4PathError, key);
					if (error.cause instanceof SigV4PathError) {
						assert.strictEqual(error.cause.path, `cache/${key}`, key);
						assert.strictEqual(
							error.cause.segment,
							key.split("/").find((part) => part === "." || part === ".."),
						);
					}
					assert.strictEqual(seen.length, 0, `${key}: nothing leaves the process`);
				}
			}),
		);

		it.effect("fails as misconfigured, naming the key, when the request cannot be signed", () =>
			Effect.gen(function* () {
				const { seen, fake } = recordingFetch();
				const failure = PlatformError.badArgument({ module: "Crypto", method: "digest", description: "no SHA-256" });
				const broken = Layer.succeed(
					Crypto.Crypto,
					Crypto.make({ randomBytes: (size) => new Uint8Array(size), digest: () => Effect.fail(failure) }),
				);
				const error = yield* Effect.flip(
					Effect.flatMap(BlobStore, (store) => store.has("k")).pipe(
						Effect.provide(s3(fake, CONFIG, recordingOutputs(), broken)),
					),
				);
				assert.instanceOf(error, BlobStoreError);
				assert.strictEqual(error.reason, "misconfigured");
				assert.strictEqual(error.key, "k");
				assert.strictEqual(error.cause, failure);
				// Nothing unsigned leaves the process.
				assert.strictEqual(seen.length, 0);
			}),
		);
	});

	describe("the in-memory backend", () => {
		it.effect("runs the real framing, so a round trip proves the metadata survives", () =>
			Effect.gen(function* () {
				const store = yield* BlobStore;
				assert.isFalse(yield* store.has("k"));
				yield* store.put("k", { metadata: Meta.make({ tag: "t", durationMs: 1 }), body: new Uint8Array([7]) }, Meta);
				assert.isTrue(yield* store.has("k"));
				const found = yield* store.get("k", Meta);
				assert.isTrue(Option.isSome(found));
				if (Option.isSome(found)) {
					assert.strictEqual(found.value.metadata.tag, "t");
					assert.deepStrictEqual([...found.value.body], [7]);
				}
			}).pipe(Effect.provide(BlobStore.layerMemory)),
		);

		it.effect("reports an absent key as nothing", () =>
			Effect.gen(function* () {
				assert.isTrue(Option.isNone(yield* (yield* BlobStore).get("absent", Meta)));
			}).pipe(Effect.provide(BlobStore.layerMemory)),
		);
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies rather than reporting a miss", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Effect.flatMap(BlobStore, (store) => store.has("k")));
				assert.strictEqual(exit._tag, "Failure");
			}).pipe(Effect.provide(BlobStore.layerTest())),
		);
	});
});
