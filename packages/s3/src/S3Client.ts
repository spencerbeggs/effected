import type { SigV4Credentials } from "@effected/crypto";
import { HttpRedaction, SigV4 } from "@effected/crypto";
import { Context, DateTime, Effect, Layer, Option, Redacted, Result, Stream } from "effect";
import type { Digest, Mac } from "effect/crypto";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { S3Address } from "./internal/address.js";
import {
	bucketPath,
	isHeaderValue,
	isMaxKeys,
	isToken,
	isWellFormed,
	keyProblem,
	objectPath,
	resolveAddress,
} from "./internal/address.js";
import type { ErrorDocument, Mismatch } from "./internal/documents.js";
import { readErrorDocument, readListPage } from "./internal/documents.js";
import { readHead, readPutResult } from "./internal/headers.js";
import { decodeDocument } from "./internal/xml.js";
import type {
	S3DeleteError,
	S3GetError,
	S3HeadError,
	S3InvalidRequestReason,
	S3ListError,
	S3Operation,
	S3PutError,
} from "./S3Error.js";
import {
	S3ConditionalConflict,
	S3InvalidRequest,
	S3MalformedResponse,
	S3NotFound,
	S3NotModified,
	S3PreconditionFailed,
	S3RequestFailed,
	S3TransportError,
} from "./S3Error.js";
import type { S3ListPage, S3ObjectSummary } from "./S3ListPage.js";
import type { S3ObjectHead, S3PutResult } from "./S3Object.js";
import { S3Object } from "./S3Object.js";

/**
 * The key pair, and optional session token, the client signs with.
 *
 * @remarks
 * All three are `Redacted` and read only where a request is signed. The access
 * key id is not a secret in the cryptographic sense (it appears in every
 * `authorization` header), but it names an account, so it is kept out of logs too.
 *
 * @public
 */
export interface S3Credentials {
	/** The access key id. */
	readonly accessKeyId: Redacted.Redacted<string>;
	/** The secret access key. */
	readonly secretAccessKey: Redacted.Redacted<string>;
	/** A temporary session token, sent as `x-amz-security-token`. */
	readonly sessionToken?: Redacted.Redacted<string>;
}

/**
 * How to reach one bucket.
 *
 * @public
 */
export interface S3ClientOptions {
	/** The bucket every operation addresses. */
	readonly bucket: string;
	/** The signing region: the bucket's region on AWS, `auto` for Cloudflare R2, `us-east-1` for most MinIO setups. */
	readonly region: string;
	/**
	 * A custom endpoint, such as `https://<account>.r2.cloudflarestorage.com` or
	 * `http://localhost:9000`. Omitted, the client targets AWS at
	 * `https://s3.<region>.amazonaws.com`. An endpoint path, if any, is kept in
	 * front of the bucket.
	 */
	readonly endpoint?: string;
	/** The credentials to sign with. */
	readonly credentials: S3Credentials;
	/**
	 * Address the bucket as the first path segment (`<endpoint>/<bucket>/<key>`)
	 * rather than as a host label (`<bucket>.<host>/<key>`).
	 *
	 * @defaultValue `true` when `endpoint` is set (R2, MinIO and Spaces all accept
	 * path style), `false` for AWS itself, except for a bucket name holding a dot
	 * over `https`: as a host label it would not match the store's wildcard
	 * certificate, so it is addressed path style. Set `false` explicitly to address
	 * a dotted bucket as a host label anyway.
	 */
	readonly forcePathStyle?: boolean;
}

/**
 * Options for {@link S3ClientShape.put}.
 *
 * @public
 */
export interface S3PutOptions {
	/**
	 * `"*"` writes only when no object holds the key, so the first write wins;
	 * an ETag writes only when the object's ETag differs. A lost condition is
	 * `S3PreconditionFailed`; a write that raced another one to the key is
	 * `S3ConditionalConflict`, to retry.
	 */
	readonly ifNoneMatch?: string;
	/**
	 * Write only when the object's ETag is this one; a lost condition is
	 * `S3PreconditionFailed`, a race with another write `S3ConditionalConflict`.
	 */
	readonly ifMatch?: string;
	/**
	 * The `Content-Type` to store.
	 *
	 * @defaultValue `text/plain; charset=utf-8` for a string body, `application/octet-stream` for bytes.
	 */
	readonly contentType?: string;
	/** User metadata, sent as `x-amz-meta-<name>`; names are HTTP tokens and values printable US-ASCII. */
	readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Options for {@link S3ClientShape.get}.
 *
 * @public
 */
export interface S3GetOptions {
	/** Answer `S3NotModified` instead of the body when the object's ETag is still this one. */
	readonly ifNoneMatch?: string;
	/** A `Range` header value, such as `bytes=0-9` or `bytes=-100`. */
	readonly range?: string;
}

/**
 * Options for {@link S3ClientShape.list}: the ListObjectsV2 query.
 *
 * @public
 */
export interface S3ListOptions {
	/** Only keys that begin with this prefix. */
	readonly prefix?: string;
	/** Roll keys up to the first occurrence of this delimiter after the prefix, into `commonPrefixes`. */
	readonly delimiter?: string;
	/** Only keys after this one, in the store's order. */
	readonly startAfter?: string;
	/** The `nextContinuationToken` of the previous page. */
	readonly continuationToken?: string;
	/**
	 * The page size, an integer from 1 to 1000.
	 *
	 * @defaultValue the store's own, 1000 on S3 and R2
	 */
	readonly maxKeys?: number;
}

/**
 * Options for {@link S3ClientShape.listAll}.
 *
 * @remarks
 * No `delimiter`: the stream carries object summaries only, so the common prefixes
 * a delimiter produces would be dropped without a word; page through `list` to
 * read them. No `continuationToken`: the stream follows them itself.
 *
 * @public
 */
export interface S3ListAllOptions {
	/** Only keys that begin with this prefix. */
	readonly prefix?: string;
	/** Only keys after this one; sent on the first page only. */
	readonly startAfter?: string;
	/** The page size, an integer from 1 to 1000. */
	readonly maxKeys?: number;
}

/**
 * The operations of one bucket.
 *
 * @remarks
 * Every method's `R` is `never`: the client resolves `HttpClient`, `Digest` and
 * `Mac` once, when it is made. No method times out or retries on its own; compose
 * `Effect.timeout` and `Effect.retry` at the call site. A timed-out request is
 * interrupted and its connection released.
 *
 * @public
 */
export interface S3ClientShape {
	/**
	 * Write an object; a lost `ifNoneMatch` or `ifMatch` is `S3PreconditionFailed`,
	 * and a conditional write that raced another write to the key (a `409`
	 * `ConditionalRequestConflict`) is `S3ConditionalConflict`: retry the write, as
	 * AWS documents. A first-write-wins caller handles both; the client retries
	 * neither. A string body is sent as UTF-8; one holding a lone UTF-16 surrogate
	 * has no UTF-8 encoding and is refused as `S3InvalidRequest`
	 * (`malformed-unicode`, field `body`). A `Uint8Array` body is sent as given.
	 */
	readonly put: (
		key: string,
		body: Uint8Array | string,
		options?: S3PutOptions,
	) => Effect.Effect<S3PutResult, S3PutError>;
	/** Read an object; a `404` `NoSuchKey` is `S3NotFound`, any other `404` `S3RequestFailed`, and `304` is `S3NotModified`. */
	readonly get: (key: string, options?: S3GetOptions) => Effect.Effect<S3Object, S3GetError>;
	/** Read an object's metadata; `404` is `S3NotFound`. */
	readonly head: (key: string) => Effect.Effect<S3ObjectHead, S3HeadError>;
	/** Delete an object; deleting a missing object succeeds, as on S3. */
	readonly delete: (key: string) => Effect.Effect<void, S3DeleteError>;
	/** Read one ListObjectsV2 page, strictly. */
	readonly list: (options?: S3ListOptions) => Effect.Effect<S3ListPage, S3ListError>;
	/** Every object under a prefix, following continuation tokens page by page. */
	readonly listAll: (options?: S3ListAllOptions) => Stream.Stream<S3ObjectSummary, S3ListError>;
}

/** One answer, its body drained whatever the status. */
interface Answer {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
}

interface Exchange {
	readonly method: "GET" | "PUT" | "HEAD" | "DELETE";
	readonly path: string;
	readonly query?: ReadonlyArray<readonly [string, string]>;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: Uint8Array;
	readonly contentType?: string;
}

const encoder = new TextEncoder();

const makeClient = (
	options: S3ClientOptions,
): Effect.Effect<S3ClientShape, never, HttpClient.HttpClient | Digest.Digest | Mac.Mac> =>
	Effect.gen(function* () {
		// A wiring mistake (an empty bucket, an endpoint that is not a URL) throws
		// here and dies at construction: it is not a runtime condition to branch on.
		const address: S3Address = yield* Effect.sync(() => resolveAddress(options));
		// The store is a third party: `b3` and `traceparent` would hand it this
		// process's trace and span ids on every request. They are unsigned, so the
		// signature does not change; the client span is still recorded locally.
		const http = HttpClient.transform(yield* HttpClient.HttpClient, (effect) =>
			Effect.provideService(effect, HttpClient.TracerPropagationEnabled, false),
		);
		const crypto = yield* Effect.context<Digest.Digest | Mac.Mac>();
		const { bucket } = address;

		const invalid = (operation: S3Operation, key: string, reason: S3InvalidRequestReason, field: string) =>
			new S3InvalidRequest({ operation, bucket, key, reason, field });

		/** Refuse input that cannot be sent, before anything is signed. */
		const checkHeaders = (
			operation: S3Operation,
			key: string,
			headers: Readonly<Record<string, string | undefined>>,
		): Effect.Effect<Record<string, string>, S3InvalidRequest> => {
			const out: Record<string, string> = {};
			for (const [field, value] of Object.entries(headers)) {
				if (value === undefined) continue;
				if (!isHeaderValue(value)) return Effect.fail(invalid(operation, key, "header-value", field));
				out[field] = value;
			}
			return Effect.succeed(out);
		};

		const checkKey = (operation: S3Operation, key: string): Effect.Effect<void, S3InvalidRequest> => {
			const problem = keyProblem(key);
			return problem === undefined ? Effect.void : Effect.fail(invalid(operation, key, problem, "key"));
		};

		const transport = (operation: S3Operation, key: string) => (cause: unknown) =>
			new S3TransportError({ operation, bucket, key, cause: HttpRedaction.cause(cause) });

		/**
		 * Sign, send and drain one exchange. The body is read on every status, so
		 * the connection goes back to the pool and an error document can be read.
		 */
		const exchange = (operation: S3Operation, key: string, spec: Exchange): Effect.Effect<Answer, S3TransportError> =>
			Effect.gen(function* () {
				const credentials: SigV4Credentials = {
					accessKeyId: Redacted.value(options.credentials.accessKeyId),
					secretAccessKey: options.credentials.secretAccessKey,
					...(options.credentials.sessionToken === undefined ? {} : { sessionToken: options.credentials.sessionToken }),
					region: options.region,
					service: "s3",
				};
				const signed = yield* SigV4.sign(
					{
						method: spec.method,
						host: address.host,
						path: spec.path,
						...(spec.query === undefined ? {} : { query: spec.query }),
						headers: spec.headers ?? {},
						...(spec.body === undefined ? {} : { body: spec.body }),
						// From `Clock`, so `TestClock` drives the signing instant.
						now: yield* DateTime.now,
					},
					credentials,
				).pipe(
					Effect.provideContext(crypto),
					// Keys and the bucket are validated before signing, so a refused path
					// is a broken invariant, and a CryptoError a broken `Mac` layer.
					Effect.catchTags({
						SigV4PathError: (error) => Effect.die(error),
						CryptoError: (error) => Effect.die(error),
					}),
				);
				// The target exactly as signed, never re-encoded.
				const url = `${address.origin}${signed.path}${signed.query === "" ? "" : `?${signed.query}`}`;
				const base = HttpClientRequest.make(spec.method)(url, { headers: signed.headers });
				const request =
					spec.body === undefined ? base : HttpClientRequest.bodyUint8Array(base, spec.body, spec.contentType);
				const response = yield* http.execute(request);
				const body = new Uint8Array(yield* response.arrayBuffer);
				return { status: response.status, headers: response.headers, body };
			}).pipe(Effect.mapError(transport(operation, key)));

		/** The `<Error>` document an answer carries, if its body is one. */
		const errorDocument = (answer: Answer): Effect.Effect<Option.Option<ErrorDocument>> =>
			answer.body.byteLength === 0
				? Effect.succeedNone
				: decodeDocument(answer.body).pipe(
						Effect.map(readErrorDocument),
						Effect.orElseSucceed(() => Option.none<ErrorDocument>()),
					);

		const failed = (operation: S3Operation, key: string, status: number, document: Option.Option<ErrorDocument>) =>
			new S3RequestFailed({
				operation,
				bucket,
				key,
				status,
				...Option.match(document, {
					onNone: () => ({}),
					onSome: (doc) => ({
						...(doc.code === undefined ? {} : { code: doc.code }),
						...(doc.message === undefined ? {} : { s3Message: HttpRedaction.text(doc.message) }),
						...(doc.requestId === undefined ? {} : { requestId: doc.requestId }),
					}),
				}),
			});

		const requestFailed = (
			operation: S3Operation,
			key: string,
			answer: Answer,
		): Effect.Effect<never, S3RequestFailed> =>
			Effect.flatMap(errorDocument(answer), (document) => Effect.fail(failed(operation, key, answer.status, document)));

		const malformed = (operation: S3Operation, key: string, status: number, mismatch: Mismatch, cause?: unknown) =>
			new S3MalformedResponse({
				operation,
				bucket,
				key,
				status,
				expected: mismatch.expected,
				received: mismatch.received,
				...(cause === undefined ? {} : { cause }),
			});

		const fromResult = <A>(
			operation: S3Operation,
			key: string,
			status: number,
			result: Result.Result<A, Mismatch>,
		): Effect.Effect<A, S3MalformedResponse> =>
			Result.isSuccess(result)
				? Effect.succeed(result.success)
				: Effect.fail(malformed(operation, key, status, result.failure));

		const isSuccess = (status: number): boolean => status >= 200 && status < 300;

		const put = Effect.fn("S3Client.put")(function* (
			key: string,
			body: Uint8Array | string,
			putOptions?: S3PutOptions,
		) {
			yield* Effect.annotateCurrentSpan({ bucket, key });
			yield* checkKey("put", key);
			// `TextEncoder` writes U+FFFD for a lone surrogate, so the store would hold
			// bytes the caller never wrote, under a payload hash that agrees with them.
			if (typeof body === "string" && !isWellFormed(body)) {
				return yield* invalid("put", key, "malformed-unicode", "body");
			}
			const bytes = typeof body === "string" ? encoder.encode(body) : body;
			const contentType =
				putOptions?.contentType ??
				(typeof body === "string" ? "text/plain; charset=utf-8" : "application/octet-stream");
			const metadata: Record<string, string | undefined> = {};
			for (const [name, value] of Object.entries(putOptions?.metadata ?? {})) {
				if (!isToken(name)) return yield* invalid("put", key, "metadata-name", `metadata.${name}`);
				const field = `x-amz-meta-${name.toLowerCase()}`;
				// Header names are case-insensitive: `A` and `a` would be one header,
				// and one of the two values would be dropped without a word.
				if (Object.hasOwn(metadata, field)) {
					return yield* invalid("put", key, "metadata-duplicate", `metadata.${name}`);
				}
				metadata[field] = value;
			}
			const headers = yield* checkHeaders("put", key, {
				"content-type": contentType,
				"if-none-match": putOptions?.ifNoneMatch,
				"if-match": putOptions?.ifMatch,
				...metadata,
			});
			const answer = yield* exchange("put", key, {
				method: "PUT",
				path: objectPath(address, key),
				headers,
				body: bytes,
				contentType,
			});
			if (answer.status === 412) return yield* new S3PreconditionFailed({ operation: "put", bucket, key });
			if (answer.status === 409) {
				const document = yield* errorDocument(answer);
				// AWS answers a conditional write that races another write with
				// `409 ConditionalRequestConflict` and says to retry; any other 409
				// (`OperationAborted`, a proxy's page) stays a plain refusal.
				const code = Option.flatMap(document, (doc) => Option.fromUndefinedOr(doc.code));
				if (Option.isSome(code) && code.value === "ConditionalRequestConflict") {
					return yield* new S3ConditionalConflict({ operation: "put", bucket, key });
				}
				return yield* failed("put", key, answer.status, document);
			}
			if (!isSuccess(answer.status)) return yield* requestFailed("put", key, answer);
			return yield* fromResult("put", key, answer.status, readPutResult(answer.headers));
		});

		const get = Effect.fn("S3Client.get")(function* (key: string, getOptions?: S3GetOptions) {
			yield* Effect.annotateCurrentSpan({ bucket, key });
			yield* checkKey("get", key);
			const headers = yield* checkHeaders("get", key, {
				"if-none-match": getOptions?.ifNoneMatch,
				range: getOptions?.range,
			});
			const answer = yield* exchange("get", key, { method: "GET", path: objectPath(address, key), headers });
			if (answer.status === 304) {
				const etag = answer.headers.etag;
				return yield* new S3NotModified({ operation: "get", bucket, key, ...(etag === undefined ? {} : { etag }) });
			}
			if (answer.status === 404) {
				const document = yield* errorDocument(answer);
				// Only a `NoSuchKey` document is a missing object. S3, R2 and MinIO all
				// send one on a GET 404; anything else (`NoSuchBucket`, an HTML proxy
				// page, plain text, an empty body) is a misrouted or misconfigured
				// request, and reading it as "no such object" would hide that.
				const code = Option.flatMap(document, (doc) => Option.fromUndefinedOr(doc.code));
				if (Option.isSome(code) && code.value === "NoSuchKey") {
					return yield* new S3NotFound({ operation: "get", bucket, key });
				}
				return yield* failed("get", key, answer.status, document);
			}
			if (answer.status !== 200 && answer.status !== 206) return yield* requestFailed("get", key, answer);
			const head = yield* fromResult("get", key, answer.status, readHead(key, answer.headers, answer.body.byteLength));
			const contentRange = answer.headers["content-range"];
			return S3Object.make({
				...head,
				body: answer.body,
				...(contentRange === undefined ? {} : { contentRange }),
			});
		});

		const head = Effect.fn("S3Client.head")(function* (key: string) {
			yield* Effect.annotateCurrentSpan({ bucket, key });
			yield* checkKey("head", key);
			const answer = yield* exchange("head", key, { method: "HEAD", path: objectPath(address, key) });
			// A HEAD answer has no body, so a missing bucket cannot be told apart here.
			if (answer.status === 404) return yield* new S3NotFound({ operation: "head", bucket, key });
			if (answer.status !== 200) return yield* requestFailed("head", key, answer);
			return yield* fromResult("head", key, answer.status, readHead(key, answer.headers));
		});

		const remove = Effect.fn("S3Client.delete")(function* (key: string) {
			yield* Effect.annotateCurrentSpan({ bucket, key });
			yield* checkKey("delete", key);
			const answer = yield* exchange("delete", key, { method: "DELETE", path: objectPath(address, key) });
			if (isSuccess(answer.status)) return;
			const document = yield* errorDocument(answer);
			// S3 answers a missing key with 204; a store that answers 404 NoSuchKey
			// means the same thing. A 404 NoSuchBucket stays a failure.
			const code = Option.flatMap(document, (doc) => Option.fromUndefinedOr(doc.code));
			if (answer.status === 404 && Option.isSome(code) && code.value === "NoSuchKey") return;
			return yield* failed("delete", key, answer.status, document);
		});

		const list = Effect.fn("S3Client.list")(function* (listOptions?: S3ListOptions) {
			const prefix = listOptions?.prefix ?? "";
			yield* Effect.annotateCurrentSpan({ bucket, prefix });
			// Each string option rides in the signed query: a lone surrogate would make
			// `encodeURIComponent` throw inside signing, a defect, not a refusal.
			for (const field of ["prefix", "delimiter", "startAfter", "continuationToken"] as const) {
				const value = listOptions?.[field];
				if (value !== undefined && !isWellFormed(value)) {
					return yield* invalid("list", prefix, "malformed-unicode", field);
				}
			}
			if (listOptions?.maxKeys !== undefined && !isMaxKeys(listOptions.maxKeys)) {
				return yield* invalid("list", prefix, "max-keys", "maxKeys");
			}
			const query: Array<readonly [string, string]> = [["list-type", "2"]];
			if (listOptions?.prefix !== undefined) query.push(["prefix", listOptions.prefix]);
			if (listOptions?.delimiter !== undefined) query.push(["delimiter", listOptions.delimiter]);
			if (listOptions?.startAfter !== undefined) query.push(["start-after", listOptions.startAfter]);
			if (listOptions?.continuationToken !== undefined) {
				query.push(["continuation-token", listOptions.continuationToken]);
			}
			if (listOptions?.maxKeys !== undefined) query.push(["max-keys", String(listOptions.maxKeys)]);
			const answer = yield* exchange("list", prefix, { method: "GET", path: bucketPath(address), query });
			if (answer.status !== 200) return yield* requestFailed("list", prefix, answer);
			const root = yield* decodeDocument(answer.body).pipe(
				Effect.mapError((cause) =>
					malformed(
						"list",
						prefix,
						answer.status,
						{
							expected: "a ListBucketResult document",
							received: answer.body.byteLength === 0 ? "an empty body" : `a body that is not XML: ${cause.message}`,
						},
						cause,
					),
				),
			);
			// A 200 carrying an error document is the store failing, never an empty page.
			const document = readErrorDocument(root);
			if (Option.isSome(document)) return yield* failed("list", prefix, answer.status, document);
			return yield* fromResult("list", prefix, answer.status, readListPage(root));
		});

		interface Cursor {
			readonly token: Option.Option<string>;
			readonly first: boolean;
		}

		const listAll = (listAllOptions?: S3ListAllOptions): Stream.Stream<S3ObjectSummary, S3ListError> =>
			// One set of seen tokens per run of the stream, mutated in place: copying
			// it into each cursor would cost O(pages²) on a long listing.
			Stream.suspend(() => {
				const seen = new Set<string>();
				return Stream.paginate<Cursor, S3ObjectSummary, S3ListError>({ token: Option.none(), first: true }, (cursor) =>
					Effect.gen(function* () {
						const page = yield* list({
							...(listAllOptions?.prefix === undefined ? {} : { prefix: listAllOptions.prefix }),
							...(listAllOptions?.maxKeys === undefined ? {} : { maxKeys: listAllOptions.maxKeys }),
							...(cursor.first && listAllOptions?.startAfter !== undefined
								? { startAfter: listAllOptions.startAfter }
								: {}),
							...(Option.isSome(cursor.token) ? { continuationToken: cursor.token.value } : {}),
						});
						if (Option.isNone(page.nextContinuationToken)) return [page.keys, Option.none<Cursor>()] as const;
						const next = page.nextContinuationToken.value;
						if (seen.has(next)) {
							// A store handing back a token it already gave would loop forever.
							return yield* malformed("list", listAllOptions?.prefix ?? "", 200, {
								expected: "a new <NextContinuationToken>",
								received: "a token an earlier page returned",
							});
						}
						seen.add(next);
						return [page.keys, Option.some<Cursor>({ token: Option.some(next), first: false })] as const;
					}),
				);
			});

		return { put, get, head, delete: remove, list, listAll } satisfies S3ClientShape;
	});

/**
 * A minimal client for one bucket of an S3-compatible store: AWS S3, Cloudflare
 * R2, MinIO, Spaces.
 *
 * @remarks
 * Conditional `put`, `get`, `head`, `delete` and a strict ListObjectsV2 (`list`,
 * and `listAll` as a `Stream`), signed with `@effected/crypto`'s `SigV4`. Needs
 * core `HttpClient.HttpClient`, `Digest.Digest` and `Mac.Mac` when it is made:
 * provide `FetchHttpClient.layer` (`effect/http`), and `Digest.layerWebCrypto`
 * with `Mac.layerWebCrypto` and `SecureRandom.layerWebCrypto` (`effect/crypto`) on
 * any WebCrypto runtime, Workers included, or `NodeCrypto.layerDigest` and
 * `NodeCrypto.layerMac` on Node.
 *
 * Every response body is drained; every kept cause goes through
 * `HttpRedaction.cause`; no trace context is sent to the store. A listing whose
 * body is not a `ListBucketResult` fails as `S3MalformedResponse` (or as
 * `S3RequestFailed` for an `<Error>` document) and never reads as an empty page.
 *
 * @example
 * ```ts
 * import { S3Client } from "@effected/s3";
 * import { Effect, Layer, Redacted } from "effect";
 * import { Digest, Mac, SecureRandom } from "effect/crypto";
 * import { FetchHttpClient } from "effect/http";
 *
 * const Archive = S3Client.layer({
 *   bucket: "build-webhooks",
 *   region: "auto",
 *   endpoint: "https://<account>.r2.cloudflarestorage.com",
 *   credentials: {
 *     accessKeyId: Redacted.make("<access key id>"),
 *     secretAccessKey: Redacted.make("<secret access key>"),
 *   },
 * });
 *
 * const AppLayer = Archive.pipe(
 *   Layer.provide(FetchHttpClient.layer),
 *   Layer.provide(Digest.layerWebCrypto),
 *   Layer.provide(Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))),
 * );
 *
 * const program = Effect.gen(function* () {
 *   const s3 = yield* S3Client;
 *   yield* s3.put("raw/1.json", "{}", { ifNoneMatch: "*", contentType: "application/json" });
 *   return (yield* s3.get("raw/1.json")).text;
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
 * ```
 *
 * @public
 */
export class S3Client extends Context.Service<S3Client, S3ClientShape>()("@effected/s3/S3Client") {
	/**
	 * Make a client for one bucket, without a service tag.
	 *
	 * @remarks
	 * For a program that talks to two buckets: make two clients and keep them as
	 * values, or give each its own service. Bad options (an empty bucket or
	 * region, a bucket with `/`, an endpoint that is not an `http:` or `https:` URL
	 * or carries a query, fragment or credentials, a bucket a host label cannot
	 * carry without `forcePathStyle`) are a wiring mistake and die here.
	 *
	 * @public
	 */
	static readonly make: (
		options: S3ClientOptions,
	) => Effect.Effect<S3ClientShape, never, HttpClient.HttpClient | Digest.Digest | Mac.Mac> = (options) =>
		makeClient(options);

	/**
	 * The {@link S3Client} service for one bucket.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh layer per call and layers memoize
	 * by reference — bind the result to a `const` rather than calling it at each
	 * composition site, or the client is built twice. Bad options die when the layer
	 * is built, as for {@link S3Client.make}.
	 *
	 * @public
	 */
	static readonly layer: (
		options: S3ClientOptions,
	) => Layer.Layer<S3Client, never, HttpClient.HttpClient | Digest.Digest | Mac.Mac> = (options) =>
		Layer.effect(S3Client, makeClient(options));
}
