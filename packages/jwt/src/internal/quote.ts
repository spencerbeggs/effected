// Untrusted strings (a token header's `alg`, a remote JWK's `use`) reach
// `JwtError.detail` and, through `message`, logs. Quote them as JSON so
// newlines and terminal escapes are escaped, and cap their length so a
// megabyte header cannot flood a log line.

const limit = 32;

/** A JSON-quoted, length-capped rendering of an untrusted string. @internal */
export const quote = (value: string): string =>
	JSON.stringify(value.length > limit ? `${value.slice(0, limit)}…` : value);
