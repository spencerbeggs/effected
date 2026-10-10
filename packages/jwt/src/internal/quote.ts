// Untrusted strings (a token header's `alg` or `kid`, a remote JWK's `use`)
// reach `JwtError.detail` and `JwtError.kid` and, through them, logs. Cap
// their length so a megabyte header cannot flood a log line, and quote them
// as JSON in prose so newlines and terminal escapes are escaped.

/** The default cap, for values that are short when legitimate (`alg`, `use`, `iss`). */
const defaultLimit = 32;

/**
 * The cap for a `kid`: long enough that real key ids (GitHub's are 36-character
 * UUIDs) appear whole, still bounded.
 *
 * @internal
 */
export const kidLimit = 128;

/** An untrusted string cut to at most `limit` characters plus an ellipsis. @internal */
export const capped = (value: string, limit: number = defaultLimit): string =>
	value.length > limit ? `${value.slice(0, limit)}…` : value;

/** A JSON-quoted, length-capped rendering of an untrusted string. @internal */
export const quote = (value: string, limit: number = defaultLimit): string => JSON.stringify(capped(value, limit));
