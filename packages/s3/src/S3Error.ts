import { Schema } from "effect";

/**
 * The operation an S3 error came from.
 *
 * @public
 */
export const S3Operation = Schema.Literals(["put", "get", "head", "delete", "list"]);

/**
 * The operation an S3 error came from: `put`, `get`, `head`, `delete` or `list`.
 *
 * @public
 */
export type S3Operation = typeof S3Operation.Type;

const subject = (operation: S3Operation, bucket: string, key: string): string =>
	operation === "list"
		? `S3 list of "${key}" in bucket "${bucket}"`
		: `S3 ${operation} of "${key}" in bucket "${bucket}"`;

/**
 * The object does not exist: a `404` to a `get` or `head`.
 *
 * @remarks
 * A `get` reads as this only when the `404` carries an `<Error>` document whose
 * `Code` is `NoSuchKey`, which S3, R2 and MinIO always send. Any other `404` to a
 * `get` (`NoSuchBucket`, an HTML page from a proxy, plain text, an empty body) is
 * {@link S3RequestFailed}: a missing bucket or a misrouted endpoint must not read
 * as a missing object. A `head` answer carries no body, so every `404` to a
 * `head`, including one for a missing bucket, is this error.
 *
 * @public
 */
export class S3NotFound extends Schema.TaggedError<S3NotFound>()("S3NotFound", {
	/** The operation that was answered `404`. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key. */
	key: Schema.String,
}) {
	/** A sentence naming the operation, bucket and key. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)}: no such object`;
	}
}

/**
 * The object still matches the `ifNoneMatch` ETag a `get` sent: a `304`.
 *
 * @public
 */
export class S3NotModified extends Schema.TaggedError<S3NotModified>()("S3NotModified", {
	/** Always `get`: the only operation that sends `If-None-Match` and reads a body. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key. */
	key: Schema.String,
	/** The ETag the store answered with, quotes included, when it sent one. */
	etag: Schema.optionalKey(Schema.String),
}) {
	/** A sentence naming the key and, when known, the unchanged ETag. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)}: not modified${this.etag === undefined ? "" : ` (ETag ${this.etag})`}`;
	}
}

/**
 * A conditional `put` lost: a `412`.
 *
 * @remarks
 * `ifNoneMatch: "*"` loses when an object already holds the key, which is exactly
 * the first-write-wins case; `ifMatch` loses when the object changed.
 *
 * A conditional write that races another write to the same key can also lose as
 * {@link S3ConditionalConflict} (a `409`) instead: the condition was never
 * evaluated, so the write may still win. A first-write-wins caller handles both:
 * retry on `S3ConditionalConflict`, and treat `S3PreconditionFailed` as "another
 * writer already holds the key". Catching this error alone reads a lost race as an
 * infrastructure failure.
 *
 * @public
 */
export class S3PreconditionFailed extends Schema.TaggedError<S3PreconditionFailed>()("S3PreconditionFailed", {
	/** Always `put`: the only operation that sends a write condition. */
	operation: Schema.Literal("put"),
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key. */
	key: Schema.String,
}) {
	/** A sentence naming the key. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)}: precondition failed`;
	}
}

/**
 * A conditional `put` raced another write to the same key: a `409` whose `<Error>`
 * document's `Code` is `ConditionalRequestConflict`. Retry the write.
 *
 * @remarks
 * AWS documents this answer for a conditional write (`ifNoneMatch` or `ifMatch`)
 * that overlaps a concurrent write, or a delete, of the same key, and says to retry
 * the upload: unlike {@link S3PreconditionFailed}, the condition did not lose, it
 * was not decided. The client does not retry on its own (no method does); compose
 * `Effect.retry` at the call site with a schedule that backs off, so the write still
 * in flight can land before the next attempt, for example
 * `Effect.retry({ while: (error) => error._tag === "S3ConditionalConflict", schedule: Schedule.exponential("100 millis"), times: 3 })`.
 * An immediate retry is likely to meet the same conflict.
 * A retried `ifNoneMatch: "*"` write that then finds the key taken fails as
 * `S3PreconditionFailed`, which is the first-write-wins answer. A `409` with any
 * other `Code`, or with no error document, stays {@link S3RequestFailed}.
 *
 * @public
 */
export class S3ConditionalConflict extends Schema.TaggedError<S3ConditionalConflict>()("S3ConditionalConflict", {
	/** Always `put`: the only operation that sends a write condition. */
	operation: Schema.Literal("put"),
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key. */
	key: Schema.String,
}) {
	/** A sentence naming the key and saying to retry. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)}: conflicted with a concurrent write; retry the write`;
	}
}

/**
 * The store answered with a status the operation does not accept.
 *
 * @remarks
 * `code`, `s3Message` and `requestId` come from the `<Error>` document when the body
 * was one, and are absent otherwise (a `HEAD` carries no body; a proxy answers with
 * HTML). `s3Message` is the store's own text, passed through `HttpRedaction.text`.
 * A `200` whose body is an `<Error>` document is this error with `status` `200`.
 *
 * @public
 */
export class S3RequestFailed extends Schema.TaggedError<S3RequestFailed>()("S3RequestFailed", {
	/** The operation that failed. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key, or the prefix for a listing. */
	key: Schema.String,
	/** The HTTP status. */
	status: Schema.Number,
	/** The `<Error>` document's `Code`, such as `AccessDenied` or `NoSuchBucket`. */
	code: Schema.optionalKey(Schema.String),
	/** The `<Error>` document's `Message`. */
	s3Message: Schema.optionalKey(Schema.String),
	/** The `<Error>` document's `RequestId`, for the store's support. */
	requestId: Schema.optionalKey(Schema.String),
}) {
	/** A sentence naming the status and, when known, the store's code, message and request id. */
	override get message(): string {
		const code = this.code === undefined ? "" : ` (${this.code})`;
		const text = this.s3Message === undefined ? "" : `: ${this.s3Message}`;
		const request = this.requestId === undefined ? "" : ` [request ${this.requestId}]`;
		return `${subject(this.operation, this.bucket, this.key)} failed with status ${this.status}${code}${text}${request}`;
	}
}

/**
 * The store answered, but not with what the operation reads.
 *
 * @remarks
 * A listing whose root is not `ListBucketResult` (an HTML page, an empty body, text
 * that is not XML), a page missing an element its meaning depends on, or a
 * successful `put`, `get` or `head` without the ETag the result carries. Never an
 * empty listing: an answer the client cannot read is a failure. `cause` is the XML
 * decoder's error when there was one.
 *
 * @public
 */
export class S3MalformedResponse extends Schema.TaggedError<S3MalformedResponse>()("S3MalformedResponse", {
	/** The operation whose answer could not be read. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key, or the prefix for a listing. */
	key: Schema.String,
	/** The HTTP status of the answer. */
	status: Schema.Number,
	/** What the client expected, such as `a ListBucketResult document`. */
	expected: Schema.String,
	/** What it found instead, such as `a root element <html>`. */
	received: Schema.String,
	/** The XML decoder's error, when the body did not decode. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	/** A sentence naming what was expected and what was received. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)}: expected ${this.expected}, received ${this.received} (status ${this.status})`;
	}
}

/**
 * The request did not complete: the connection failed, or the body could not be read.
 *
 * @remarks
 * `cause` is the `HttpClientError` through `HttpRedaction.cause`: core's error keeps
 * the live request, the SigV4 `authorization` and session token included, as
 * readable fields, and the redacted copy keeps neither.
 *
 * @public
 */
export class S3TransportError extends Schema.TaggedError<S3TransportError>()("S3TransportError", {
	/** The operation that did not complete. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key, or the prefix for a listing. */
	key: Schema.String,
	/** The redacted client error. */
	cause: Schema.Defect(),
}) {
	/** A sentence naming the operation. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)} did not complete`;
	}
}

/**
 * Why a request was refused before it was signed.
 *
 * @public
 */
export const S3InvalidRequestReason = Schema.Literals([
	"empty-key",
	"key-too-long",
	"dot-segment",
	"malformed-unicode",
	"metadata-name",
	"metadata-duplicate",
	"header-value",
	"max-keys",
]);

/**
 * Why a request was refused before it was signed: `empty-key`, `key-too-long`
 * (over 1024 UTF-8 bytes), `dot-segment` (a `.` or `..` path segment, which a URL
 * collapses), `malformed-unicode` (a key, listing option or string body holding a
 * lone UTF-16 surrogate, which has no UTF-8 encoding: a key or option cannot be
 * percent-encoded or signed, and a body would be stored with U+FFFD in its place), `metadata-name` (not an HTTP token), `metadata-duplicate` (two
 * names that differ only in case, which would be one header), `header-value` (a character
 * outside printable US-ASCII) or `max-keys` (not an integer from 1 to 1000).
 *
 * @public
 */
export type S3InvalidRequestReason = typeof S3InvalidRequestReason.Type;

/** One rule per reason; a `Record` so a reason added without a rule fails to compile. */
const INVALID_REQUEST_RULES: Readonly<Record<S3InvalidRequestReason, string>> = {
	"empty-key": "the key is empty",
	"key-too-long": "the key is longer than 1024 UTF-8 bytes",
	"dot-segment": 'the key has a "." or ".." segment, which a URL collapses',
	"malformed-unicode": "the value holds a lone UTF-16 surrogate, which cannot be encoded or signed",
	"metadata-name": "the metadata name is not an HTTP token",
	"metadata-duplicate": "two metadata names differ only in case and would be one header",
	"header-value": "the value holds a character outside printable US-ASCII",
	"max-keys": "maxKeys must be an integer from 1 to 1000",
};

/**
 * The caller's input cannot be sent: nothing was signed or sent.
 *
 * @public
 */
export class S3InvalidRequest extends Schema.TaggedError<S3InvalidRequest>()("S3InvalidRequest", {
	/** The operation that was refused. */
	operation: S3Operation,
	/** The bucket the client is bound to. */
	bucket: Schema.String,
	/** The object key, or the prefix for a listing. */
	key: Schema.String,
	/** Which rule the input broke. */
	reason: S3InvalidRequestReason,
	/** The option or header that broke it: `key`, `body`, `maxKeys`, `range`, `metadata.<name>` and so on. */
	field: Schema.String,
}) {
	/** A sentence naming the field and the rule. */
	override get message(): string {
		return `${subject(this.operation, this.bucket, this.key)} refused: ${this.field}: ${INVALID_REQUEST_RULES[this.reason]}`;
	}
}

/**
 * Every error an {@link S3Client} operation can raise.
 *
 * @public
 */
export type S3Error =
	| S3NotFound
	| S3NotModified
	| S3PreconditionFailed
	| S3ConditionalConflict
	| S3RequestFailed
	| S3MalformedResponse
	| S3TransportError
	| S3InvalidRequest;

/**
 * What `put` can raise. No `S3NotFound`: a put creates the object.
 *
 * @public
 */
export type S3PutError =
	| S3PreconditionFailed
	| S3ConditionalConflict
	| S3RequestFailed
	| S3MalformedResponse
	| S3TransportError
	| S3InvalidRequest;

/**
 * What `get` can raise. No `S3PreconditionFailed`: a get sends no `If-Match`, and
 * `If-None-Match` answers `304`.
 *
 * @public
 */
export type S3GetError =
	| S3NotFound
	| S3NotModified
	| S3RequestFailed
	| S3MalformedResponse
	| S3TransportError
	| S3InvalidRequest;

/**
 * What `head` can raise. No `S3NotModified`: a head sends no conditional header.
 *
 * @public
 */
export type S3HeadError = S3NotFound | S3RequestFailed | S3MalformedResponse | S3TransportError | S3InvalidRequest;

/**
 * What `delete` can raise. No `S3NotFound`: deleting a missing object succeeds, as
 * it does on S3. No `S3MalformedResponse`: a delete reads nothing from a success.
 *
 * @public
 */
export type S3DeleteError = S3RequestFailed | S3TransportError | S3InvalidRequest;

/**
 * What `list` and `listAll` can raise.
 *
 * @public
 */
export type S3ListError = S3RequestFailed | S3MalformedResponse | S3TransportError | S3InvalidRequest;
