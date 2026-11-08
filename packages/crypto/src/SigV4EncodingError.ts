import { Schema } from "effect";

/**
 * A SigV4 request component holds a lone UTF-16 surrogate, so it cannot be
 * percent-encoded or signed.
 *
 * @remarks
 * Such a string has no UTF-8 form: `encodeURIComponent` throws on it, and a
 * `TextEncoder` would silently substitute U+FFFD, signing bytes the caller
 * never sent. `component` names where it sits (`method`, `host`, `path`,
 * `query-key`, `query-value`, `header-name` or `header-value`) and `subject` the query key or header name it
 * belongs to, when there is one. This is caller input, not a wiring defect:
 * recover with `Effect.catchTag("SigV4EncodingError", ...)`.
 * `SigV4.canonicalize` and `SigV4.sign` raise it before anything is hashed or
 * signed.
 *
 * @public
 */
export class SigV4EncodingError extends Schema.TaggedError<SigV4EncodingError>()("SigV4EncodingError", {
	/** Which part of the request holds the ill-formed string. */
	component: Schema.Literals(["method", "host", "path", "query-key", "query-value", "header-name", "header-value"]),
	/** The query key or header name the value belongs to; absent for the method, host, path, a key and a header name themselves. */
	subject: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const of = this.subject === undefined ? "" : ` of "${this.subject}"`;
		return `the SigV4 ${this.component}${of} holds a lone UTF-16 surrogate, so it cannot be encoded or signed`;
	}
}
