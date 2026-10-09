import { Clock, Duration, Effect, Schema } from "effect";
import { quote } from "./internal/quote.js";
import type { DecodedJws, JoseHeader } from "./Jws.js";
import { Jws } from "./Jws.js";
import { JwtError } from "./JwtError.js";
import type { SigningKey, VerificationKey } from "./JwtKey.js";

/** A NumericDate (RFC 7519 §2): seconds since the epoch, finite, fractions allowed. */
const NumericDate = Schema.Finite;

/**
 * The registered claims of RFC 7519 §4.1, as {@link (Jwt:variable).verify}
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
 * Options for {@link (Jwt:variable).verify}.
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
	/** The accepted issuer, or any of several; `iss` must equal one. */
	readonly issuer?: string | ReadonlyArray<string>;
	/** The accepted audience, or any of several; `aud` must contain one. */
	readonly audience?: string | ReadonlyArray<string>;
	/** Allowed clock skew for `exp`, `nbf` and `iat`; 60 seconds by default. */
	readonly clockTolerance?: Duration.Input;
	/** Whether a token without `exp` is refused (as `claims`); `true` by default. */
	readonly requireExpiry?: boolean;
}

const defaultTolerance = Duration.seconds(60);

const decodeRegistered = Schema.decodeUnknownEffect(RegisteredClaims);

const asList = (value: string | ReadonlyArray<string>): ReadonlyArray<string> =>
	typeof value === "string" ? [value] : value;

const checkClaims = (
	claims: RegisteredClaims,
	nowSeconds: number,
	options: VerifyOptions<Schema.Constraint, unknown>,
	extra: { readonly kid?: string } | undefined,
): Effect.Effect<void, JwtError> => {
	const tolerance = Math.max(0, Duration.toMillis(options.clockTolerance ?? defaultTolerance) / 1000);
	if (claims.exp === undefined) {
		if (options.requireExpiry ?? true) return Effect.fail(JwtError.of("claims", "the token has no exp", extra));
	} else if (nowSeconds - tolerance >= claims.exp) {
		return Effect.fail(JwtError.of("expired", `the token expired at ${claims.exp}`, extra));
	}
	if (claims.nbf !== undefined && nowSeconds + tolerance < claims.nbf) {
		return Effect.fail(JwtError.of("notYetValid", `the token is not valid before ${claims.nbf}`, extra));
	}
	if (claims.iat !== undefined && nowSeconds + tolerance < claims.iat) {
		return Effect.fail(JwtError.of("notYetValid", `the token was issued in the future, at ${claims.iat}`, extra));
	}
	if (options.issuer !== undefined) {
		const iss = claims.iss;
		if (iss === undefined || !asList(options.issuer).includes(iss)) {
			const got = iss === undefined ? "no iss" : `iss ${quote(iss)}`;
			return Effect.fail(JwtError.of("wrongIssuer", `the token has ${got}, which is not an accepted issuer`, extra));
		}
	}
	if (options.audience !== undefined) {
		const expected = asList(options.audience);
		const aud = claims.aud === undefined ? [] : asList(claims.aud);
		if (!aud.some((value) => expected.includes(value))) {
			const got =
				claims.aud === undefined
					? "no aud"
					: typeof claims.aud === "string"
						? `aud ${quote(claims.aud)}`
						: `${aud.length} aud values`;
			return Effect.fail(
				JwtError.of("wrongAudience", `the token has ${got}, none of them an accepted audience`, extra),
			);
		}
	}
	return Effect.void;
};

const verify = <S extends Schema.Constraint, R = never>(
	token: string,
	options: VerifyOptions<S, R>,
): Effect.Effect<S["Type"], JwtError, R | S["DecodingServices"]> =>
	Effect.gen(function* () {
		const { header, payload }: DecodedJws = yield* Jws.verify(token, options.key);
		const extra = header.kid !== undefined ? { kid: header.kid } : undefined;
		const registered = yield* Effect.mapError(decodeRegistered(payload), (cause) =>
			JwtError.of("claims", "the payload is not a JSON object of registered claims", { ...extra, cause }),
		);
		const nowSeconds = (yield* Clock.currentTimeMillis) / 1000;
		yield* checkClaims(registered, nowSeconds, options, extra);
		return yield* Effect.mapError(Schema.decodeUnknownEffect(options.claims)(payload), (cause) =>
			JwtError.of("claims", "the payload does not match the expected claims", { ...extra, cause }),
		);
	}).pipe(Effect.withSpan("Jwt.verify"));

/**
 * Sign and verify JWTs (RFC 7519): a {@link (Jws:variable)} whose payload is
 * a claims object, verified against the clock and the expected issuer and
 * audience.
 *
 * @public
 */
export const Jwt: {
	/**
	 * Sign a claims object as a JWT; {@link (Jws:variable).sign} under the
	 * JWT name.
	 */
	readonly sign: (
		claims: object,
		key: SigningKey,
		header?: Readonly<Record<string, unknown>>,
	) => Effect.Effect<string, JwtError>;
	/**
	 * Verify a JWT and decode its payload with `options.claims`.
	 *
	 * @remarks
	 * The signature is checked first ({@link (Jws:variable).verify}); then, in
	 * order: the payload decodes as {@link (RegisteredClaims:variable)}
	 * (`claims`); `exp` is present unless `requireExpiry` is `false`
	 * (`claims`) and `now - tolerance < exp` (`expired`); `now + tolerance >=
	 * nbf` and `>= iat` (`notYetValid`); `iss` is an accepted issuer
	 * (`wrongIssuer`); `aud` contains an accepted audience, a missing `aud`
	 * failing when one is expected (`wrongAudience`); and finally the payload
	 * decodes with `options.claims` (`claims`). Time is `Clock`'s, in seconds,
	 * so `TestClock` drives it; the tolerance is 60 seconds by default.
	 *
	 * A token string is not a unique identifier: ES256 signatures are
	 * malleable, so one signed payload can have two valid token strings. Key
	 * replay detection, deduplication and revocation on verified claims
	 * (`jti`, or `iss` with `sub` and `iat`), never on the token text.
	 */
	readonly verify: <S extends Schema.Constraint, R = never>(
		token: string,
		options: VerifyOptions<S, R>,
	) => Effect.Effect<S["Type"], JwtError, R | S["DecodingServices"]>;
} = {
	sign: (claims, key, header) => Jws.sign(claims, key, header),
	verify,
};
