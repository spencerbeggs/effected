import { Clock, Duration, Effect, Schema } from "effect";
import type { Signature } from "effect/crypto";
import { Jwks as CoreJwks, Jwt as CoreJwt } from "effect/jose";
import { asymmetricAlgorithms, keySetFor, kidOf, makeState, toJwtError, toleranceSeconds } from "./internal/jose.js";
import type { JoseHeader } from "./Jws.js";
import { Jws } from "./Jws.js";
import { JwtError } from "./JwtError.js";
import type { SigningKey, VerificationKey } from "./JwtKey.js";

/** A NumericDate (RFC 7519 §2): seconds since the epoch, finite, fractions allowed. */
const NumericDate = Schema.Finite;

/**
 * The registered claims of RFC 7519 §4.1, as {@link (Jwt:class).verify}
 * checks them.
 *
 * @remarks
 * Open: other claims survive and are left to the caller's own schema. The
 * time claims are finite numbers of seconds (`NaN`, `Infinity` or a string
 * fail to decode), and `aud` is a string or an array of strings.
 *
 * @public
 */
export const RegisteredClaims = Schema.StructWithRest(
	Schema.Struct({
		/** Issuer. */
		iss: Schema.optionalKey(Schema.String),
		/** Subject. */
		sub: Schema.optionalKey(Schema.String),
		/** Audience: one value or several. */
		aud: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
		/** Expiry, in seconds since the epoch. */
		exp: Schema.optionalKey(NumericDate),
		/** Not before, in seconds since the epoch. */
		nbf: Schema.optionalKey(NumericDate),
		/** Issued at, in seconds since the epoch. */
		iat: Schema.optionalKey(NumericDate),
		/** Token id. */
		jti: Schema.optionalKey(Schema.String),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * A decoded {@link (RegisteredClaims:variable)}.
 *
 * @public
 */
export type RegisteredClaims = typeof RegisteredClaims.Type;

/**
 * Options for {@link (Jwt:class).verify}.
 *
 * @typeParam S - The schema the verified payload is decoded with.
 * @typeParam R - Services the key resolver requires.
 *
 * @public
 */
export interface VerifyOptions<S extends Schema.Constraint, R = never> {
	/** The verification key, or a function from the decoded header to one (for a JWKS lookup). */
	readonly key: VerificationKey | ((header: JoseHeader) => Effect.Effect<VerificationKey, JwtError, R>);
	/** The schema the payload is decoded with once every check has passed. */
	readonly claims: S;
	/**
	 * The accepted issuer, or any of several; `iss` must equal one.
	 *
	 * @remarks
	 * Omitted, `iss` is not checked, and a token from any issuer the key
	 * serves is accepted.
	 */
	readonly issuer?: string | ReadonlyArray<string>;
	/**
	 * The accepted audience, or any of several; `aud` must contain one.
	 *
	 * @remarks
	 * Omitted, `aud` is not checked, and a token minted for any audience the
	 * key serves is accepted. That is dangerous with a shared issuer such as
	 * GitHub Actions OIDC, whose one JWKS signs tokens for every relying
	 * party: always pass the audience you expect.
	 */
	readonly audience?: string | ReadonlyArray<string>;
	/**
	 * Allowed clock skew for `exp`, `nbf` and `iat`; 60 seconds by default.
	 * A number is milliseconds. A negative, infinite or unparseable tolerance
	 * fails as `claims`.
	 */
	readonly clockTolerance?: Duration.Input;
	/** Whether a token without `exp` is refused (as `claims`); `true` by default. */
	readonly requireExpiry?: boolean;
}

const defaultTolerance = Duration.seconds(60);

const verify = <S extends Schema.Constraint, R = never>(
	token: string,
	options: VerifyOptions<S, R>,
): Effect.Effect<S["Type"], JwtError, R | S["DecodingServices"] | Signature.Signature> =>
	Effect.gen(function* () {
		const state = makeState();
		const keySet = yield* keySetFor(options.key, state);
		const tolerance = options.clockTolerance ?? defaultTolerance;
		const verified = yield* CoreJwt.verifyWithKeySet(options.claims, token, {
			algorithms: asymmetricAlgorithms,
			issuer: options.issuer,
			audience: options.audience,
			clockTolerance: tolerance,
			...((options.requireExpiry ?? true) ? { requiredClaims: ["exp"] as const } : {}),
		}).pipe(
			Effect.provideService(CoreJwks.Jwks, keySet),
			Effect.mapError((error) =>
				// Core reads the claims only once the signature has verified, so an
				// `InvalidToken` after a key resolved is the payload, not the token.
				!Schema.isSchemaError(error) && error.reason._tag === "InvalidToken" && state.resolved !== undefined
					? JwtError.of("claims", "the payload is not a JSON object of registered claims", {
							...kidOf(state.resolved.kid ?? state.kid),
							cause: error,
						})
					: toJwtError(error, state),
			),
		);
		// Core checks `iat` only under `maxTokenAge`; a token issued in the
		// future is refused here whatever the age policy.
		const iat = verified.registeredClaims.iat;
		const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
		if (iat !== undefined && iat > nowSeconds + toleranceSeconds(tolerance)) {
			return yield* JwtError.of(
				"notYetValid",
				`the token was issued in the future, at ${iat}`,
				kidOf(verified.protectedHeader.kid),
			);
		}
		return verified.claims;
	}).pipe(Effect.withSpan("Jwt.verify"));

/**
 * Sign and verify JWTs (RFC 7519): a {@link (Jws:class)} whose payload is
 * a claims object, verified against the clock and the expected issuer and
 * audience.
 *
 * @public
 */
export class Jwt {
	private constructor() {}

	/**
	 * Sign a claims object as a JWT; {@link (Jws:class).sign} under the
	 * JWT name.
	 *
	 * @public
	 */
	static readonly sign: (
		claims: Readonly<Record<string, unknown>>,
		key: SigningKey,
		header?: Readonly<Record<string, unknown>>,
	) => Effect.Effect<string, JwtError, Signature.Signature> = Jws.sign;

	/**
	 * Verify a JWT and decode its payload with `options.claims`.
	 *
	 * @remarks
	 * Core `effect/jose`'s `Jwt.verifyWithKeySet` runs every check, with this
	 * package's defaults on top. The signature is checked first, exactly as
	 * {@link (Jws:class).verify} checks it, then the claims, in this order:
	 *
	 * - the payload is a JSON object, else `claims`;
	 * - each registered claim present has its {@link (RegisteredClaims:variable)} type, else `claims`;
	 * - `exp` is present unless `requireExpiry` is `false`, else `claims`;
	 * - `iss` is an accepted issuer, else `wrongIssuer` (a missing `iss` fails when one is expected);
	 * - `aud` contains an accepted audience, else `wrongAudience` (a missing `aud` fails when one is expected);
	 * - the token has not expired (`exp > now - tolerance`), else `expired`;
	 * - `nbf` is not in the future (`nbf <= now + tolerance`), else `notYetValid`;
	 * - the payload decodes with `options.claims`, else `claims`;
	 * - `iat` is not in the future (`iat <= now + tolerance`), else `notYetValid`.
	 *
	 * `now` is `Clock`'s time in whole seconds, so `TestClock` drives it; the
	 * tolerance is 60 seconds by default (core's own default is zero). Requires
	 * core's `Signature` service, plus whatever the key resolver requires.
	 *
	 * A token string is not a unique identifier: ECDSA signatures are
	 * malleable, so one signed payload can have two valid token strings. Key
	 * replay detection, deduplication and revocation on verified claims
	 * (`jti`, or `iss` with `sub` and `iat`), never on the token text.
	 *
	 * @public
	 */
	static readonly verify: <S extends Schema.Constraint, R = never>(
		token: string,
		options: VerifyOptions<S, R>,
	) => Effect.Effect<S["Type"], JwtError, R | S["DecodingServices"] | Signature.Signature> = verify;
}
