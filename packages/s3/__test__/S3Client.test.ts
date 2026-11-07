import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Layer, Option, Redacted, Stream } from "effect";
import { HttpClient, HttpClientError } from "effect/http";
import type { S3ClientShape } from "../src/S3Client.js";
import { S3Client } from "../src/S3Client.js";
import type { S3InvalidRequestReason } from "../src/S3Error.js";
import { S3ConditionalConflict, S3InvalidRequest, S3PreconditionFailed } from "../src/S3Error.js";
import type { FakeS3, SeenRequest } from "./utils/fake-s3.js";
import {
	ACCESS_KEY_ID,
	CryptoLive,
	SECRET_ACCESS_KEY,
	SESSION_TOKEN,
	fakeS3,
	r2Options,
	xmlError,
} from "./utils/fake-s3.js";

const encoder = new TextEncoder();
const sha256Hex = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");

/** Run `body` against a fresh fake bucket; hand back the program's result and the store. */
const withStore = <A, E>(
	body: (s3: S3ClientShape, store: FakeS3) => Effect.Effect<A, E>,
	store: FakeS3 = fakeS3(),
	options = r2Options(),
) =>
	Effect.gen(function* () {
		const s3 = yield* S3Client;
		return yield* body(s3, store);
	}).pipe(Effect.provide(store.layer(options)));

const only = (store: FakeS3): SeenRequest => {
	assert.lengthOf(store.seen, 1);
	const [request] = store.seen;
	if (request === undefined) throw new Error("no request");
	return request;
};

describe("S3Client.put", () => {
	it.effect("writes the object, signs every header it sends, and answers the ETag and version", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				const result = yield* s3.put("raw/2026/11/06/a.json", '{"a":1}', {
					contentType: "application/json",
					metadata: { Vendor: "stripe", attempt: "2" },
				});
				const request = only(store);
				assert.isTrue(request.signatureValid);
				assert.strictEqual(request.method, "PUT");
				assert.strictEqual(request.url.href, "https://account.r2.example.com/archive/raw/2026/11/06/a.json");
				// SigV4 header presence: the three every store checks.
				assert.match(
					request.headers.authorization ?? "",
					new RegExp(`^AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/19700101/auto/s3/aws4_request, SignedHeaders=`),
				);
				assert.strictEqual(request.headers["x-amz-date"], "19700101T000000Z");
				assert.strictEqual(request.headers["x-amz-content-sha256"], sha256Hex(encoder.encode('{"a":1}')));
				const signed = /SignedHeaders=([^,]+)/.exec(request.headers.authorization ?? "")?.[1]?.split(";") ?? [];
				for (const name of [
					"content-type",
					"host",
					"x-amz-content-sha256",
					"x-amz-date",
					"x-amz-meta-attempt",
					"x-amz-meta-vendor",
				]) {
					assert.include(signed, name);
				}
				assert.strictEqual(request.headers["content-type"], "application/json");
				assert.strictEqual(request.headers["x-amz-meta-vendor"], "stripe");
				// No trace context reaches a third-party store.
				assert.isUndefined(request.headers.traceparent);
				assert.isUndefined(request.headers.b3);
				const stored = store.objects.get("raw/2026/11/06/a.json");
				assert.strictEqual(new TextDecoder().decode(stored?.body), '{"a":1}');
				assert.strictEqual(result.etag, stored?.etag);
				assert.strictEqual(result.versionId, "v1");
			}),
		),
	);

	it.effect("defaults the content type by body kind", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* s3.put("text", "hello");
				yield* s3.put("bytes", new Uint8Array([1, 2, 3]));
				assert.strictEqual(store.objects.get("text")?.contentType, "text/plain; charset=utf-8");
				assert.strictEqual(store.objects.get("bytes")?.contentType, "application/octet-stream");
				assert.deepStrictEqual([...(store.objects.get("bytes")?.body ?? [])], [1, 2, 3]);
			}),
		),
	);

	it.effect("ifNoneMatch '*': the first write wins and the second is S3PreconditionFailed", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* s3.put("once", "first", { ifNoneMatch: "*" });
				const error = yield* Effect.flip(s3.put("once", "second", { ifNoneMatch: "*" }));
				assert.strictEqual(error._tag, "S3PreconditionFailed");
				assert.strictEqual(error.key, "once");
				assert.strictEqual(store.seen[1]?.headers["if-none-match"], "*");
				assert.isTrue(store.seen[1]?.signatureValid);
				assert.strictEqual(new TextDecoder().decode(store.objects.get("once")?.body), "first");
			}),
		),
	);

	it.effect("ifMatch: a stale ETag loses with 412, the current one wins", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				const first = yield* s3.put("doc", "v1");
				const lost = yield* Effect.flip(s3.put("doc", "v2", { ifMatch: '"stale"' }));
				assert.strictEqual(lost._tag, "S3PreconditionFailed");
				const won = yield* s3.put("doc", "v2", { ifMatch: first.etag });
				assert.notStrictEqual(won.etag, first.etag);
			}),
		),
	);

	it.effect("a 409 ConditionalRequestConflict is S3ConditionalConflict, a lost race to retry", () =>
		withStore(
			(s3, store) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("once", "v", { ifNoneMatch: "*" }));
					if (error._tag !== "S3ConditionalConflict") return assert.fail(`raised ${error._tag}`);
					assert.strictEqual(error.operation, "put");
					assert.strictEqual(error.bucket, "archive");
					assert.strictEqual(error.key, "once");
					assert.include(error.message, "retry the write");
					assert.lengthOf(store.seen, 1);
				}),
			fakeS3((request) =>
				request.method === "PUT"
					? xmlError(409, "ConditionalRequestConflict", "A conflicting operation occurred. Retry the request.")
					: undefined,
			),
		),
	);

	it.effect("a 409 with any other code stays S3RequestFailed", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("once", "v", { ifNoneMatch: "*" }));
					if (error._tag !== "S3RequestFailed") return assert.fail(`raised ${error._tag}`);
					assert.strictEqual(error.status, 409);
					assert.strictEqual(error.code, "OperationAborted");
				}),
			fakeS3((request) =>
				request.method === "PUT"
					? xmlError(409, "OperationAborted", "A conflicting conditional operation is in progress.")
					: undefined,
			),
		),
	);

	it.effect("a 409 with no error document stays S3RequestFailed", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("once", "v", { ifNoneMatch: "*" }));
					if (error._tag !== "S3RequestFailed") return assert.fail(`raised ${error._tag}`);
					assert.strictEqual(error.status, 409);
					assert.isUndefined(error.code);
				}),
			fakeS3((request) => (request.method === "PUT" ? new Response("conflict", { status: 409 }) : undefined)),
		),
	);

	it.effect("a ConditionalRequestConflict code on another status is not read as the conflict", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("once", "v"));
					if (error._tag !== "S3RequestFailed") return assert.fail(`raised ${error._tag}`);
					assert.strictEqual(error.status, 400);
				}),
			fakeS3((request) =>
				request.method === "PUT" ? xmlError(400, "ConditionalRequestConflict", "odd store") : undefined,
			),
		),
	);

	it.effect("a 2xx without an ETag is S3MalformedResponse, not a result with an empty ETag", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("k", "v"));
					assert.strictEqual(error._tag, "S3MalformedResponse");
					if (error._tag === "S3MalformedResponse") assert.strictEqual(error.expected, "an ETag header");
				}),
			fakeS3((request) => (request.method === "PUT" ? new Response(null, { status: 200 }) : undefined)),
		),
	);

	it.effect("a refusal carries the error document's code, message and request id", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("k", "v"));
					if (error._tag !== "S3RequestFailed") return assert.fail(error.message);
					assert.strictEqual(error.status, 403);
					assert.strictEqual(error.code, "AccessDenied");
					assert.strictEqual(error.s3Message, "Access Denied");
					assert.strictEqual(error.requestId, "REQ123");
					assert.include(error.message, "403 (AccessDenied): Access Denied [request REQ123]");
				}),
			fakeS3((request) => (request.method === "PUT" ? xmlError(403, "AccessDenied", "Access Denied") : undefined)),
		),
	);
});

describe("S3Client.get", () => {
	it.effect("reads the body and its metadata", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				const put = yield* s3.put("a.json", '{"a":1}', { contentType: "application/json", metadata: { vendor: "x" } });
				const object = yield* s3.get("a.json");
				assert.strictEqual(object.text, '{"a":1}');
				assert.strictEqual(object.key, "a.json");
				assert.strictEqual(object.etag, put.etag);
				assert.strictEqual(object.contentType, "application/json");
				assert.strictEqual(object.contentLength, 7);
				assert.deepStrictEqual(object.metadata, { vendor: "x" });
				assert.strictEqual(
					object.lastModified === undefined ? undefined : DateTime.formatIso(object.lastModified),
					"2026-11-06T12:00:00.000Z",
				);
				assert.isTrue(store.seen.every((request) => request.signatureValid));
			}),
		),
	);

	it.effect("a missing key is S3NotFound", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(s3.get("missing"));
				assert.strictEqual(error._tag, "S3NotFound");
				assert.strictEqual(error.message, 'S3 get of "missing" in bucket "archive": no such object');
			}),
		),
	);

	it.effect("a missing bucket is S3RequestFailed, never S3NotFound", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.get("k"));
					if (error._tag !== "S3RequestFailed") return assert.fail(`read as ${error._tag}`);
					assert.strictEqual(error.status, 404);
					assert.strictEqual(error.code, "NoSuchBucket");
				}),
			fakeS3(() => xmlError(404, "NoSuchBucket", "The specified bucket does not exist")),
		),
	);

	// A misrouted endpoint (a proxy, an unbound custom domain, a wrong base path)
	// answers 404 for every key: reading that as "no such object" would hide it.
	for (const [name, response] of [
		["an HTML proxy page", () => new Response("<html><body>404 Not Found</body></html>", { status: 404 })],
		["plain text", () => new Response("404 page not found", { status: 404 })],
		["an empty body", () => new Response(null, { status: 404 })],
		["an <Error> document with no Code", () => new Response("<Error><Message>gone</Message></Error>", { status: 404 })],
	] as const) {
		it.effect(`a 404 carrying ${name} is S3RequestFailed, never S3NotFound`, () =>
			withStore(
				(s3) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(s3.get("k"));
						if (error._tag !== "S3RequestFailed") return assert.fail(`read as ${error._tag}`);
						assert.strictEqual(error.status, 404);
						assert.isUndefined(error.code);
					}),
				fakeS3(response),
			),
		);
	}

	it.effect("ifNoneMatch with the current ETag is S3NotModified", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				const put = yield* s3.put("k", "v");
				const error = yield* Effect.flip(s3.get("k", { ifNoneMatch: put.etag }));
				if (error._tag !== "S3NotModified") return assert.fail(error.message);
				assert.strictEqual(error.etag, put.etag);
				assert.isTrue(store.seen[1]?.signatureValid);
				// A stale ETag reads the body.
				assert.strictEqual((yield* s3.get("k", { ifNoneMatch: '"other"' })).text, "v");
			}),
		),
	);

	it.effect("a range reads part of the body and reports the Content-Range", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				yield* s3.put("k", "0123456789");
				const part = yield* s3.get("k", { range: "bytes=2-4" });
				assert.strictEqual(part.text, "234");
				assert.strictEqual(part.contentLength, 3);
				assert.strictEqual(part.contentRange, "bytes 2-4/10");
			}),
		),
	);

	it.effect("a 200 without an ETag is S3MalformedResponse", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.get("k"));
					assert.strictEqual(error._tag, "S3MalformedResponse");
				}),
			fakeS3(() => new Response("body", { status: 200 })),
		),
	);
});

describe("S3Client.head", () => {
	it.effect("reads the metadata and the length from the headers", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* s3.put("k", "hello", { metadata: { a: "1" } });
				const head = yield* s3.head("k");
				assert.strictEqual(head.contentLength, 5);
				assert.deepStrictEqual(head.metadata, { a: "1" });
				assert.strictEqual(store.seen[1]?.method, "HEAD");
				assert.isTrue(store.seen[1]?.signatureValid);
			}),
		),
	);

	it.effect("a missing key is S3NotFound", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(s3.head("missing"));
				assert.strictEqual(error._tag, "S3NotFound");
			}),
		),
	);

	it.effect("a 200 without Content-Length is S3MalformedResponse", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.head("k"));
					if (error._tag !== "S3MalformedResponse") return assert.fail(error.message);
					assert.strictEqual(error.expected, "a Content-Length header");
				}),
			fakeS3(() => new Response(null, { status: 200, headers: { etag: '"e"' } })),
		),
	);

	it.effect("an unparseable Last-Modified fails rather than being dropped", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.head("k"));
					assert.strictEqual(error._tag, "S3MalformedResponse");
				}),
			fakeS3(
				() =>
					new Response(null, {
						status: 200,
						headers: { etag: '"e"', "content-length": "1", "last-modified": "not a date" },
					}),
			),
		),
	);

	// `Date` reads both of these as real dates: "1" as 2001, 30 February as 2 March.
	for (const value of ["1", "Mon, 30 Feb 2026 12:00:00 GMT", "Fri, 06 Nov 2026 25:00:00 GMT", "2026-11-06T12:00:00Z"]) {
		it.effect(`a Last-Modified of ${JSON.stringify(value)} fails rather than reading leniently`, () =>
			withStore(
				(s3) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(s3.head("k"));
						if (error._tag !== "S3MalformedResponse") return assert.fail(`read as ${error._tag}`);
						assert.strictEqual(error.received, value);
					}),
				fakeS3(
					() =>
						new Response(null, {
							status: 200,
							headers: { etag: '"e"', "content-length": "1", "last-modified": value },
						}),
				),
			),
		);
	}

	it.effect("an IMF-fixdate Last-Modified is read exactly (positive control)", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const head = yield* s3.head("k");
					assert.strictEqual(
						head.lastModified === undefined ? undefined : DateTime.formatIso(head.lastModified),
						"2024-02-29T23:59:59.000Z",
					);
				}),
			fakeS3(
				() =>
					new Response(null, {
						status: 200,
						headers: { etag: '"e"', "content-length": "1", "last-modified": "Thu, 29 Feb 2024 23:59:59 GMT" },
					}),
			),
		),
	);

	it.effect("a refusal without a body is S3RequestFailed with no code", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.head("k"));
					if (error._tag !== "S3RequestFailed") return assert.fail(error.message);
					assert.strictEqual(error.status, 500);
					assert.isUndefined(error.code);
				}),
			fakeS3(() => new Response(null, { status: 500 })),
		),
	);

	it.effect("x-amz-meta-__proto__ becomes an own property and pollutes nothing", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const head = yield* s3.head("k");
					assert.isTrue(Object.hasOwn(head.metadata, "__proto__"));
					assert.strictEqual(Object.getPrototypeOf(head.metadata), Object.prototype);
					assert.isUndefined(({} as Record<string, unknown>).polluted);
				}),
			fakeS3(
				() =>
					new Response(null, {
						status: 200,
						headers: { etag: '"e"', "content-length": "1", "x-amz-meta-__proto__": "polluted" },
					}),
			),
		),
	);
});

describe("S3Client.delete", () => {
	it.effect("removes the object, and deleting a missing one succeeds", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* s3.put("k", "v");
				yield* s3.delete("k");
				assert.isFalse(store.objects.has("k"));
				yield* s3.delete("k");
				assert.strictEqual(store.seen[1]?.method, "DELETE");
				assert.isTrue(store.seen.every((request) => request.signatureValid));
			}),
		),
	);

	it.effect("a store that answers 404 NoSuchKey to a delete still succeeds", () =>
		withStore(
			(s3) => s3.delete("k"),
			fakeS3(() => xmlError(404, "NoSuchKey", "The specified key does not exist.")),
		),
	);

	it.effect("404 NoSuchBucket is S3RequestFailed", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.delete("k"));
					if (error._tag !== "S3RequestFailed") return assert.fail(error.message);
					assert.strictEqual(error.code, "NoSuchBucket");
				}),
			fakeS3(() => xmlError(404, "NoSuchBucket", "The specified bucket does not exist")),
		),
	);
});

describe("S3Client.list and listAll", () => {
	const seed = (s3: S3ClientShape, keys: ReadonlyArray<string>) =>
		Effect.forEach(keys, (key) => s3.put(key, key), { discard: true });

	it.effect("pages over two pages with the continuation token", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* seed(s3, ["day/a", "day/b", "day/c", "other/x"]);
				const first = yield* s3.list({ prefix: "day/", maxKeys: 2 });
				assert.deepStrictEqual(
					first.keys.map((entry) => entry.key),
					["day/a", "day/b"],
				);
				assert.isTrue(first.isTruncated);
				assert.isTrue(Option.isSome(first.nextContinuationToken));
				const second = yield* s3.list({
					prefix: "day/",
					maxKeys: 2,
					continuationToken: Option.getOrThrow(first.nextContinuationToken),
				});
				assert.deepStrictEqual(
					second.keys.map((entry) => entry.key),
					["day/c"],
				);
				assert.isFalse(second.isTruncated);
				const listing = store.seen.slice(-2);
				assert.strictEqual(listing[0]?.url.pathname, "/archive");
				assert.strictEqual(listing[0]?.url.searchParams.get("list-type"), "2");
				assert.isNull(listing[0]?.url.searchParams.get("continuation-token") ?? null);
				assert.strictEqual(
					listing[1]?.url.searchParams.get("continuation-token"),
					Option.getOrThrow(first.nextContinuationToken),
				);
				assert.isTrue(store.seen.every((request) => request.signatureValid));
			}),
		),
	);

	it.effect("a delimiter rolls keys up into commonPrefixes", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				yield* seed(s3, ["root.txt", "photos/a.jpg", "photos/b.jpg", "videos/c.mp4"]);
				const page = yield* s3.list({ delimiter: "/" });
				assert.deepStrictEqual(
					page.keys.map((entry) => entry.key),
					["root.txt"],
				);
				assert.deepStrictEqual(page.commonPrefixes, ["photos/", "videos/"]);
			}),
		),
	);

	it.effect("listAll follows every token and sends startAfter on the first page only", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* seed(s3, ["p/1", "p/2", "p/3", "p/4", "p/5"]);
				const before = store.seen.length;
				const keys = yield* Stream.runCollect(s3.listAll({ prefix: "p/", startAfter: "p/1", maxKeys: 2 }));
				assert.deepStrictEqual(
					keys.map((entry) => entry.key),
					["p/2", "p/3", "p/4", "p/5"],
				);
				const pages = store.seen.slice(before);
				assert.lengthOf(pages, 2);
				assert.strictEqual(pages[0]?.url.searchParams.get("start-after"), "p/1");
				assert.isNull(pages[1]?.url.searchParams.get("start-after") ?? null);
				assert.isNotNull(pages[1]?.url.searchParams.get("continuation-token") ?? null);
			}),
		),
	);

	it.effect("one listAll stream runs twice with the same pages: the seen tokens belong to a run", () =>
		withStore((s3) =>
			Effect.gen(function* () {
				yield* seed(s3, ["p/1", "p/2", "p/3"]);
				const stream = s3.listAll({ prefix: "p/", maxKeys: 1 });
				const first = yield* Stream.runCollect(stream);
				const second = yield* Stream.runCollect(stream);
				assert.deepStrictEqual(
					second.map((entry) => entry.key),
					first.map((entry) => entry.key),
				);
				assert.lengthOf(first, 3);
			}),
		),
	);

	it.effect("listAll fails when a store hands back a token it already gave", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(Stream.runCollect(s3.listAll()));
					if (error._tag !== "S3MalformedResponse") return assert.fail(error.message);
					assert.strictEqual(error.expected, "a new <NextContinuationToken>");
				}),
			fakeS3(
				() =>
					new Response(
						"<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken><Contents><Key>a</Key><Size>1</Size><LastModified>2026-11-06T12:00:00Z</LastModified></Contents></ListBucketResult>",
					),
			),
		),
	);

	it.effect("listAll fails on a truncated page without a token instead of stopping early", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(Stream.runCollect(s3.listAll()));
					assert.strictEqual(error._tag, "S3MalformedResponse");
				}),
			fakeS3(
				() =>
					new Response(
						"<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a</Key><Size>1</Size><LastModified>2026-11-06T12:00:00Z</LastModified></Contents></ListBucketResult>",
					),
			),
		),
	);

	it.effect("a non-200 listing with an error document is S3RequestFailed", () =>
		withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.list({ prefix: "p/" }));
					if (error._tag !== "S3RequestFailed") return assert.fail(error.message);
					assert.strictEqual(error.code, "AccessDenied");
					assert.strictEqual(error.key, "p/");
				}),
			fakeS3(() => xmlError(403, "AccessDenied", "Access Denied")),
		),
	);
});

describe("input is refused before anything is signed or sent", () => {
	const cases: ReadonlyArray<
		readonly [string, (s3: S3ClientShape) => Effect.Effect<unknown, { readonly _tag: string }>, string, string]
	> = [
		["an empty key", (s3) => s3.put("", "v"), "empty-key", "key"],
		["a '..' segment", (s3) => s3.get("a/../b"), "dot-segment", "key"],
		["a '.' segment", (s3) => s3.head("./b"), "dot-segment", "key"],
		["a key over 1024 bytes", (s3) => s3.delete("é".repeat(513)), "key-too-long", "key"],
		[
			"a metadata name with a space",
			(s3) => s3.put("k", "v", { metadata: { "bad name": "x" } }),
			"metadata-name",
			"metadata.bad name",
		],
		[
			"two metadata names that differ only in case",
			(s3) => s3.put("k", "v", { metadata: { A: "1", a: "2" } }),
			"metadata-duplicate",
			"metadata.a",
		],
		[
			"a metadata value with a line break",
			(s3) => s3.put("k", "v", { metadata: { a: "x\r\ny: z" } }),
			"header-value",
			"x-amz-meta-a",
		],
		[
			"a non-ASCII metadata value",
			(s3) => s3.put("k", "v", { metadata: { a: "café" } }),
			"header-value",
			"x-amz-meta-a",
		],
		["a range with a line break", (s3) => s3.get("k", { range: "bytes=0-1\n" }), "header-value", "range"],
		["maxKeys 0", (s3) => s3.list({ maxKeys: 0 }), "max-keys", "maxKeys"],
		["maxKeys 1001", (s3) => s3.list({ maxKeys: 1001 }), "max-keys", "maxKeys"],
		["maxKeys 1.5", (s3) => s3.list({ maxKeys: 1.5 }), "max-keys", "maxKeys"],
		["maxKeys NaN", (s3) => s3.list({ maxKeys: Number.NaN }), "max-keys", "maxKeys"],
		["listAll maxKeys 0", (s3) => Stream.runCollect(s3.listAll({ maxKeys: 0 })), "max-keys", "maxKeys"],
		// A lone UTF-16 surrogate makes `encodeURIComponent` throw inside signing,
		// which would die as a defect; it must be refused typed, with nothing sent.
		["a put key with a lone surrogate", (s3) => s3.put("\ud800", "v"), "malformed-unicode", "key"],
		["a get key with a lone surrogate", (s3) => s3.get("a/\udc00"), "malformed-unicode", "key"],
		["a head key with a lone surrogate", (s3) => s3.head("\ud83d"), "malformed-unicode", "key"],
		["a delete key with a lone surrogate", (s3) => s3.delete("x\ud800y"), "malformed-unicode", "key"],
		[
			"a lone surrogate in a key over 1024 bytes is malformed first",
			(s3) => s3.put(`\ud800${"a".repeat(1100)}`, "v"),
			"malformed-unicode",
			"key",
		],
		["a list prefix with a lone surrogate", (s3) => s3.list({ prefix: "\ud800" }), "malformed-unicode", "prefix"],
		[
			"a list delimiter with a lone surrogate",
			(s3) => s3.list({ delimiter: "\udfff" }),
			"malformed-unicode",
			"delimiter",
		],
		[
			"a list startAfter with a lone surrogate",
			(s3) => s3.list({ startAfter: "\ud800" }),
			"malformed-unicode",
			"startAfter",
		],
		[
			"a list continuationToken with a lone surrogate",
			(s3) => s3.list({ continuationToken: "\ud800" }),
			"malformed-unicode",
			"continuationToken",
		],
		[
			"a listAll prefix with a lone surrogate",
			(s3) => Stream.runCollect(s3.listAll({ prefix: "\ud800" })),
			"malformed-unicode",
			"prefix",
		],
		// `TextEncoder` would replace the half with U+FFFD and the store would hold
		// bytes the caller never wrote, under a payload hash that agrees with them.
		["a put string body with a lone surrogate", (s3) => s3.put("k", "a\ud800b"), "malformed-unicode", "body"],
		[
			"a listAll startAfter with a lone surrogate",
			(s3) => Stream.runCollect(s3.listAll({ startAfter: "\udc00" })),
			"malformed-unicode",
			"startAfter",
		],
	];
	for (const [name, run, reason, field] of cases) {
		it.effect(name, () =>
			withStore((s3, store) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(run(s3));
					if (error._tag !== "S3InvalidRequest") return assert.fail(`raised ${error._tag}`);
					const invalid = error as unknown as { readonly reason: string; readonly field: string };
					assert.strictEqual(invalid.reason, reason);
					assert.strictEqual(invalid.field, field);
					assert.lengthOf(store.seen, 0);
				}),
			),
		);
	}

	it.effect("the boundary values are accepted (positive control)", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				yield* s3.put("a".repeat(1024), "v");
				yield* s3.list({ maxKeys: 1 });
				yield* s3.list({ maxKeys: 1000 });
				yield* s3.put("k", "v", { metadata: { "x.y_z-1": "printable ~ ascii\tand tab" } });
				assert.lengthOf(store.seen, 4);
			}),
		),
	);

	it.effect("a well-formed astral key round-trips through put, get, head, list and delete (positive control)", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				// A surrogate PAIR is well formed: only a lone half is refused.
				const key = "📦/🎉.json";
				yield* s3.put(key, "party");
				assert.strictEqual((yield* s3.get(key)).text, "party");
				assert.strictEqual((yield* s3.head(key)).key, key);
				const page = yield* s3.list({ prefix: "📦/", delimiter: "🎉", startAfter: "📦" });
				assert.deepStrictEqual(page.commonPrefixes, ["📦/🎉"]);
				yield* s3.delete(key);
				assert.isFalse(store.objects.has(key));
				// A string body with a surrogate pair is well formed and stored as written.
				yield* s3.put("emoji", "📦🎉");
				assert.strictEqual(new TextDecoder().decode(store.objects.get("emoji")?.body), "📦🎉");
				// Bytes are sent as given: U+FFFD's own encoding is not refused.
				yield* s3.put("replacement", new Uint8Array([0xef, 0xbf, 0xbd]));
				assert.deepStrictEqual([...(store.objects.get("replacement")?.body ?? [])], [0xef, 0xbf, 0xbd]);
				assert.lengthOf(store.seen, 7);
				assert.isTrue(store.seen.every((request) => request.signatureValid));
			}),
		),
	);

	it("the precondition and conflict errors only ever name put", () => {
		// Only `put` sends a write condition, so neither error can be minted for another operation.
		for (const operation of ["get", "head", "delete", "list"] as const) {
			assert.throws(() =>
				S3PreconditionFailed.make({ operation: operation as unknown as "put", bucket: "b", key: "k" }),
			);
			assert.throws(() =>
				S3ConditionalConflict.make({ operation: operation as unknown as "put", bucket: "b", key: "k" }),
			);
		}
		assert.strictEqual(S3PreconditionFailed.make({ operation: "put", bucket: "b", key: "k" }).operation, "put");
		assert.strictEqual(S3ConditionalConflict.make({ operation: "put", bucket: "b", key: "k" }).operation, "put");
	});

	it("every refusal reason names its own rule in the message", () => {
		const rules = {
			"empty-key": "the key is empty",
			"key-too-long": "longer than 1024 UTF-8 bytes",
			"dot-segment": "which a URL collapses",
			"malformed-unicode": "lone UTF-16 surrogate",
			"metadata-name": "not an HTTP token",
			"metadata-duplicate": "differ only in case",
			"header-value": "outside printable US-ASCII",
			"max-keys": "maxKeys must be an integer from 1 to 1000",
		} as const satisfies Record<S3InvalidRequestReason, string>;
		for (const [reason, text] of Object.entries(rules) as ReadonlyArray<[S3InvalidRequestReason, string]>) {
			const error = new S3InvalidRequest({ operation: "put", bucket: "b", key: "k", reason, field: "f" });
			assert.include(error.message, text, reason);
		}
	});
});

describe("addressing and signing", () => {
	it.effect("a key with reserved and non-ASCII characters reaches the store exactly as signed", () =>
		withStore((s3, store) =>
			Effect.gen(function* () {
				const key = "dir with space/it's (a) *star*!/café+&=?#.txt";
				yield* s3.put(key, "v");
				const object = yield* s3.get(key);
				assert.strictEqual(object.text, "v");
				assert.isTrue(store.objects.has(key));
				assert.isTrue(store.seen.every((request) => request.signatureValid));
				assert.include(store.seen[0]?.url.pathname ?? "", "it%27s%20%28a%29%20%2Astar%2A%21");
			}),
		),
	);

	it.effect("virtual-host style puts the bucket in the host", () => {
		const { endpoint: _, ...aws } = r2Options({ region: "us-east-1", forcePathStyle: false });
		const store = fakeS3(() => undefined, aws);
		return withStore(
			(s3) =>
				Effect.gen(function* () {
					yield* s3.put("a/b.txt", "v");
					yield* s3.list();
					assert.strictEqual(store.seen[0]?.url.href, "https://archive.s3.us-east-1.amazonaws.com/a/b.txt");
					assert.strictEqual(store.seen[1]?.url.pathname, "/");
					assert.match(store.seen[0]?.headers.authorization ?? "", /\/us-east-1\/s3\/aws4_request/);
					assert.isTrue(store.seen.every((request) => request.signatureValid));
				}),
			store,
			aws,
		);
	});

	it.effect("AWS without an endpoint defaults to virtual-host style", () => {
		const { endpoint: _, ...aws } = r2Options({ region: "eu-west-1" });
		const store = fakeS3(() => undefined, { ...aws, forcePathStyle: false });
		return withStore(
			(s3) =>
				Effect.gen(function* () {
					yield* s3.put("k", "v");
					assert.strictEqual(store.seen[0]?.url.host, "archive.s3.eu-west-1.amazonaws.com");
				}),
			store,
			aws,
		);
	});

	it.effect("an endpoint path is kept in front of the bucket", () => {
		const options = r2Options({ endpoint: "http://localhost:9000/storage/" });
		const store = fakeS3(() => undefined, options);
		return withStore(
			(s3) =>
				Effect.gen(function* () {
					yield* s3.put("k", "v").pipe(Effect.ignore);
					assert.strictEqual(store.seen[0]?.url.href, "http://localhost:9000/storage/archive/k");
					assert.isTrue(store.seen[0]?.signatureValid);
				}),
			store,
			options,
		);
	});

	it.effect("a session token is sent and signed", () => {
		const options = r2Options({
			credentials: {
				accessKeyId: Redacted.make(ACCESS_KEY_ID),
				secretAccessKey: Redacted.make(SECRET_ACCESS_KEY),
				sessionToken: Redacted.make(SESSION_TOKEN),
			},
		});
		const store = fakeS3(() => undefined, options);
		return withStore(
			(s3) =>
				Effect.gen(function* () {
					yield* s3.put("k", "v");
					assert.strictEqual(store.seen[0]?.headers["x-amz-security-token"], SESSION_TOKEN);
					assert.include(store.seen[0]?.headers.authorization ?? "", "x-amz-security-token");
					assert.isTrue(store.seen[0]?.signatureValid);
				}),
			store,
			options,
		);
	});

	it.effect("a client signing with the wrong secret is refused (the signature check discriminates)", () => {
		const store = fakeS3();
		const wrong = r2Options({
			credentials: { accessKeyId: Redacted.make(ACCESS_KEY_ID), secretAccessKey: Redacted.make("not the secret") },
		});
		return withStore(
			(s3) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(s3.put("k", "v"));
					if (error._tag !== "S3RequestFailed") return assert.fail(error.message);
					assert.strictEqual(error.code, "SignatureDoesNotMatch");
					assert.isFalse(store.seen[0]?.signatureValid);
				}),
			store,
			wrong,
		);
	});
});

describe("transport failures", () => {
	const failing = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) =>
			Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, cause: new TypeError("fetch failed") }),
				}),
			),
		),
	);
	const layer = S3Client.layer(
		r2Options({
			credentials: {
				accessKeyId: Redacted.make(ACCESS_KEY_ID),
				secretAccessKey: Redacted.make(SECRET_ACCESS_KEY),
				sessionToken: Redacted.make(SESSION_TOKEN),
			},
		}),
	).pipe(Layer.provide(Layer.mergeAll(failing, CryptoLive)));

	/** Every string reachable from `root` through own properties. */
	const strings = (root: unknown): Array<string> => {
		const out: Array<string> = [];
		const seen = new Set<unknown>();
		const walk = (value: unknown, depth: number): void => {
			if (depth > 12) return;
			if (typeof value === "string") {
				out.push(value);
				return;
			}
			if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
			seen.add(value);
			for (const key of Reflect.ownKeys(value)) {
				try {
					walk((value as Record<PropertyKey, unknown>)[key], depth + 1);
				} catch {}
			}
		};
		walk(root, 0);
		return out;
	};

	it.effect("a failed request is S3TransportError whose cause holds no credential", () =>
		Effect.gen(function* () {
			const s3 = yield* S3Client;
			const error = yield* Effect.flip(s3.put("k", "v"));
			if (error._tag !== "S3TransportError") return assert.fail(error.message);
			const reachable = strings(error);
			// Positive control: the walk does see into the cause.
			assert.isTrue(reachable.some((text) => text.includes("account.r2.example.com")));
			for (const secret of [SESSION_TOKEN, "Signature=", SECRET_ACCESS_KEY]) {
				assert.isFalse(
					reachable.some((text) => text.includes(secret)),
					`found ${secret}`,
				);
			}
		}).pipe(Effect.provide(layer)),
	);

	it.effect("the same walk finds the token on core's unredacted error (control)", () =>
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const raw = yield* Effect.flip(
				http.get("https://account.r2.example.com/archive/k", { headers: { "x-amz-security-token": SESSION_TOKEN } }),
			);
			assert.isTrue(strings(raw).some((text) => text.includes(SESSION_TOKEN)));
		}).pipe(Effect.provide(failing)),
	);
});

describe("wiring mistakes die when the client is made", () => {
	const bad: ReadonlyArray<readonly [string, ReturnType<typeof r2Options>]> = [
		["an empty bucket", r2Options({ bucket: "" })],
		["a bucket with a slash", r2Options({ bucket: "a/b" })],
		["an empty region", r2Options({ region: " " })],
		["an endpoint that is not a URL", r2Options({ endpoint: "not a url" })],
		["an ftp endpoint", r2Options({ endpoint: "ftp://example.com" })],
		["an endpoint with a query", r2Options({ endpoint: "https://example.com/?x=1" })],
		["an endpoint with credentials", r2Options({ endpoint: "https://user:pass@example.com" })],
		["a virtual-host bucket a host label cannot carry", r2Options({ bucket: "Upper_Case", forcePathStyle: false })],
	];
	for (const [name, options] of bad) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Effect.provide(S3Client, fakeS3().layer(options)));
				if (Exit.isSuccess(exit)) return assert.fail("the client was made");
				assert.isTrue(Cause.hasDies(exit.cause));
				assert.isFalse(Cause.hasFails(exit.cause));
			}),
		);
	}

	it.effect("valid options make a client (positive control)", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Effect.provide(S3Client, fakeS3().layer(r2Options({ bucket: "Mixed_Case.ok" }))));
			assert.isTrue(Exit.isSuccess(exit));
		}),
	);
});
