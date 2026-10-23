import { RegisteredClaims } from "@effected/jwt";
import { Schema } from "effect";

/**
 * The claims of an OpenID Connect ID token: RFC 7519's registered claims
 * plus the ID-token claims OpenID Connect Core 1.0 §2 adds.
 *
 * @remarks
 * Every claim is optional, so the schema decodes any provider's token, and
 * the schema is open: claims it does not name survive the decode. A
 * provider's own claims belong in a caller-supplied schema passed to
 * {@link (Oidc:class).verify} or {@link (Oidc:class).decodeUnverified},
 * not in a subclass here. `@effected/github`'s `ActionsOidcClaims` is one.
 *
 * Optional here does not mean optional in a verified token:
 * {@link (Oidc:class).verify} still requires `exp` and checks `iss`, `aud`,
 * `nbf` and `iat` whatever schema the payload is then decoded with.
 *
 * @public
 */
export const IdTokenClaims = Schema.StructWithRest(
	Schema.Struct({
		...RegisteredClaims.schema.fields,
		/** Authorized party: the client the token was issued to, when it differs from the audience. */
		azp: Schema.optionalKey(Schema.String),
		/** The value the client sent in its authentication request, echoed back to bind the token to it. */
		nonce: Schema.optionalKey(Schema.String),
		/** When the end user authenticated, in seconds since the epoch. */
		auth_time: Schema.optionalKey(Schema.Finite),
		/** Authentication context class reference. */
		acr: Schema.optionalKey(Schema.String),
		/** Authentication method references, e.g. `pwd` or `mfa`. */
		amr: Schema.optionalKey(Schema.Array(Schema.String)),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * A decoded {@link (IdTokenClaims:variable)}.
 *
 * @public
 */
export type IdTokenClaims = typeof IdTokenClaims.Type;
