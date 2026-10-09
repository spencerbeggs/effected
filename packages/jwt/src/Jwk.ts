import { Option, Schema, SchemaGetter } from "effect";

/**
 * A JSON Web Key (RFC 7517) for an RSA or EC key.
 *
 * @remarks
 * The schema is open: members it does not name (`x5c`, `x5t`, `key_ops`,
 * `ext` and the rest) survive decoding and encoding unchanged, so a key read
 * from a JWKS can be handed on without losing anything. Symmetric keys
 * (`kty: "oct"`) are out of scope and fail to decode.
 *
 * Every private member, `d` and the RSA CRT members `p`, `q`, `dp`, `dq`
 * and `qi`, decodes to a `Redacted` string, so a decoded private JWK never
 * prints its secret; encoding unwraps them back to JSON strings. Multi-prime
 * RSA keys (`oth`) are out of scope and fail to decode.
 *
 * The open index signature also applies at the type level: a misspelled
 * member such as `kd` for `kid` still typechecks, so do not rely on the type
 * to catch one.
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
		/** RSA first prime factor, base64url; redacted once decoded. */
		p: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.p" })),
		/** RSA second prime factor, base64url; redacted once decoded. */
		q: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.q" })),
		/** RSA first factor CRT exponent, base64url; redacted once decoded. */
		dp: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.dp" })),
		/** RSA second factor CRT exponent, base64url; redacted once decoded. */
		dq: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.dq" })),
		/** RSA first CRT coefficient, base64url; redacted once decoded. */
		qi: Schema.optionalKey(Schema.RedactedFromValue(Schema.String, { label: "jwk.qi" })),
		/** Multi-prime RSA factors; out of scope, so any value fails to decode. */
		oth: Schema.optionalKey(Schema.Never),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * A decoded {@link (Jwk:variable)}.
 *
 * @public
 */
export type Jwk = typeof Jwk.Type;

const isSupported = (key: unknown): key is typeof Jwk.Encoded => Option.isSome(Schema.decodeUnknownOption(Jwk)(key));

/**
 * A JSON Web Key Set: the document a JWKS endpoint serves.
 *
 * @remarks
 * Decoding keeps only the keys that decode as a {@link (Jwk:variable)} and
 * drops the rest (an unknown `kty`, a symmetric `oct` key, a malformed
 * member), as RFC 7517 §5 asks, so one unsupported key never fails the whole
 * set. A dropped key is gone: encoding round-trips the supported keys only.
 *
 * @public
 */
export const Jwks = Schema.Struct({
	/** The supported keys in the set. */
	keys: Schema.Array(Schema.Unknown).pipe(
		Schema.decodeTo(Schema.Array(Jwk), {
			decode: SchemaGetter.transform((keys) => keys.filter(isSupported)),
			encode: SchemaGetter.passthroughSubtype(),
		}),
	),
});

/**
 * A decoded {@link (Jwks:variable)}.
 *
 * @public
 */
export type Jwks = typeof Jwks.Type;
