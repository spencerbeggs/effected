import { createHash } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Crypto, DateTime, Effect, Redacted } from "effect";
import type { SigV4Credentials, SigV4Request } from "../src/SigV4.js";
import { SigV4 } from "../src/SigV4.js";
import { SigV4PathError } from "../src/SigV4PathError.js";

// The oracle is AWS's own published examples, never this implementation's
// output. "Authenticating Requests: Using the Authorization Header (AWS
// Signature Version 4)" for Amazon S3 signs with this key pair, bucket and
// instant. Its secret has "/bPx"; the IAM key-derivation example below uses
// a different documented secret with "+bPx".
const s3Example: SigV4Credentials = {
	accessKeyId: "AKIAIOSFODNN7EXAMPLE",
	secretAccessKey: Redacted.make("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
	region: "us-east-1",
	service: "s3",
};
const MAY_24_2013 = new Date("2013-05-24T00:00:00Z");
const host = "examplebucket.s3.amazonaws.com";

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const signatureOf = (headers: Record<string, string>): string => headers.authorization?.split("Signature=")[1] ?? "";

const getObject: SigV4Request = {
	method: "GET",
	host,
	path: "/test.txt",
	headers: { range: "bytes=0-9" },
	payloadHash: SigV4.EMPTY_PAYLOAD_HASH,
	now: MAY_24_2013,
};

describe("SigV4.encodePath", () => {
	it("escapes the characters encodeURIComponent leaves alone", () => {
		// `!'()*` are unreserved to encodeURIComponent and reserved to AWS.
		assert.strictEqual(SigV4.encodePath("a!b'c(d)e*f"), "a%21b%27c%28d%29e%2Af");
		assert.strictEqual(SigV4.encodePath("plain-file_name.tar~gz"), "plain-file_name.tar~gz");
	});

	it("encodes each segment and keeps the slashes", () => {
		assert.strictEqual(SigV4.encodePath("webhooks/a b/c(1)*.json"), "webhooks/a%20b/c%281%29%2A.json");
		assert.strictEqual(SigV4.encodePath("test$file.text"), "test%24file.text");
		assert.strictEqual(SigV4.encodePath("dir/"), "dir/");
	});
});

describe("SigV4.signingKey", () => {
	it.effect("reproduces AWS's documented signing-key derivation", () =>
		Effect.gen(function* () {
			// AWS General Reference, "Examples of how to derive a signing key for
			// Signature Version 4": IAM, us-east-1, 20120215.
			const key = yield* SigV4.signingKey(
				Redacted.make("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
				"20120215",
				"us-east-1",
				"iam",
			);
			assert.strictEqual(
				Buffer.from(key).toString("hex"),
				"f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d",
			);
		}),
	);
});

layer(NodeCrypto.layer)("SigV4 (AWS S3 documented examples)", (it) => {
	it.effect("reproduces the canonical request for GET Object", () =>
		Effect.gen(function* () {
			const canonical = yield* SigV4.canonicalize(getObject, s3Example);
			assert.strictEqual(
				canonical.canonicalRequest,
				[
					"GET",
					"/test.txt",
					"",
					"host:examplebucket.s3.amazonaws.com",
					"range:bytes=0-9",
					"x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
					"x-amz-date:20130524T000000Z",
					"",
					"host;range;x-amz-content-sha256;x-amz-date",
					"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				].join("\n"),
			);
			// AWS documents this exact hash of the GET Object canonical request.
			assert.strictEqual(
				sha256Hex(canonical.canonicalRequest),
				"7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
			);
			assert.strictEqual(canonical.amzDate, "20130524T000000Z");
			assert.strictEqual(canonical.dateStamp, "20130524");
		}),
	);

	it.effect("signs GET Object with a Range header", () =>
		Effect.gen(function* () {
			const { headers } = yield* SigV4.sign(getObject, s3Example);
			assert.strictEqual(
				headers.authorization,
				"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
			);
			assert.strictEqual(headers["x-amz-date"], "20130524T000000Z");
			assert.strictEqual(headers.host, host);
			assert.strictEqual(headers.range, "bytes=0-9");
		}),
	);

	it.effect("signs PUT Object, hashing the body through Crypto and encoding the key", () =>
		Effect.gen(function* () {
			const { headers } = yield* SigV4.sign(
				{
					method: "PUT",
					host,
					path: "test$file.text",
					headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
					body: "Welcome to Amazon S3.",
					now: MAY_24_2013,
				},
				s3Example,
			);
			// No payloadHash given, so the body was hashed: AWS's documented value.
			assert.strictEqual(
				headers["x-amz-content-sha256"],
				"44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
			);
			assert.strictEqual(signatureOf(headers), "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
			assert.strictEqual(headers.date, "Fri, 24 May 2013 00:00:00 GMT", "header names are lower-cased");
		}),
	);

	it.effect("signs GET Bucket (list objects) with a sorted query string", () =>
		Effect.gen(function* () {
			const request: SigV4Request = {
				method: "GET",
				host,
				path: "/",
				query: { prefix: "J", "max-keys": "2" },
				payloadHash: SigV4.EMPTY_PAYLOAD_HASH,
				now: MAY_24_2013,
			};
			const canonical = yield* SigV4.canonicalize(request, s3Example);
			assert.strictEqual(canonical.canonicalRequest.split("\n")[2], "max-keys=2&prefix=J");
			const { headers } = yield* SigV4.sign(request, s3Example);
			assert.strictEqual(signatureOf(headers), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
		}),
	);

	it.effect("signs the same instant identically given a Date or a DateTime", () =>
		Effect.gen(function* () {
			const fromDate = yield* SigV4.sign(getObject, s3Example);
			const fromDateTime = yield* SigV4.sign({ ...getObject, now: DateTime.makeUnsafe(MAY_24_2013) }, s3Example);
			assert.strictEqual(fromDateTime.headers.authorization, fromDate.headers.authorization);
		}),
	);

	it.effect("changes the signature when any signed header changes", () =>
		Effect.gen(function* () {
			const nine = yield* SigV4.sign(getObject, s3Example);
			const eight = yield* SigV4.sign({ ...getObject, headers: { range: "bytes=0-8" } }, s3Example);
			assert.notStrictEqual(signatureOf(nine.headers), signatureOf(eight.headers));
		}),
	);
});

layer(NodeCrypto.layer)("SigV4 merged behaviour", (it) => {
	const credentials: SigV4Credentials = {
		accessKeyId: "AK",
		secretAccessKey: Redacted.make("SK"),
		region: "us-east-1",
		service: "s3",
	};
	const base: SigV4Request = {
		method: "PUT",
		host: "example.test",
		path: "bucket/key",
		body: new Uint8Array([1, 2, 3]),
		now: new Date("2024-01-01T00:00:00.000Z"),
	};

	it.effect("signs every header it returns, including the session token", () =>
		Effect.gen(function* () {
			const { headers } = yield* SigV4.sign(base, { ...credentials, sessionToken: Redacted.make("ST") });
			const signedHeaders = /SignedHeaders=([^,]+)/.exec(headers.authorization ?? "")?.[1]?.split(";") ?? [];
			const sent = Object.keys(headers)
				.filter((name) => name !== "authorization")
				.sort();
			assert.deepStrictEqual([...signedHeaders].sort(), sent, "every header sent must be a header signed");
			assert.include(signedHeaders, "x-amz-security-token", "a session token must be signed, not merely sent");
			assert.strictEqual(headers["x-amz-security-token"], "ST");
		}),
	);

	it.effect("adds no session-token header without a session token", () =>
		Effect.gen(function* () {
			const { headers } = yield* SigV4.sign(base, credentials);
			assert.isUndefined(headers["x-amz-security-token"]);
			assert.notInclude(headers.authorization ?? "", "x-amz-security-token");
		}),
	);

	it.effect("sorts canonical headers regardless of insertion order or case", () =>
		Effect.gen(function* () {
			const first = yield* SigV4.canonicalize({ ...base, headers: { "Z-Last": "1", "a-first": "2" } }, credentials);
			const second = yield* SigV4.canonicalize({ ...base, headers: { "a-first": "2", "z-last": "1" } }, credentials);
			assert.strictEqual(first.canonicalRequest, second.canonicalRequest);
		}),
	);

	it.effect("encodes the query and sorts it by name, then by value", () =>
		Effect.gen(function* () {
			const canonical = yield* SigV4.canonicalize(
				{
					...base,
					query: [
						["b", "x y"],
						["a", "2"],
						["a", "1"],
						["c*", "it's"],
					],
				},
				credentials,
			);
			assert.strictEqual(canonical.canonicalRequest.split("\n")[2], "a=1&a=2&b=x%20y&c%2A=it%27s");
		}),
	);

	it.effect("signs a caller-supplied payload hash instead of hashing the body", () =>
		Effect.gen(function* () {
			const canonical = yield* SigV4.canonicalize({ ...base, payloadHash: SigV4.UNSIGNED_PAYLOAD }, credentials);
			assert.strictEqual(canonical.payloadHash, "UNSIGNED-PAYLOAD");
			assert.strictEqual(canonical.headers["x-amz-content-sha256"], "UNSIGNED-PAYLOAD");
			assert.isTrue(canonical.canonicalRequest.endsWith("\nUNSIGNED-PAYLOAD"));
		}),
	);

	it.effect("hashes an omitted body as empty, matching EMPTY_PAYLOAD_HASH", () =>
		Effect.gen(function* () {
			const { body: _body, ...bodiless } = base;
			const canonical = yield* SigV4.canonicalize(bodiless, credentials);
			assert.strictEqual(canonical.payloadHash, SigV4.EMPTY_PAYLOAD_HASH);
			assert.strictEqual(SigV4.EMPTY_PAYLOAD_HASH, sha256Hex(""));
		}),
	);

	it.effect("encodes the path per segment and keeps empty segments", () =>
		Effect.gen(function* () {
			const pathOf = (path: string) =>
				SigV4.canonicalize({ ...base, path }, credentials).pipe(
					Effect.map((canonical) => canonical.canonicalRequest.split("\n")[1]),
				);
			assert.strictEqual(yield* pathOf("bucket/a b(1).txt"), "/bucket/a%20b%281%29.txt");
			assert.strictEqual(yield* pathOf("/bucket/key"), "/bucket/key");
			assert.strictEqual(yield* pathOf("bucket/dir/"), "/bucket/dir/");
			assert.strictEqual(yield* pathOf(""), "/");
		}),
	);

	it.effect("hashes an empty body without a digest call, as EMPTY_PAYLOAD_HASH", () =>
		Effect.gen(function* () {
			const seen: Array<number> = [];
			const counting = Crypto.make({
				randomBytes: (size) => new Uint8Array(size),
				digest: (_algorithm, data) =>
					Effect.sync(() => {
						seen.push(data.byteLength);
						return new Uint8Array(32);
					}),
			});
			const payloadHashOf = (body: Uint8Array | string) =>
				SigV4.canonicalize({ ...base, body }, credentials).pipe(
					Effect.provideService(Crypto.Crypto, counting),
					Effect.map((canonical) => canonical.payloadHash),
				);
			for (const empty of [new Uint8Array(0), ""]) {
				assert.strictEqual(yield* payloadHashOf(empty), SigV4.EMPTY_PAYLOAD_HASH);
			}
			assert.deepStrictEqual(seen, [], "an empty body must not reach Crypto.digest");
			// The control: the same fake does see a non-empty body.
			assert.strictEqual(yield* payloadHashOf(new Uint8Array([1])), "0".repeat(64));
			assert.deepStrictEqual(seen, [1]);
		}),
	);

	it.effect("takes every digest from the Crypto service in R", () =>
		Effect.gen(function* () {
			const zero = Crypto.make({
				randomBytes: (size) => new Uint8Array(size),
				digest: () => Effect.succeed(new Uint8Array(32)),
			});
			const canonical = yield* SigV4.canonicalize(base, credentials).pipe(Effect.provideService(Crypto.Crypto, zero));
			assert.strictEqual(canonical.payloadHash, "0".repeat(64));
		}),
	);
});

layer(NodeCrypto.layer)("SigV4.sign's request target", (it) => {
	const credentials: SigV4Credentials = {
		accessKeyId: "AK",
		secretAccessKey: Redacted.make("SK"),
		region: "us-east-1",
		service: "s3",
	};
	const base: SigV4Request = {
		method: "GET",
		host: "example.test",
		path: "bucket/key",
		payloadHash: SigV4.EMPTY_PAYLOAD_HASH,
		now: new Date("2024-01-01T00:00:00.000Z"),
	};

	/** The path and query lines of the canonical request: what the signature actually covers. */
	const coveredTarget = (request: SigV4Request) =>
		Effect.map(SigV4.canonicalize(request, credentials), (canonical) => {
			const [, path, query] = canonical.canonicalRequest.split("\n");
			return { path, query };
		});

	it.effect("returns the encoded path and canonical query the signature covers", () =>
		Effect.gen(function* () {
			const request: SigV4Request = {
				...base,
				path: "/bucket/it's (a)*!/.../.a/ü",
				query: [
					["b", "two words"],
					["a", "x!y"],
				],
			};
			const signed = yield* SigV4.sign(request, credentials);
			// Pinned literally, then against the canonical request, so neither
			// side can drift from what was signed.
			assert.strictEqual(signed.path, "/bucket/it%27s%20%28a%29%2A%21/.../.a/%C3%BC");
			assert.strictEqual(signed.query, "a=x%21y&b=two%20words");
			assert.deepStrictEqual(yield* coveredTarget(request), { path: signed.path, query: signed.query });
		}),
	);

	it.effect("returns an empty query, with no ?, when there is none", () =>
		Effect.gen(function* () {
			const signed = yield* SigV4.sign(base, credentials);
			assert.strictEqual(signed.path, "/bucket/key");
			assert.strictEqual(signed.query, "");
		}),
	);

	it.effect("refuses a . or .. segment before signing, in canonicalize and sign alike", () =>
		Effect.gen(function* () {
			// The control: a URL really does collapse them, so signing one would send another path.
			assert.strictEqual(new URL("https://h.example/bucket/a/../b/./c").pathname, "/bucket/b/c");
			for (const path of ["a/../b", "/bucket/./key", "..", ".", "bucket/key/..", "/./"]) {
				const fromSign = yield* Effect.flip(SigV4.sign({ ...base, path }, credentials));
				const fromCanonicalize = yield* Effect.flip(SigV4.canonicalize({ ...base, path }, credentials));
				const segment = path.split("/").find((part) => part === "." || part === "..");
				for (const error of [fromSign, fromCanonicalize]) {
					assert.instanceOf(error, SigV4PathError, path);
					assert.strictEqual(error._tag, "SigV4PathError", path);
					if (error._tag === "SigV4PathError") {
						assert.strictEqual(error.path, path);
						assert.strictEqual(error.segment, segment, path);
						assert.include(error.message, `"${path}"`);
						assert.include(error.message, `"${segment}" segment`);
					}
				}
			}
		}),
	);

	it.effect("signs a segment that merely contains dots, or a literal %2e, which no URL collapses", () =>
		Effect.gen(function* () {
			for (const [path, encoded] of [
				["a/.../b", "/a/.../b"],
				["a/.a/b.", "/a/.a/b."],
				["a/%2e%2E/b", "/a/%252e%252E/b"],
				["a/ ./b", "/a/%20./b"],
			] as const) {
				const signed = yield* SigV4.sign({ ...base, path }, credentials);
				assert.strictEqual(signed.path, encoded);
				assert.strictEqual(new URL(`https://h.example${signed.path}`).pathname, signed.path, path);
			}
		}),
	);
});
