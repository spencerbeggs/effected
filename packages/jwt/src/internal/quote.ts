// Untrusted strings (a token header's `alg` or `kid`, a remote JWK's `use`)
// reach `JwtError.detail` and `JwtError.kid` and, through them, logs. Cap
// their length so a megabyte header cannot flood a log line, and quote them
// as JSON in prose so newlines and terminal escapes are escaped.

const limit = 32;

/** An untrusted string cut to at most 32 characters plus an ellipsis. @internal */
export const capped = (value: string): string => (value.length > limit ? `${value.slice(0, limit)}…` : value);

/** A JSON-quoted, length-capped rendering of an untrusted string. @internal */
export const quote = (value: string): string => JSON.stringify(capped(value));
