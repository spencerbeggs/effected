import { Option, Schema } from "effect";

/**
 * One object in a listing: a `Contents` entry of a `ListBucketResult`.
 *
 * @public
 */
export class S3ObjectSummary extends Schema.Class<S3ObjectSummary>("S3ObjectSummary")({
	/** The object key. */
	key: Schema.String,
	/** The size in bytes. */
	size: Schema.Number,
	/** When the object was last written. */
	lastModified: Schema.DateTimeUtc,
	/** The ETag, quotes included. */
	etag: Schema.optionalKey(Schema.String),
	/** The storage class, such as `STANDARD`. */
	storageClass: Schema.optionalKey(Schema.String),
}) {}

/**
 * One page of a ListObjectsV2 answer.
 *
 * @remarks
 * Construction refuses a page whose `isTruncated` disagrees with
 * `nextContinuationToken`: a truncated page with no token would stop a caller
 * half-way through a listing, and the client fails such an answer as
 * `S3MalformedResponse` rather than build one.
 *
 * @public
 */
export class S3ListPage extends Schema.Class<S3ListPage>("S3ListPage")(
	Schema.Struct({
		/** The objects on this page, in the store's order (UTF-8 binary order on S3). */
		keys: Schema.Array(S3ObjectSummary),
		/** The common prefixes a `delimiter` rolled up, each with its trailing delimiter. */
		commonPrefixes: Schema.Array(Schema.String),
		/** Whether another page follows. */
		isTruncated: Schema.Boolean,
		/** The token for the next page: `Option.some` exactly when `isTruncated`. */
		nextContinuationToken: Schema.Option(Schema.String),
	}).check(
		Schema.makeFilter(
			(page) =>
				page.isTruncated === Option.isSome(page.nextContinuationToken) ||
				"a page carries a continuation token exactly when it is truncated",
		),
	),
) {}
