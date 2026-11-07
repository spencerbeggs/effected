import { createHash } from "node:crypto";
import { SigV4 } from "@effected/crypto";
import { Effect, Layer, Redacted } from "effect";
import { Digest, Mac, SecureRandom } from "effect/crypto";
import type { HttpClientRequest } from "effect/http";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { S3ClientOptions } from "../../src/S3Client.js";
import { S3Client } from "../../src/S3Client.js";

/** WebCrypto `Digest` and `Mac`, exactly as a Worker provides them. */
export const CryptoLive: Layer.Layer<Digest.Digest | Mac.Mac> = Layer.mergeAll(
	Digest.layerWebCrypto,
	Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto)),
);

export const ACCESS_KEY_ID = "AKIDFAKES3EXAMPLE";
export const SECRET_ACCESS_KEY = "fake/secret+access/key/EXAMPLEKEY";
export const SESSION_TOKEN = "FwoGZXIvYXdzEXAMPLEsessiontoken";

/** Options for a path-style client against the fake's R2-shaped endpoint. */
export const r2Options = (overrides: Partial<S3ClientOptions> = {}): S3ClientOptions => ({
	bucket: "archive",
	region: "auto",
	endpoint: "https://account.r2.example.com",
	credentials: {
		accessKeyId: Redacted.make(ACCESS_KEY_ID),
		secretAccessKey: Redacted.make(SECRET_ACCESS_KEY),
	},
	...overrides,
});

/** A request the fake received, as it arrived on the wire. */
export interface SeenRequest {
	readonly method: string;
	readonly url: URL;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
	/** Whether the `authorization` header matched an independent re-signing of the request as received. */
	readonly signatureValid: boolean;
}

/** One stored object. */
export interface StoredObject {
	readonly body: Uint8Array;
	readonly contentType: string;
	readonly etag: string;
	readonly metadata: Readonly<Record<string, string>>;
	readonly lastModified: Date;
}

/** A scripted answer: a `Response`, or `undefined` to let the bucket answer. */
export type Script = (request: SeenRequest, key: string | undefined) => Response | undefined;

export interface FakeS3 {
	readonly seen: Array<SeenRequest>;
	readonly objects: Map<string, StoredObject>;
	/** `HttpClient` playing the store, with crypto for its own signature check. */
	readonly http: Layer.Layer<HttpClient.HttpClient>;
	/** An `S3Client` over the fake, `R = never`. */
	readonly layer: (options?: S3ClientOptions) => Layer.Layer<S3Client>;
}

const escapeXml = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const xmlError = (status: number, code: string, message: string, requestId = "REQ123"): Response =>
	new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${escapeXml(message)}</Message><RequestId>${requestId}</RequestId></Error>`,
		{ status, headers: { "content-type": "application/xml" } },
	);

const md5Etag = (body: Uint8Array): string => `"${createHash("md5").update(body).digest("hex")}"`;
const sha256Hex = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");

const STAMP = new Date("2026-11-06T12:00:00.000Z");

const parseAmzDate = (value: string): Date =>
	new Date(
		`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
	);

const bodyOf = (request: HttpClientRequest.HttpClientRequest): Uint8Array =>
	request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array(0);

/**
 * Re-sign the request exactly as it arrived (decoded path, query from the URL,
 * the signed headers' values, the `x-amz-date` instant) and compare the
 * `authorization` it produces. A client that sent a different target or header
 * than it signed fails here, which is what a real store does.
 */
const verifySignature = (
	method: string,
	url: URL,
	headers: Readonly<Record<string, string>>,
	body: Uint8Array,
	options: S3ClientOptions,
): Effect.Effect<boolean, never, Digest.Digest | Mac.Mac> =>
	Effect.gen(function* () {
		const authorization = headers.authorization ?? "";
		const amzDate = headers["x-amz-date"];
		const payloadHash = headers["x-amz-content-sha256"];
		if (amzDate === undefined || payloadHash === undefined) return false;
		if (payloadHash !== sha256Hex(body)) return false;
		const signedNames = (/SignedHeaders=([^,]+)/.exec(authorization)?.[1] ?? "").split(";");
		const signedHeaders: Record<string, string> = {};
		for (const name of signedNames) {
			if (
				name === "host" ||
				name === "x-amz-date" ||
				name === "x-amz-content-sha256" ||
				name === "x-amz-security-token"
			)
				continue;
			const value = headers[name];
			if (value === undefined) return false;
			signedHeaders[name] = value;
		}
		const path = url.pathname.split("/").map(decodeURIComponent).join("/");
		const resigned = yield* SigV4.sign(
			{
				method,
				host: url.host,
				path,
				query: [...url.searchParams.entries()],
				headers: signedHeaders,
				payloadHash,
				now: parseAmzDate(amzDate),
			},
			{
				accessKeyId: Redacted.value(options.credentials.accessKeyId),
				secretAccessKey: options.credentials.secretAccessKey,
				...(options.credentials.sessionToken === undefined ? {} : { sessionToken: options.credentials.sessionToken }),
				region: options.region,
				service: "s3",
			},
		).pipe(Effect.orDie);
		return resigned.headers.authorization === authorization;
	});

interface ListQuery {
	readonly prefix: string;
	readonly delimiter: string | undefined;
	readonly startAfter: string | undefined;
	readonly token: string | undefined;
	readonly maxKeys: number;
}

const listBucket = (objects: Map<string, StoredObject>, query: ListQuery): Response => {
	const after = query.token === undefined ? query.startAfter : atob(query.token);
	const entries: Array<
		{ readonly kind: "key"; readonly key: string } | { readonly kind: "prefix"; readonly prefix: string }
	> = [];
	const rolled = new Set<string>();
	for (const key of [...objects.keys()].sort()) {
		if (!key.startsWith(query.prefix)) continue;
		if (after !== undefined && key <= after) continue;
		if (query.delimiter !== undefined) {
			const at = key.indexOf(query.delimiter, query.prefix.length);
			if (at !== -1) {
				const prefix = key.slice(0, at + query.delimiter.length);
				if (!rolled.has(prefix)) {
					rolled.add(prefix);
					entries.push({ kind: "prefix", prefix });
				}
				continue;
			}
		}
		entries.push({ kind: "key", key });
	}
	const page = entries.slice(0, query.maxKeys);
	const truncated = entries.length > page.length;
	const last = page.at(-1);
	const lastKey = last === undefined ? "" : last.kind === "key" ? last.key : last.prefix;
	const contents = page
		.map((entry) => {
			if (entry.kind === "prefix")
				return `<CommonPrefixes><Prefix>${escapeXml(entry.prefix)}</Prefix></CommonPrefixes>`;
			const object = objects.get(entry.key);
			return `<Contents><Key>${escapeXml(entry.key)}</Key><LastModified>${object?.lastModified.toISOString()}</LastModified><ETag>${escapeXml(object?.etag ?? "")}</ETag><Size>${object?.body.byteLength ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
		})
		.join("");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>archive</Name><Prefix>${escapeXml(query.prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${query.maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${btoa(lastKey)}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`;
	return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
};

/** What the bucket answers when no script does. */
const bucketAnswer = (objects: Map<string, StoredObject>, request: SeenRequest, key: string | undefined): Response => {
	if (key === undefined) {
		if (request.method !== "GET" || request.url.searchParams.get("list-type") !== "2") {
			return xmlError(400, "InvalidRequest", "unsupported bucket operation");
		}
		const params = request.url.searchParams;
		return listBucket(objects, {
			prefix: params.get("prefix") ?? "",
			delimiter: params.get("delimiter") ?? undefined,
			startAfter: params.get("start-after") ?? undefined,
			token: params.get("continuation-token") ?? undefined,
			maxKeys: Number(params.get("max-keys") ?? "1000"),
		});
	}
	const existing = objects.get(key);
	if (request.method === "PUT") {
		const ifNoneMatch = request.headers["if-none-match"];
		const ifMatch = request.headers["if-match"];
		if (ifNoneMatch === "*" && existing !== undefined)
			return xmlError(412, "PreconditionFailed", "At least one of the pre-conditions you specified did not hold");
		if (ifNoneMatch !== undefined && ifNoneMatch !== "*" && existing?.etag === ifNoneMatch) {
			return xmlError(412, "PreconditionFailed", "At least one of the pre-conditions you specified did not hold");
		}
		if (ifMatch !== undefined && existing?.etag !== ifMatch) {
			return xmlError(412, "PreconditionFailed", "At least one of the pre-conditions you specified did not hold");
		}
		const metadata: Record<string, string> = {};
		for (const [name, value] of Object.entries(request.headers)) {
			if (name.startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
		}
		const etag = md5Etag(request.body);
		objects.set(key, {
			body: request.body,
			contentType: request.headers["content-type"] ?? "binary/octet-stream",
			etag,
			metadata,
			lastModified: STAMP,
		});
		return new Response(null, { status: 200, headers: { etag, "x-amz-version-id": "v1" } });
	}
	if (request.method === "DELETE") {
		objects.delete(key);
		return new Response(null, { status: 204 });
	}
	if (request.method === "GET" || request.method === "HEAD") {
		if (existing === undefined) {
			return request.method === "HEAD"
				? new Response(null, { status: 404 })
				: xmlError(404, "NoSuchKey", "The specified key does not exist.");
		}
		const headers: Record<string, string> = {
			etag: existing.etag,
			"content-type": existing.contentType,
			"last-modified": existing.lastModified.toUTCString(),
		};
		for (const [name, value] of Object.entries(existing.metadata)) headers[`x-amz-meta-${name}`] = value;
		if (request.headers["if-none-match"] === existing.etag)
			return new Response(null, { status: 304, headers: { etag: existing.etag } });
		const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
		if (range !== null) {
			const start = Number(range[1]);
			const end = Math.min(Number(range[2]), existing.body.byteLength - 1);
			const part = existing.body.slice(start, end + 1);
			headers["content-range"] = `bytes ${start}-${end}/${existing.body.byteLength}`;
			return new Response(request.method === "HEAD" ? null : part, { status: 206, headers });
		}
		headers["content-length"] = String(existing.body.byteLength);
		return new Response(request.method === "HEAD" ? null : existing.body, { status: 200, headers });
	}
	return xmlError(405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
};

/**
 * A fake S3 bucket over a scripted `HttpClient`. Every request is recorded and its
 * signature re-verified; a bad signature answers `403 SignatureDoesNotMatch`, as a
 * store would. `script` answers first; `undefined` falls through to the bucket.
 */
export const fakeS3 = (script: Script = () => undefined, signing: S3ClientOptions = r2Options()): FakeS3 => {
	const seen: Array<SeenRequest> = [];
	const objects = new Map<string, StoredObject>();
	const http: Layer.Layer<HttpClient.HttpClient> = Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const crypto = yield* Effect.context<Digest.Digest | Mac.Mac>();
			return HttpClient.make((request, url) =>
				Effect.gen(function* () {
					const headers = { ...request.headers };
					const body = bodyOf(request);
					const signatureValid = yield* verifySignature(request.method, url, headers, body, signing).pipe(
						Effect.provideContext(crypto),
					);
					const recorded: SeenRequest = { method: request.method, url, headers, body, signatureValid };
					seen.push(recorded);
					const bucketPrefix = signing.forcePathStyle === false ? "/" : `/${signing.bucket}`;
					const path = url.pathname.split("/").map(decodeURIComponent).join("/");
					const key =
						path === bucketPrefix || path === `${bucketPrefix}/` || (bucketPrefix === "/" && path === "/")
							? undefined
							: path.slice(bucketPrefix === "/" ? 1 : bucketPrefix.length + 1);
					const response = !signatureValid
						? xmlError(
								403,
								"SignatureDoesNotMatch",
								"The request signature we calculated does not match the signature you provided.",
							)
						: (script(recorded, key) ?? bucketAnswer(objects, recorded, key));
					return HttpClientResponse.fromWeb(request, response);
				}),
			);
		}),
	).pipe(Layer.provide(CryptoLive));
	return {
		seen,
		objects,
		http,
		layer: (options = signing) => S3Client.layer(options).pipe(Layer.provide(Layer.mergeAll(http, CryptoLive))),
	};
};
