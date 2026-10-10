import { Effect, Result, Schema } from "effect";
import { isAlgorithm, signParams, unsupportedAlgorithm } from "./internal/algorithms.js";
import { appendSignature, joinCompact, splitCompact } from "./internal/segments.js";
import { subtle, toArrayBuffer } from "./internal/subtle.js";
import { JwtError } from "./JwtError.js";
import type { SigningKey, VerificationKey } from "./JwtKey.js";

/**
 * A JOSE header (RFC 7515 §4) as this package reads it.
 *
 * @remarks
 * The header must be a JSON object with a string `alg`, read as an own
 * property only. The schema is open, so other members survive. `crit`
 * (§4.1.11) names extensions the recipient must understand; this package
 * understands none, so a header carrying `crit` fails to decode.
 *
 * @public
 */
export const JoseHeader = Schema.StructWithRest(
	Schema.Struct({
		/** The algorithm the token claims; checked against the key's, never trusted. */
		alg: Schema.String,
		/** Key id, used to pick the verification key. */
		kid: Schema.optionalKey(Schema.String),
		/** Media type, `JWT` by default when signing. */
		typ: Schema.optionalKey(Schema.String),
		/** Critical extensions; none are understood, so any value is refused. */
		crit: Schema.optionalKey(Schema.Never),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

/**
 * A decoded {@link (JoseHeader:variable)}.
 *
 * @public
 */
export type JoseHeader = typeof JoseHeader.Type;

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

const decodeHeader = Schema.decodeUnknownResult(JoseHeader);

const headerOf = (value: unknown): Result.Result<JoseHeader, JwtError> =>
	Result.mapError(decodeHeader(value), (cause) =>
		JwtError.of("malformed", "the header is not a JOSE header (a JSON object with a string alg and no crit)", {
			cause,
		}),
	);

const decodeUnverified = (token: string): Result.Result<DecodedJws, JwtError> =>
	Result.flatMap(splitCompact(token), (parts) =>
		Result.map(headerOf(parts.header), (header) => ({ header, payload: parts.payload })),
	);

const encoder = new TextEncoder();

const sign = Effect.fn("Jws.sign")(function* (
	payload: unknown,
	key: SigningKey,
	header?: Readonly<Record<string, unknown>>,
) {
	const candidate = {
		...header,
		alg: key.alg,
		typ: header?.typ ?? "JWT",
		...(key.kid !== undefined ? { kid: key.kid } : {}),
	};
	// Emit only what `verify` would accept back.
	const checked = yield* Effect.fromResult(headerOf(candidate));
	const { signingInput } = yield* Effect.fromResult(joinCompact(checked, payload));
	const crypto = yield* subtle;
	const signature = yield* Effect.tryPromise({
		try: () => crypto.sign(signParams(key.alg), key.key, toArrayBuffer(encoder.encode(signingInput))),
		catch: (cause) => JwtError.of("key", `the ${key.alg} key could not sign`, { cause }),
	});
	return appendSignature(signingInput, new Uint8Array(signature));
});

const verify = <R = never>(
	token: string,
	key: VerificationKey | ((header: JoseHeader) => Effect.Effect<VerificationKey, JwtError, R>),
): Effect.Effect<DecodedJws, JwtError, R> =>
	Effect.gen(function* () {
		const parts = yield* Effect.fromResult(splitCompact(token));
		const header = yield* Effect.fromResult(headerOf(parts.header));
		// Decided before any key is resolved, so a token naming an algorithm
		// this package does not implement (none, HS256, ...) never triggers a
		// key lookup such as a JWKS fetch.
		if (!isAlgorithm(header.alg)) return yield* unsupportedAlgorithm(header.alg);
		// `typeof`, not `instanceof`: a key built by a second copy of this
		// package (a duplicated dependency) is still a key, not a function.
		const resolved = typeof key === "function" ? yield* key(header) : key;
		const extra = resolved.kid !== undefined ? { kid: resolved.kid } : undefined;
		// The algorithm is the key's; the header's is only compared against it,
		// so an HS256 or other foreign header never selects a different check.
		if (header.alg !== resolved.alg) {
			return yield* JwtError.of(
				"algorithmMismatch",
				`the token claims ${header.alg} but the key is ${resolved.alg}`,
				extra,
			);
		}
		const crypto = yield* subtle;
		const valid = yield* Effect.tryPromise({
			try: () =>
				crypto.verify(
					signParams(resolved.alg),
					resolved.key,
					toArrayBuffer(parts.signature),
					toArrayBuffer(parts.signingInput),
				),
			catch: (cause) => JwtError.of("key", `the ${resolved.alg} key could not verify`, { ...extra, cause }),
		});
		if (!valid) return yield* JwtError.of("badSignature", "the signature does not verify", extra);
		return { header, payload: parts.payload };
	}).pipe(Effect.withSpan("Jws.verify"));

/**
 * Sign and verify compact JWS (RFC 7515) with `RS256` or `ES256`.
 *
 * @public
 */
export const Jws: {
	/**
	 * Sign `payload` as a compact JWS.
	 *
	 * @remarks
	 * The header is `header` with `alg` set to the key's algorithm (a
	 * caller-supplied `alg` is overwritten), `typ` defaulting to `JWT`, and
	 * `kid` set from the key when it has one. A header `verify` would refuse
	 * (a `crit`, a non-string `typ` or `kid`) or a payload JSON cannot
	 * represent (a BigInt, a cycle, `undefined`) is `malformed`.
	 */
	readonly sign: (
		payload: unknown,
		key: SigningKey,
		header?: Readonly<Record<string, unknown>>,
	) => Effect.Effect<string, JwtError>;
	/**
	 * Verify a compact JWS and return its header and payload.
	 *
	 * @remarks
	 * `key` is a {@link VerificationKey} or a function from the decoded header
	 * to one (for a JWKS lookup by `kid`). The checks run in order: the token
	 * splits and its header decodes (`malformed`); a header `alg` other than
	 * `RS256` or `ES256` (`none`, `HS256`, ...) is `unsupportedAlgorithm` and no
	 * key is resolved; the header's `alg` must equal the key's
	 * (`algorithmMismatch`, and no other algorithm is tried);
	 * the signature must verify (`badSignature`). The algorithm is always the
	 * key's, never the header's.
	 *
	 * A token string is not a unique identifier. ES256 signatures are
	 * malleable: wherever `(r, s)` verifies, `(r, n - s)` does too, so one
	 * signed payload has two valid token strings, and rejecting either would
	 * break interop with ES256 issuers. Key replay detection, deduplication
	 * and revocation on verified claims (`jti`, or `iss` with `sub` and
	 * `iat`), never on the token text.
	 */
	readonly verify: <R = never>(
		token: string,
		key: VerificationKey | ((header: JoseHeader) => Effect.Effect<VerificationKey, JwtError, R>),
	) => Effect.Effect<DecodedJws, JwtError, R>;
	/**
	 * Decode a compact JWS's header and payload **without verifying it**.
	 *
	 * @remarks
	 * For routing only: reading `iss` or `kid` to decide which key or issuer
	 * to verify against. The result is attacker-controlled and authorizes
	 * nothing; pass the token to {@link (Jws:variable).verify} before acting
	 * on any claim.
	 */
	readonly decodeUnverified: (token: string) => Result.Result<DecodedJws, JwtError>;
} = { sign, verify, decodeUnverified };
