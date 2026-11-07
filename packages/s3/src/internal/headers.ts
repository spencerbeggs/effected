/**
 * Pure readers over response headers: an object head, and a put result.
 *
 * @internal
 */
import type { DateTime } from "effect";
import { Option, Result } from "effect";
import { S3ObjectHead, S3PutResult } from "../S3Object.js";
import { parseHttpDate } from "./dates.js";
import type { Mismatch } from "./documents.js";

/** Response headers, names lower-cased, as core's `Headers` holds them. */
type ResponseHeaders = Readonly<Record<string, string>>;

const META_PREFIX = "x-amz-meta-";
const CONTENT_LENGTH = /^\d+$/;

const header = (headers: ResponseHeaders, name: string): string | undefined =>
	Object.hasOwn(headers, name) ? headers[name] : undefined;

const etagOf = (headers: ResponseHeaders): Result.Result<string, Mismatch> => {
	const etag = header(headers, "etag");
	return etag === undefined || etag === ""
		? Result.fail({ expected: "an ETag header", received: "none" })
		: Result.succeed(etag);
};

/**
 * The `x-amz-meta-*` headers, prefix removed, as own data properties.
 *
 * @remarks
 * `Object.defineProperty`, not assignment: a store answering
 * `x-amz-meta-__proto__` would otherwise set the record's prototype.
 *
 * @internal
 */
export const metadataOf = (headers: ResponseHeaders): Record<string, string> => {
	const metadata: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name.length > META_PREFIX.length && name.startsWith(META_PREFIX)) {
			Object.defineProperty(metadata, name.slice(META_PREFIX.length), {
				value,
				writable: true,
				enumerable: true,
				configurable: true,
			});
		}
	}
	return metadata;
};

/**
 * Read a successful `put`'s headers: the ETag (required) and the version id.
 *
 * @internal
 */
export const readPutResult = (headers: ResponseHeaders): Result.Result<S3PutResult, Mismatch> =>
	Result.map(etagOf(headers), (etag) => {
		const versionId = header(headers, "x-amz-version-id");
		return S3PutResult.make({ etag, ...(versionId === undefined ? {} : { versionId }) });
	});

/**
 * Read an object's head from a `head` or `get` answer.
 *
 * @remarks
 * The ETag is required; so is `Content-Length` unless the caller already knows the
 * size (a `get` passes its body's length). A `Last-Modified` that is present but
 * not an IMF-fixdate HTTP date, or names an impossible date, fails rather than
 * being dropped or read leniently.
 *
 * @internal
 */
export const readHead = (
	key: string,
	headers: ResponseHeaders,
	knownLength?: number,
): Result.Result<S3ObjectHead, Mismatch> =>
	Result.gen(function* () {
		const etag = yield* etagOf(headers);
		let contentLength = knownLength;
		if (contentLength === undefined) {
			const text = header(headers, "content-length")?.trim();
			const value = text !== undefined && CONTENT_LENGTH.test(text) ? Number(text) : Number.NaN;
			if (!Number.isSafeInteger(value)) {
				return yield* Result.fail({ expected: "a Content-Length header", received: text ?? "none" });
			}
			contentLength = value;
		}
		const modifiedText = header(headers, "last-modified");
		let lastModified: DateTime.Utc | undefined;
		if (modifiedText !== undefined) {
			const parsed = parseHttpDate(modifiedText);
			if (Option.isNone(parsed)) {
				return yield* Result.fail({ expected: "an HTTP-date Last-Modified header", received: modifiedText });
			}
			lastModified = parsed.value;
		}
		const contentType = header(headers, "content-type");
		const versionId = header(headers, "x-amz-version-id");
		return S3ObjectHead.make({
			key,
			etag,
			contentLength,
			metadata: metadataOf(headers),
			...(contentType === undefined ? {} : { contentType }),
			...(lastModified === undefined ? {} : { lastModified }),
			...(versionId === undefined ? {} : { versionId }),
		});
	});
