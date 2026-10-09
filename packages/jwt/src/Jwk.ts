import { Schema } from "effect";

/**
 * A JSON Web Key (RFC 7517) for an RSA or EC key.
 *
 * @remarks
 * The schema is open: members it does not name (`x5c`, `x5t`, `key_ops`,
 * `ext` and the rest) survive decoding and encoding unchanged, so a key read
 * from a JWKS can be handed on without losing anything. Symmetric keys
 * (`kty: "oct"`) are out of scope and fail to decode.
 *
 * The private exponent `d` decodes to a `Redacted` string, so a decoded
 * private JWK never prints its secret; encoding unwraps it back to the
 * JSON string.
 *
 * @public
 */
export const Jwk = Schema.StructWithRest(
	Schema.Struct({
		/** Key type: `RSA` or `EC`. */
		kty: Schema.Literals(["RSA", "EC"]),
		/** Key id, matched against a token header's `kid`. */
		kid: Schema.optionalKey(Schema.String),
		/** The algorithm the key is meant for, e.g. `RS256` or `ES256`. */
		alg: Schema.optionalKey(Schema.String),
		/** Intended use, e.g. `sig`. */
		use: Schema.optionalKey(Schema.String),
		/** RSA modulus, base64url. */
		n: Schema.optionalKey(Schema.String),
		/** RSA public exponent, base64url. */
		e: Schema.optionalKey(Schema.String),
		/** EC curve, e.g. `P-256`. */
		crv: Schema.optionalKey(Schema.String),
		/** EC x coordinate, base64url. */
		x: Schema.optionalKey(Schema.String),
		/** EC y coordinate, base64url. */
		y: Schema.optionalKey(Schema.String),
		/** Private exponent (RSA) or scalar (EC), base64url; redacted once decoded. */
		d: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.d" })),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * A decoded {@link (Jwk:variable)}.
 *
 * @public
 */
export type Jwk = typeof Jwk.Type;

/**
 * A JSON Web Key Set: the document a JWKS endpoint serves.
 *
 * @public
 */
export const Jwks = Schema.Struct({
	/** The keys in the set. */
	keys: Schema.Array(Jwk),
});

/**
 * A decoded {@link (Jwks:variable)}.
 *
 * @public
 */
export type Jwks = typeof Jwks.Type;
