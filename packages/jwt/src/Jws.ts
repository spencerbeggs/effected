import { Effect, Redacted, Result, Schema } from "effect";
import type { Signature } from "effect/crypto";
import { Jwks as CoreJwks, Jws as CoreJws, Jwt as CoreJwt } from "effect/jose";
import { fatalUtf8 } from "./internal/bytes.js";
import { asymmetricAlgorithms, keySetFor, makeState, toJwtError } from "./internal/jose.js";
import { JwtError } from "./JwtError.js";
import type { SigningKey, VerificationKey } from "./JwtKey.js";

/**
 * A JOSE protected header (RFC 7515 §4): core `effect/jose`'s
 * `Jws.ProtectedHeader`.
 *
 * @remarks
 * A JSON object whose `alg` is a JWS algorithm core knows, with optional
 * string `kid`, `typ` and `cty`; other members must be JSON and survive.
 * A header carrying `crit` or `b64` is refused when a token is read, because
 * those change how a token is processed.
 *
 * @public
 */
export const JoseHeader: typeof CoreJws.ProtectedHeader = CoreJws.ProtectedHeader;

/**
 * A decoded {@link (JoseHeader:variable)}.
 *
 * @public
 */
export type JoseHeader = CoreJws.ProtectedHeader;

/**
 * The header and payload of a compact JWS.
 *
 * @public
 */
export interface DecodedJws {
	/** The decoded JOSE header. */
	readonly header: JoseHeader;
	/** The decoded JSON payload. */
	readonly payload: unknown;
}

const isJoseHeader = Schema.is(CoreJws.ProtectedHeader);

const parseJson = (bytes: Uint8Array): Result.Result<unknown, JwtError> => {
	try {
		return Result.succeed(JSON.parse(fatalUtf8.decode(bytes)) as unknown);
	} catch (cause) {
		return Result.fail(JwtError.of("malformed", "the payload is not UTF-8 JSON", { cause }));
	}
};

// Core's unverified reader is pure, so it runs synchronously here to keep this
// a `Result`; it reads a JWT, so the payload must be a JSON object.
const decodeUnverified = (token: string): Result.Result<DecodedJws, JwtError> =>
	Effect.runSync(
		Effect.result(
			Effect.mapBoth(CoreJwt.decodeUnverified(token), {
				onFailure: (error) => toJwtError(error),
				onSuccess: ({ protectedHeader, claims }): DecodedJws => ({ header: protectedHeader, payload: claims }),
			}),
		),
	);

const sign = Effect.fn("Jws.sign")(function* (
	payload: unknown,
	key: SigningKey,
	header?: Readonly<Record<string, unknown>>,
) {
	const { alg: _ignored, ...rest } = header ?? {};
	// `typ` defaults to `JWT`; the key's `kid` wins over a caller's.
	const fields: Record<string, unknown> = {
		...rest,
		typ: header?.typ ?? "JWT",
		...(key.kid !== undefined ? { kid: key.kid } : {}),
	};
	// Emit only what `verify` would accept back.
	if (
		Object.hasOwn(fields, "crit") ||
		Object.hasOwn(fields, "b64") ||
		!isJoseHeader({ ...fields, alg: key.algorithm })
	) {
		return yield* JwtError.of("malformed", "the header is not a JOSE header verify would accept");
	}
	let json: string | undefined;
	try {
		json = JSON.stringify(payload);
	} catch (cause) {
		return yield* JwtError.of("malformed", "the payload is not representable as JSON", { cause });
	}
	if (json === undefined) return yield* JwtError.of("malformed", "the payload is not representable as JSON");
	const token = yield* CoreJws.sign(new TextEncoder().encode(json), key, fields as CoreJws.Header).pipe(
		Effect.mapError((error) => toJwtError(error)),
	);
	return Redacted.value(token);
});

const verify = <R = never>(
	token: string,
	key: VerificationKey | ((header: JoseHeader) => Effect.Effect<VerificationKey, JwtError, R>),
): Effect.Effect<DecodedJws, JwtError, R | Signature.Signature> =>
	Effect.gen(function* () {
		const state = makeState();
		const keySet = yield* keySetFor(key, state);
		const verified = yield* CoreJws.verifyWithKeySet(token, { algorithms: asymmetricAlgorithms }).pipe(
			Effect.provideService(CoreJwks.Jwks, keySet),
			Effect.mapError((error) => toJwtError(error, state)),
		);
		const payload = yield* Effect.fromResult(parseJson(verified.payload));
		return { header: verified.protectedHeader, payload };
	}).pipe(Effect.withSpan("Jws.verify"));

/**
 * Sign and verify compact JWS (RFC 7515) with any asymmetric algorithm core
 * `effect/jose` implements.
 *
 * @remarks
 * A thin layer over core `Jws`: core parses, checks the algorithm and runs
 * the signature; this class adds a JSON payload, a `typ: "JWT"` default, a
 * key-resolver function and `JwtError` routing. Signing and verifying
 * require core's `Signature` service.
 *
 * @public
 */
export class Jws {
	private constructor() {}

	/**
	 * Sign `payload` (JSON-encoded) as a compact JWS.
	 *
	 * @remarks
	 * The header is `header` with `alg` set to the key's algorithm (a
	 * caller-supplied `alg` is overwritten), `typ` defaulting to `JWT`, and
	 * `kid` set from the key when it has one. A header `verify` would refuse
	 * (a `crit` or `b64`, a non-string `typ` or `kid`, a non-JSON member) or a
	 * payload JSON cannot represent (a BigInt, a cycle, `undefined`) is
	 * `malformed`.
	 *
	 * @public
	 */
	static readonly sign: (
		payload: unknown,
		key: SigningKey,
		header?: Readonly<Record<string, unknown>>,
	) => Effect.Effect<string, JwtError, Signature.Signature> = sign;

	/**
	 * Verify a compact JWS and return its header and payload.
	 *
	 * @remarks
	 * `key` is a {@link VerificationKey} or a function from the decoded header
	 * to one (for a JWKS lookup by `kid`). Core runs the checks in order: the
	 * token splits into canonical base64url segments and its header decodes
	 * (`malformed`, which includes `alg: "none"` and any algorithm core does
	 * not know); an HMAC `alg` is `unsupportedAlgorithm` and no key is
	 * resolved; the header's `alg` must equal the key's (`algorithmMismatch`,
	 * and no other algorithm is tried); the signature must verify
	 * (`badSignature`). The payload must then be UTF-8 JSON (`malformed`). A
	 * resolver's own failure passes through unchanged.
	 *
	 * A token string is not a unique identifier. ECDSA signatures are
	 * malleable: wherever `(r, s)` verifies, `(r, n - s)` does too, so one
	 * signed payload has two valid token strings. Key replay detection,
	 * deduplication and revocation on verified claims (`jti`, or `iss` with
	 * `sub` and `iat`), never on the token text.
	 *
	 * @public
	 */
	static readonly verify: <R = never>(
		token: string,
		key: VerificationKey | ((header: JoseHeader) => Effect.Effect<VerificationKey, JwtError, R>),
	) => Effect.Effect<DecodedJws, JwtError, R | Signature.Signature> = verify;

	/**
	 * Decode a compact JWT's header and payload **without verifying it**.
	 *
	 * @remarks
	 * Core `Jwt.decodeUnverified`, as a synchronous `Result`: the header must
	 * decode as for {@link (Jws:class).verify} and the payload must be a JSON
	 * object, else `malformed`. For routing only: reading `iss` or `kid` to
	 * decide which key or issuer to verify against. The result is
	 * attacker-controlled and authorizes nothing.
	 *
	 * @public
	 */
	static readonly decodeUnverified: (token: string) => Result.Result<DecodedJws, JwtError> = decodeUnverified;
}
