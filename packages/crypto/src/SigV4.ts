import type { PlatformError } from "effect";
import { Crypto, DateTime, Effect, Redacted } from "effect";
import * as Hex from "effect/encoding/Hex";
import type { CryptoError } from "./CryptoError.js";
import { utf8 } from "./internal/bytes.js";
import { hmacBytes } from "./internal/hmac.js";

const ALGORITHM = "AWS4-HMAC-SHA256";

/**
 * The access key, optional session token and scope a signature needs.
 *
 * @public
 */
export interface SigV4Credentials {
	/** The access key id, which appears in the `authorization` header. */
	readonly accessKeyId: string;
	/** The secret access key; read only to derive the signing key. */
	readonly secretAccessKey: Redacted.Redacted<string>;
	/** A temporary session token, signed and sent as `x-amz-security-token`. */
	readonly sessionToken?: Redacted.Redacted<string>;
	/** The region, `auto` for Cloudflare R2. */
	readonly region: string;
	/** The service, usually `s3`; the algorithm is not S3-specific. */
	readonly service: string;
}

/**
 * One request to sign.
 *
 * @public
 */
export interface SigV4Request {
	/** The HTTP method, upper case. */
	readonly method: string;
	/** The `host` header value, including any non-default port. */
	readonly host: string;
	/**
	 * The unencoded path, `/`-separated. Each segment is encoded here with
	 * {@link SigV4.encodePath}; send the request to the same encoded path.
	 * One leading `/` is optional; empty segments are kept, as S3 does.
	 */
	readonly path: string;
	/** The unencoded query parameters; repeated names as pairs. */
	readonly query?: Readonly<Record<string, string>> | ReadonlyArray<readonly [string, string]>;
	/** Headers to sign, in any case and any order. */
	readonly headers?: Readonly<Record<string, string>>;
	/** The body, hashed when `payloadHash` is absent; empty when omitted. */
	readonly body?: Uint8Array | string;
	/**
	 * The payload hash to sign, overriding the body's: a precomputed hex
	 * SHA-256, {@link SigV4.EMPTY_PAYLOAD_HASH} or {@link SigV4.UNSIGNED_PAYLOAD}.
	 */
	readonly payloadHash?: string;
	/** The signing instant. Explicit so a signature is reproducible. */
	readonly now: Date | DateTime.DateTime;
}

/**
 * The canonical form of a request, as {@link SigV4.canonicalize} returns it.
 *
 * @public
 */
export interface SigV4Canonical {
	/** Every header to send, names lower-cased, including those signing adds besides `authorization`. */
	readonly headers: Readonly<Record<string, string>>;
	/** The canonical request string the signature covers. */
	readonly canonicalRequest: string;
	/** The `;`-joined, sorted names of the signed headers. */
	readonly signedHeaders: string;
	/** The payload hash signed and sent as `x-amz-content-sha256`. */
	readonly payloadHash: string;
	/** The signing instant as `20130524T000000Z`. */
	readonly amzDate: string;
	/** The signing day as `20130524`. */
	readonly dateStamp: string;
}

/** RFC 3986 percent-encoding: everything but `A-Z a-z 0-9 - _ . ~`. */
const encodeComponent = (value: string): string =>
	encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const encodePath = (path: string): string => path.split("/").map(encodeComponent).join("/");

const timestamps = (now: Date | DateTime.DateTime): { readonly amzDate: string; readonly dateStamp: string } => {
	const millis = now instanceof Date ? now.getTime() : DateTime.toEpochMillis(now);
	const amzDate = `${new Date(millis)
		.toISOString()
		.replace(/[:-]|\.\d{3}/g, "")
		.slice(0, 15)}Z`;
	return { amzDate, dateStamp: amzDate.slice(0, 8) };
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const canonicalQuery = (query: SigV4Request["query"]): string => {
	if (query === undefined) return "";
	const pairs: ReadonlyArray<readonly [string, string]> = Array.isArray(query)
		? (query as ReadonlyArray<readonly [string, string]>)
		: Object.entries(query);
	return pairs
		.map(([key, value]) => [encodeComponent(key), encodeComponent(value)] as const)
		.sort(([ak, av], [bk, bv]) => compare(ak, bk) || compare(av, bv))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
};

const sha256Hex = (data: Uint8Array): Effect.Effect<string, PlatformError.PlatformError, Crypto.Crypto> =>
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto;
		return Hex.encode(yield* crypto.digest("SHA-256", data));
	});

const canonicalize = (
	request: SigV4Request,
	credentials: SigV4Credentials,
): Effect.Effect<SigV4Canonical, PlatformError.PlatformError, Crypto.Crypto> =>
	Effect.gen(function* () {
		const { amzDate, dateStamp } = timestamps(request.now);
		const payloadHash = request.payloadHash ?? (yield* sha256Hex(utf8(request.body ?? new Uint8Array(0))));

		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(request.headers ?? {})) headers[name.toLowerCase()] = value;
		headers.host = request.host;
		headers["x-amz-date"] = amzDate;
		headers["x-amz-content-sha256"] = payloadHash;
		if (credentials.sessionToken !== undefined) {
			headers["x-amz-security-token"] = Redacted.value(credentials.sessionToken);
		}

		// Sorted, lower-cased and whitespace-collapsed. The order is not
		// cosmetic: the signature covers this exact string, and any other order
		// is rejected with nothing more informative than SignatureDoesNotMatch.
		const names = Object.keys(headers).sort();
		const canonicalHeaders = names
			.map((name) => `${name}:${(headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`)
			.join("");
		const signedHeaders = names.join(";");
		const canonicalPath = `/${encodePath(request.path.startsWith("/") ? request.path.slice(1) : request.path)}`;

		return {
			headers,
			signedHeaders,
			payloadHash,
			amzDate,
			dateStamp,
			canonicalRequest: [
				request.method.toUpperCase(),
				canonicalPath,
				canonicalQuery(request.query),
				canonicalHeaders,
				signedHeaders,
				payloadHash,
			].join("\n"),
		};
	});

const signingKey = (
	secretAccessKey: Redacted.Redacted<string>,
	dateStamp: string,
	region: string,
	service: string,
): Effect.Effect<Uint8Array, CryptoError> =>
	Effect.gen(function* () {
		const dated = yield* hmacBytes("SHA-256", utf8(`AWS4${Redacted.value(secretAccessKey)}`), utf8(dateStamp));
		const regional = yield* hmacBytes("SHA-256", dated, utf8(region));
		const serviced = yield* hmacBytes("SHA-256", regional, utf8(service));
		return yield* hmacBytes("SHA-256", serviced, utf8("aws4_request"));
	});

const sign = Effect.fn("SigV4.sign")(function* (request: SigV4Request, credentials: SigV4Credentials) {
	yield* Effect.annotateCurrentSpan({ region: credentials.region, service: credentials.service });
	const { headers, canonicalRequest, signedHeaders, amzDate, dateStamp } = yield* canonicalize(request, credentials);
	const scope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
	const stringToSign = [ALGORITHM, amzDate, scope, yield* sha256Hex(utf8(canonicalRequest))].join("\n");
	const key = yield* signingKey(credentials.secretAccessKey, dateStamp, credentials.region, credentials.service);
	const signature = Hex.encode(yield* hmacBytes("SHA-256", key, utf8(stringToSign)));
	const signed: Record<string, string> = {
		...headers,
		authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
	return signed;
});

/**
 * AWS Signature Version 4 request signing, for S3 and S3-compatible stores
 * such as R2, MinIO and Spaces.
 *
 * @remarks
 * HMAC comes from WebCrypto and every SHA-256 from core `Crypto.digest`, so
 * signing is effectful and needs `Crypto` in `R`. Time is never read: the
 * request carries its signing instant.
 *
 * @public
 */
export class SigV4 {
	private constructor() {}

	/**
	 * The hex SHA-256 of an empty body: the payload hash of every GET, HEAD
	 * and list request.
	 *
	 * @public
	 */
	static readonly EMPTY_PAYLOAD_HASH: string = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

	/**
	 * The payload hash that signs no body, for streamed or presigned uploads.
	 *
	 * @public
	 */
	static readonly UNSIGNED_PAYLOAD: string = "UNSIGNED-PAYLOAD";

	/**
	 * Percent-encode a path one segment at a time, keeping the slashes.
	 *
	 * @remarks
	 * RFC 3986: everything but `A-Z a-z 0-9 - _ . ~` is escaped, including
	 * `!'()*`, which `encodeURIComponent` leaves alone and AWS does not. A key
	 * holding one of them otherwise signs one path and requests another, and
	 * fails as an opaque `SignatureDoesNotMatch`. Build the request URL from
	 * this, so the path sent is the path signed.
	 *
	 * @public
	 */
	static readonly encodePath: (path: string) => string = encodePath;

	/**
	 * The canonical request and the headers it covers.
	 *
	 * @remarks
	 * Exported so a test can pin it against AWS's own documented canonical
	 * requests. The path is encoded per segment, the query encoded and sorted
	 * by name then value, and the payload hash is `payloadHash` when given or
	 * the SHA-256 of the body otherwise.
	 *
	 * @public
	 */
	static readonly canonicalize: (
		request: SigV4Request,
		credentials: SigV4Credentials,
	) => Effect.Effect<SigV4Canonical, PlatformError.PlatformError, Crypto.Crypto> = canonicalize;

	/**
	 * Derive the signing key: four nested HMAC-SHA256s over the date, region,
	 * service and the literal `aws4_request`.
	 *
	 * @remarks
	 * Exported so a test can reproduce AWS's documented derivation. The
	 * result is key material; treat it as secret.
	 *
	 * @public
	 */
	static readonly signingKey: (
		secretAccessKey: Redacted.Redacted<string>,
		dateStamp: string,
		region: string,
		service: string,
	) => Effect.Effect<Uint8Array, CryptoError> = signingKey;

	/**
	 * Sign a request, returning the headers to send.
	 *
	 * @remarks
	 * The result is the caller's headers, names lower-cased, **plus**
	 * everything signing added — `host`, `x-amz-date`,
	 * `x-amz-content-sha256`, the optional `x-amz-security-token` and
	 * `authorization` — so the caller sends exactly what was signed. The span
	 * carries the region and service, never a key or the signature.
	 *
	 * @public
	 */
	static readonly sign: (
		request: SigV4Request,
		credentials: SigV4Credentials,
	) => Effect.Effect<Record<string, string>, CryptoError | PlatformError.PlatformError, Crypto.Crypto> = sign;
}
