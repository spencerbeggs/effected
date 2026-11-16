// The Azure Blob REST transport the Actions cache and artifact backends hand a
// signed (SAS) url for.
//
// The results backend answers a Twirp RPC with a pre-signed blob url and the
// kit moves bytes against it with four operations: put a buffer, put a file,
// get into a buffer, get into a file. That is a handful of plain HTTP calls, so
// the transport is built on Effect's `HttpClient` and `FileSystem` instead of a
// vendor SDK whose install closure was about twenty packages.
//
//   - A payload up to the single-shot threshold is one `PUT` with
//     `x-ms-blob-type: BlockBlob`.
//   - A larger one is `PUT ?comp=block&blockid=<id>` per block, at bounded
//     concurrency, then one `PUT ?comp=blocklist` naming the ids in order.
//   - A download is a `GET`, streamed into a file or collected into bytes.
//
// Transient failures (a transport fault, `408`, `429`, `5xx`) retry on a bounded
// schedule; everything else fails at once. Every failure is a
// {@link BlobRequestError}: it carries the method, the status, the service's
// error code and request id, and the url with its SAS credential fields
// redacted. The request itself — `sig` included — is never kept.

import type { Effect, FileSystem } from "effect";
import { Effect as E, PlatformError, Schedule, Stream } from "effect";
import type { HttpClient, HttpClientResponse } from "effect/http";
import { HttpBody, HttpClientRequest } from "effect/http";
import type { DataBlobTransfer, FileBlobTransfer } from "../BlobTransfer.js";
import { BlobTransferError } from "../BlobTransfer.js";
import { blobUrl } from "./blobCause.js";

/**
 * The storage service version sent as `x-ms-version`.
 *
 * @remarks
 * The version `@azure/storage-blob` 12.34 sent, which is the one the transport
 * replaced. A SAS url's own `sv` governs what the signature authorizes; this
 * header selects the REST behaviour of the call.
 *
 * @internal
 */
export const SERVICE_VERSION = "2026-10-06";

const MIB = 1024 * 1024;

/**
 * The transfer sizing. `blockSize` and `concurrency` are what `actions/cache`
 * uses; a multi-gigabyte toolchain cache is the normal case.
 *
 * @internal
 */
export interface BlobTransferOptions {
	/** Payloads up to this many bytes go in one `PUT`. */
	readonly maxSingleShotSize: number;
	/** The size of each block above the threshold. */
	readonly blockSize: number;
	/** Blocks in flight at once. */
	readonly concurrency: number;
	/** The backoff between attempts of a transient failure. */
	readonly retrySchedule: Schedule.Schedule<unknown>;
	/** How many times a transient failure is retried. */
	readonly retries: number;
}

/** The sizing `ActionCache` and `Artifact` upload files with. @internal */
export const FILE_OPTIONS: BlobTransferOptions = {
	maxSingleShotSize: 128 * MIB,
	blockSize: 64 * MIB,
	concurrency: 8,
	retrySchedule: Schedule.exponential("1 second", 2),
	retries: 4,
};

/** The sizing `BlobStore.githubCache` uploads buffers with. @internal */
export const DATA_OPTIONS: BlobTransferOptions = { ...FILE_OPTIONS, maxSingleShotSize: 256 * MIB };

/**
 * Why a blob request did not succeed.
 *
 * @remarks
 * A plain `Error` subclass rather than a Schema class: it is only ever kept as
 * `BlobTransferError.cause`, and it holds nothing that was not redacted on the
 * way in.
 *
 * @internal
 */
export class BlobRequestError extends Error {
	override readonly name = "BlobRequestError";
	readonly method: string;
	/** The request url with its SAS credential fields redacted. */
	readonly url: string;
	/** The HTTP status, absent for a transport fault. */
	readonly statusCode?: number;
	/** The storage service's `<Code>`, read from an XML error body. */
	readonly code?: string;
	/** The `x-ms-request-id` the service answered with. */
	readonly requestId?: string;

	constructor(fields: {
		readonly method: string;
		readonly url: string;
		readonly message: string;
		readonly statusCode?: number | undefined;
		readonly code?: string | undefined;
		readonly requestId?: string | undefined;
	}) {
		super(fields.message);
		this.method = fields.method;
		this.url = blobUrl(fields.url);
		if (fields.statusCode !== undefined) this.statusCode = fields.statusCode;
		if (fields.code !== undefined) this.code = fields.code;
		if (fields.requestId !== undefined) this.requestId = fields.requestId;
	}
}

const isTransient = (error: BlobRequestError): boolean =>
	error.statusCode === undefined || error.statusCode >= 500 || error.statusCode === 408 || error.statusCode === 429;

/** The service's `<Code>` out of an XML error body. */
const errorCode = (body: string): string | undefined => /<Code>([^<]+)<\/Code>/.exec(body)?.[1];

const base = (method: "PUT" | "GET", url: string) =>
	(method === "PUT" ? HttpClientRequest.put(url) : HttpClientRequest.get(url)).pipe(
		HttpClientRequest.setHeader("x-ms-version", SERVICE_VERSION),
	);

/** Send one request; a non-2xx answer or a transport fault is a {@link BlobRequestError}. */
const send = (
	http: HttpClient.HttpClient,
	method: "PUT" | "GET",
	url: string,
	request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, BlobRequestError> =>
	http.execute(request).pipe(
		// The core error holds the live request, signature included; only its
		// reason survives.
		E.mapError(
			(cause) => new BlobRequestError({ method, url, message: `${method} did not complete (${cause.reason._tag})` }),
		),
		E.flatMap((response) => {
			if (response.status >= 200 && response.status < 300) return E.succeed(response);
			return response.text.pipe(
				E.orElseSucceed(() => ""),
				E.flatMap((body) =>
					E.fail(
						new BlobRequestError({
							method,
							url,
							message: `${method} answered ${response.status}`,
							statusCode: response.status,
							code: errorCode(body),
							requestId: response.headers["x-ms-request-id"],
						}),
					),
				),
			);
		}),
	);

const withRetry = <A, Err>(options: BlobTransferOptions, attempt: Effect.Effect<A, Err>): Effect.Effect<A, Err> =>
	E.retry(attempt, {
		schedule: options.retrySchedule,
		times: options.retries,
		while: (error) => error instanceof BlobRequestError && isTransient(error),
	});

const putBody = (
	http: HttpClient.HttpClient,
	options: BlobTransferOptions,
	url: string,
	params: Readonly<Record<string, string>>,
	body: HttpBody.HttpBody,
	blobType: boolean,
): Effect.Effect<void, BlobRequestError> => {
	const request = Object.entries(params).reduce(
		(req, [name, value]) => HttpClientRequest.setUrlParam(req, name, value),
		base("PUT", url).pipe(HttpClientRequest.setBody(body)),
	);
	const typed = blobType ? HttpClientRequest.setHeader(request, "x-ms-blob-type", "BlockBlob") : request;
	return withRetry(options, E.asVoid(E.scoped(send(http, "PUT", url, typed))));
};

/** The fixed-width base64 id of block `index`; every id in a blob must be one length. */
const blockId = (index: number): string => btoa(String(index).padStart(8, "0"));

const blocklistXml = (count: number): string =>
	`<?xml version="1.0" encoding="utf-8"?><BlockList>${Array.from(
		{ length: count },
		(_, index) => `<Latest>${blockId(index)}</Latest>`,
	).join("")}</BlockList>`;

/**
 * Upload `size` bytes, whole or as blocks, reading each span with `read`.
 *
 * @remarks
 * `read` runs once per block, outside the retry: a retried `PUT` sends the
 * same bytes again, which a `Uint8Array` body can do and a consumed stream
 * could not.
 */
const upload = <E>(
	http: HttpClient.HttpClient,
	options: BlobTransferOptions,
	url: string,
	size: number,
	read: (offset: number, length: number) => Effect.Effect<Uint8Array, E>,
): Effect.Effect<void, BlobRequestError | E> => {
	if (size <= options.maxSingleShotSize) {
		return E.flatMap(read(0, size), (bytes) =>
			putBody(http, options, url, {}, HttpBody.uint8Array(bytes, "application/octet-stream"), true),
		);
	}
	const count = Math.ceil(size / options.blockSize);
	return E.forEach(
		Array.from({ length: count }, (_, index) => index),
		(index) =>
			E.flatMap(
				read(index * options.blockSize, Math.min(options.blockSize, size - index * options.blockSize)),
				(bytes) =>
					putBody(
						http,
						options,
						url,
						{ comp: "block", blockid: blockId(index) },
						HttpBody.uint8Array(bytes, "application/octet-stream"),
						false,
					),
			),
		{ concurrency: options.concurrency, discard: true },
	).pipe(
		E.andThen(
			putBody(http, options, url, { comp: "blocklist" }, HttpBody.text(blocklistXml(count), "application/xml"), false),
		),
	);
};

/**
 * Read `length` bytes of `file` from `offset` into one buffer, written as each chunk arrives: the chunks are never
 * held beside the joined copy, so a block costs its own size once. A file that ends early fails, rather than send
 * zero bytes the signature would accept.
 */
const readSpan = (
	fs: FileSystem.FileSystem,
	file: string,
	offset: number,
	length: number,
): Effect.Effect<Uint8Array, PlatformError.PlatformError> =>
	E.suspend(() => {
		const out = new Uint8Array(length);
		let at = 0;
		return fs.stream(file, { offset, bytesToRead: length }).pipe(
			Stream.runForEach((chunk) =>
				E.sync(() => {
					const take = Math.min(chunk.byteLength, length - at);
					out.set(take === chunk.byteLength ? chunk : chunk.subarray(0, take), at);
					at += take;
				}),
			),
			E.flatMap(() =>
				at === length
					? E.succeed(out)
					: E.fail(
							PlatformError.systemError({
								_tag: "UnexpectedEof",
								module: "FileSystem",
								method: "stream",
								description: `expected ${length} bytes at offset ${offset}, read ${at}`,
								pathOrDescriptor: file,
							}),
						),
			),
		);
	});

const uploadFailed = (cause: unknown): BlobTransferError => new BlobTransferError({ reason: "uploadFailed", cause });
const downloadFailed = (cause: unknown): BlobTransferError =>
	new BlobTransferError({ reason: "downloadFailed", cause });

/**
 * The {@link DataBlobTransfer} over `HttpClient`.
 *
 * @internal
 */
export const httpDataTransfer = (
	http: HttpClient.HttpClient,
	options: BlobTransferOptions = DATA_OPTIONS,
): DataBlobTransfer => ({
	uploadData: (url, data) =>
		upload(http, options, url, data.byteLength, (offset, length) =>
			E.succeed(data.subarray(offset, offset + length)),
		).pipe(E.mapError(uploadFailed)),
	downloadToBuffer: (url) =>
		withRetry(
			options,
			E.scoped(
				E.flatMap(send(http, "GET", url, base("GET", url)), (response) =>
					response.arrayBuffer.pipe(
						E.map((buffer) => new Uint8Array(buffer)),
						E.mapError(
							(cause) =>
								new BlobRequestError({
									method: "GET",
									url,
									message: `GET body did not complete (${cause.reason._tag})`,
								}),
						),
					),
				),
			),
		).pipe(E.mapError(downloadFailed)),
});

/**
 * The {@link FileBlobTransfer} over `HttpClient` and `FileSystem`.
 *
 * @internal
 */
export const httpFileTransfer = (
	http: HttpClient.HttpClient,
	fs: FileSystem.FileSystem,
	options: BlobTransferOptions = FILE_OPTIONS,
): FileBlobTransfer => ({
	uploadFile: (url, file) =>
		E.flatMap(fs.stat(file), (info) =>
			upload(http, options, url, Number(info.size), (offset, length) => readSpan(fs, file, offset, length)),
		).pipe(E.mapError(uploadFailed)),
	downloadToFile: (url, file) =>
		withRetry(
			options,
			E.scoped(
				E.flatMap(send(http, "GET", url, base("GET", url)), (response) =>
					response.stream.pipe(
						Stream.mapError(
							(cause) =>
								new BlobRequestError({
									method: "GET",
									url,
									message: `GET body did not complete (${cause.reason._tag})`,
								}),
						),
						Stream.run(fs.sink(file)),
					),
				),
			),
		).pipe(E.mapError(downloadFailed)),
});
