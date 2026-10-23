import { JwksResolver, Jws, Jwt, JwtError } from "@effected/jwt";
import type { Duration } from "effect";
import { Effect, Schema } from "effect";

/**
 * Options for {@link (Oidc:class).verify}.
 *
 * @typeParam S - The schema the verified payload is decoded with.
 *
 * @public
 */
export interface OidcVerifyOptions<S extends Schema.Constraint> {
	/**
	 * The issuer the token must come from. Its keys are discovered from
	 * `<issuer>/.well-known/openid-configuration` and `iss` must equal it.
	 */
	readonly issuer: string;
	/**
	 * The audience the token must have been minted for, or any of several.
	 * Required and non-empty: an OIDC issuer's one key set signs tokens for
	 * every relying party, so without an audience check a token minted for
	 * any of them would verify.
	 */
	readonly audience: string | ReadonlyArray<string>;
	/** The schema the payload is decoded with once every check has passed; `IdTokenClaims` for the standard set. */
	readonly claims: S;
	/** Allowed clock skew for `exp`, `nbf` and `iat`; 60 seconds by default. */
	readonly clockTolerance?: Duration.Input | undefined;
}

const audiences = (audience: string | ReadonlyArray<string>): ReadonlyArray<string> =>
	typeof audience === "string" ? [audience] : audience;

const decodeUnverified = Effect.fn("Oidc.decodeUnverified")(function* <S extends Schema.Constraint>(
	token: string,
	claims: S,
) {
	const { payload } = yield* Effect.fromResult(Jws.decodeUnverified(token));
	return yield* Schema.decodeUnknownEffect(claims)(payload).pipe(
		Effect.mapError(
			(cause) => new JwtError({ reason: "claims", detail: "the payload does not match the expected claims", cause }),
		),
	);
});

const verify = Effect.fn("Oidc.verify")(function* <S extends Schema.Constraint>(
	token: string,
	options: OidcVerifyOptions<S>,
) {
	const expected = audiences(options.audience);
	yield* Effect.annotateCurrentSpan({ issuer: options.issuer, audience: expected.join(" ") });
	// An empty audience, or an empty string among several, would accept a
	// token minted for no particular relying party; refused before the token
	// is even split, so no key is ever fetched for it.
	if (expected.length === 0 || expected.some((value) => value.length === 0)) {
		return yield* new JwtError({
			reason: "wrongAudience",
			detail: "no audience was given; an OIDC token is never verified without one",
		});
	}
	return yield* Jwt.verify(token, {
		// The key is always looked up for the configured issuer, never for the
		// token's own `iss`: the issuer decides which keys are trusted.
		key: JwksResolver.forIssuer(options.issuer),
		claims: options.claims,
		issuer: options.issuer,
		audience: expected,
		...(options.clockTolerance !== undefined ? { clockTolerance: options.clockTolerance } : {}),
	});
});

/**
 * Read and verify OpenID Connect ID tokens.
 *
 * @remarks
 * Both operations fail with `@effected/jwt`'s `JwtError` and add no error of
 * their own; route on its `reason`, never on its message.
 *
 * @example
 * ```ts
 * import { JwksResolver } from "@effected/jwt";
 * import { IdTokenClaims, Oidc } from "@effected/oidc";
 * import { Effect } from "effect";
 *
 * const program = Oidc.verify("eyJ...", {
 *   issuer: "https://accounts.example.com",
 *   audience: "my-client-id",
 *   claims: IdTokenClaims,
 * });
 *
 * // JwksResolver.layer needs an HttpClient and a JwksStore, provided once at the edge.
 * export const main = program.pipe(Effect.provide(JwksResolver.layer));
 * ```
 *
 * @public
 */
export class Oidc {
	private constructor() {}

	/**
	 * Decode a token's payload with `claims` **without verifying it**.
	 *
	 * @remarks
	 * `Jws.decodeUnverified` plus a schema decode. No signature, issuer,
	 * audience or time check runs, as the name says. For reading a token this
	 * process was handed by a runtime it already trusts, never for
	 * authorizing anything: the result is whatever the token's author wrote.
	 *
	 * Fails as `malformed` when the token is not a compact JWS with a JOSE
	 * header, and as `claims` when the payload does not decode.
	 *
	 * @public
	 */
	static readonly decodeUnverified: <S extends Schema.Constraint>(
		token: string,
		claims: S,
	) => Effect.Effect<S["Type"], JwtError, S["DecodingServices"]> = decodeUnverified;

	/**
	 * Verify an ID token from `options.issuer` and decode its payload with
	 * `options.claims`.
	 *
	 * @remarks
	 * `Jwt.verify` keyed through `JwksResolver.forIssuer(options.issuer)`:
	 * the signature against the issuer's discovered JWKS, then `exp`, `nbf`,
	 * `iat`, `iss` and `aud`, then the schema decode. An empty audience, or an
	 * empty string among several, fails as `wrongAudience` before anything
	 * else, with no network call.
	 *
	 * The key is always looked up for the configured issuer, never for the
	 * token's own `iss`, so a token naming another issuer is never checked
	 * against that issuer's keys.
	 *
	 * @public
	 */
	static readonly verify: <S extends Schema.Constraint>(
		token: string,
		options: OidcVerifyOptions<S>,
	) => Effect.Effect<S["Type"], JwtError, JwksResolver | S["DecodingServices"]> = verify;
}
