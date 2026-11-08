import { Schema } from "effect";

/**
 * What a successful `put` answers.
 *
 * @public
 */
export class S3PutResult extends Schema.Class<S3PutResult>("S3PutResult")({
	/** The new object's ETag, quotes included, as the store sent it: pass it to `ifMatch` unchanged. */
	etag: Schema.String,
	/** The version id, on a versioned bucket. */
	versionId: Schema.optionalKey(Schema.String),
}) {}

/**
 * An object's metadata, as `head` answers it.
 *
 * @remarks
 * `metadata` holds the `x-amz-meta-*` headers, names lower-cased and the prefix
 * removed. `contentType` and `lastModified` are optional because a proxy can drop
 * either header; S3 and R2 send both.
 *
 * @public
 */
export class S3ObjectHead extends Schema.Class<S3ObjectHead>("S3ObjectHead")({
	/** The object key. */
	key: Schema.String,
	/** The ETag, quotes included, as the store sent it. */
	etag: Schema.String,
	/** The size in bytes, from `Content-Length`. */
	contentLength: Schema.Number,
	/** The `x-amz-meta-*` headers, names lower-cased, without the prefix. */
	metadata: Schema.Record(Schema.String, Schema.String),
	/** The `Content-Type` header. */
	contentType: Schema.optionalKey(Schema.String),
	/** The `Last-Modified` header. */
	lastModified: Schema.optionalKey(Schema.DateTimeUtc),
	/** The `x-amz-version-id` header, on a versioned bucket. */
	versionId: Schema.optionalKey(Schema.String),
}) {}

/**
 * An object and its metadata, as `get` answers it.
 *
 * @remarks
 * For a ranged `get`, `body` is the requested range, `contentLength` its size and
 * `contentRange` the `Content-Range` header (`bytes 0-9/1234`).
 *
 * @public
 */
export class S3Object extends Schema.Class<S3Object>("S3Object")({
	...S3ObjectHead.fields,
	/** The object's bytes, or the requested range of them. */
	body: Schema.Uint8Array,
	/** The `Content-Range` header of a ranged `get`. */
	contentRange: Schema.optionalKey(Schema.String),
}) {
	/** The body decoded as UTF-8, with any invalid sequence replaced by U+FFFD. */
	get text(): string {
		return new TextDecoder().decode(this.body);
	}
}
