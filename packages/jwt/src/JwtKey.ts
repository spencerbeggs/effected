import { Effect, Redacted } from "effect";
import { KeyFormat, Signature } from "effect/crypto";
import { Jwk as CoreJwk } from "effect/jose";
import { isAsymmetricAlgorithm, kidOf, toJwtError, toPublicJwk, unsupportedAlgorithm } from "./internal/jose.js";
import { quote } from "./internal/quote.js";
import type { Jwk } from "./Jwk.js";
import { JwtError } from "./JwtError.js";

/**
 * The signature algorithms this package signs and verifies with: every
 * asymmetric JWS algorithm core `effect/jose` implements (`RS256`-`RS512`,
 * `PS256`-`PS512`, `ES256`-`ES512` and `EdDSA` over Ed25519).
 *
 * @remarks
 * HMAC (`HS256`, ...) is deliberately absent: a key published in a key set
 * must never select a shared secret. Use core `Jwk.importSecret` for one.
 * `none` is not representable.
 *
 * @public
 */
export type JwtAlgorithm = CoreJwk.AsymmetricAlgorithm;

/**
 * A private key that signs, bound to the one algorithm it was imported for.
 *
 * @remarks
 * This is core `effect/jose`'s `Jwk.PrivateKey`, so a key from
 * {@link (JwtKey:class)} signs through core `Jws.sign` and `Jwt.sign` as
 * well. Its material is held by core's `Signature.PrivateKey`, which redacts
 * itself when printed.
 *
 * @public
 */
export type SigningKey = CoreJwk.PrivateKey;

/**
 * A public key that verifies, bound to the one algorithm it was imported for.
 *
 * @remarks
 * This is core `effect/jose`'s `Jwk.PublicKey`. Verification takes the
 * algorithm from this key, never from the token header.
 *
 * @public
 */
export type VerificationKey = CoreJwk.PublicKey;

const isRsa = (alg: JwtAlgorithm): boolean => alg.startsWith("RS") || alg.startsWith("PS");

const pemLabel = /^-----BEGIN ([A-Z0-9 ]+)-----/;

const fromPkcs8Pem = Effect.fn("JwtKey.fromPkcs8Pem")(function* (
	pem: Redacted.Redacted<string>,
	options: { readonly alg: JwtAlgorithm; readonly kid?: string },
) {
	const extra = kidOf(options.kid);
	const keyOptions = options.kid !== undefined ? { kid: options.kid } : undefined;
	// A two-character escaped newline (backslash, `n`) is read as a newline
	// first: keys often arrive in a one-line environment variable, and core's
	// PEM reader takes real newlines only. A backslash cannot occur in PEM
	// armour or base64, so this never changes a well-formed key.
	const text = Redacted.value(pem).replace(/\\n/g, "\n").trim();
	const label = pemLabel.exec(text)?.[1];
	if (label === undefined) return yield* JwtError.of("key", "the key is not a single PEM block", extra);
	// Core drops the backend cause of a private-key failure, which may
	// describe the key, so only its description is kept.
	const fail = (error: Parameters<typeof toJwtError>[0]) => JwtError.of("key", toJwtError(error).detail, extra);
	if (label === "PRIVATE KEY") {
		return yield* CoreJwk.importPkcs8(Redacted.make(text), options.alg, keyOptions).pipe(Effect.mapError(fail));
	}
	if (label === "RSA PRIVATE KEY" && isRsa(options.alg)) {
		// PKCS#1 (what github.com hands out for App keys): core reads it and
		// re-encodes it as PKCS#8, which carries no hash, so any RSA reading
		// serves; the import then binds the requested algorithm and checks the
		// 2048-bit floor.
		const der = yield* KeyFormat.decodePrivate(KeyFormat.pem(KeyFormat.pkcs1), Signature.rsaPkcs1v15Sha256, text).pipe(
			Effect.flatMap((key) => KeyFormat.encode(KeyFormat.pkcs8, key)),
			Effect.mapError(() => JwtError.of("key", "the RSA PRIVATE KEY PEM block does not import", extra)),
		);
		return yield* CoreJwk.importPkcs8(Redacted.make(der), options.alg, keyOptions).pipe(Effect.mapError(fail));
	}
	return yield* JwtError.of("key", `a ${label} PEM block cannot be imported as an ${options.alg} signing key`, extra);
});

const fromJwk = Effect.fn("JwtKey.fromJwk")(function* (jwk: Jwk, options?: { readonly alg?: JwtAlgorithm }) {
	const extra = kidOf(jwk.kid);
	if (jwk.use !== undefined && jwk.use !== "sig") {
		return yield* JwtError.of("key", `the JWK is for use ${quote(jwk.use)}, not "sig"`, extra);
	}
	const keyOps = jwk.key_ops;
	if (keyOps !== undefined && !(Array.isArray(keyOps) && keyOps.includes("verify"))) {
		return yield* JwtError.of("key", "the JWK's key_ops does not include verify", extra);
	}
	if (jwk.alg !== undefined && !isAsymmetricAlgorithm(jwk.alg)) {
		return yield* unsupportedAlgorithm(
			`the JWK names ${quote(jwk.alg)}; only asymmetric JWS algorithms are supported`,
			extra?.kid,
		);
	}
	if (jwk.alg !== undefined && options?.alg !== undefined && jwk.alg !== options.alg) {
		return yield* JwtError.of("algorithmMismatch", `the JWK names ${jwk.alg} but ${options.alg} was required`, extra);
	}
	const alg = jwk.alg ?? options?.alg;
	if (alg === undefined) return yield* JwtError.of("key", "the JWK names no algorithm", extra);
	return yield* CoreJwk.importPublic(toPublicJwk(jwk), alg).pipe(
		Effect.mapError((error) =>
			JwtError.of("key", `the JWK does not import as an ${alg} key: ${toJwtError(error).detail}`, {
				...extra,
				cause: error,
			}),
		),
	);
});

const generate = Effect.fn("JwtKey.generate")(function* (alg: JwtAlgorithm, options?: { readonly kid?: string }) {
	const kid = options?.kid;
	const pair = yield* CoreJwk.generateKeyPair({ algorithm: alg, ...(kid !== undefined ? { kid } : {}) });
	const signing = yield* CoreJwk.importPrivate(pair.privateKey, alg);
	const verification = yield* CoreJwk.importPublic(pair.publicKey, alg);
	const jwk: Jwk = pair.publicKey;
	return { signing, verification, jwk };
}, Effect.mapError(toJwtError));

/**
 * Importers and a generator for {@link SigningKey} and {@link VerificationKey}.
 *
 * @remarks
 * Every import runs in core `effect/jose` / `effect/crypto`. What this class
 * adds over core's `Jwk` importers is the PEM forms core does not take
 * directly, and the `JwtError` routing keys.
 *
 * @public
 */
export class JwtKey {
	private constructor() {}

	/**
	 * Import a PEM private key as a signing key for `alg`.
	 *
	 * @remarks
	 * Accepts PKCS#8 (`BEGIN PRIVATE KEY`) for any algorithm, and PKCS#1
	 * (`BEGIN RSA PRIVATE KEY`, what github.com hands out for App keys) for
	 * the RSA algorithms (`RS*`, `PS*`); core converts PKCS#1 to PKCS#8
	 * in-process, so it imports on any WebCrypto runtime. Newlines may arrive
	 * escaped as the two characters backslash and `n`, the one-line form an
	 * environment variable carries. Any other block, an RSA key under 2048
	 * bits, or a body that does not import is `key`, and the failure never
	 * echoes the key. The PEM is unwrapped here and nowhere else.
	 *
	 * Needs no service: core imports on the WebCrypto reference.
	 *
	 * @public
	 */
	static readonly fromPkcs8Pem: (
		pem: Redacted.Redacted<string>,
		options: { readonly alg: JwtAlgorithm; readonly kid?: string },
	) => Effect.Effect<SigningKey, JwtError> = fromPkcs8Pem;

	/**
	 * Import the public half of a JWK as a verification key.
	 *
	 * @remarks
	 * The algorithm is the JWK's `alg`, else `options.alg`; neither is `key`.
	 * An `alg` outside {@link JwtAlgorithm} is `unsupportedAlgorithm`, and a
	 * JWK `alg` that differs from `options.alg` is `algorithmMismatch`. A JWK
	 * whose type or curve cannot carry the algorithm, whose `use` is not
	 * `sig`, whose `key_ops` does not include `verify`, whose key members are
	 * not canonical base64url, that is an RSA key under 2048 bits, or that
	 * does not import is `key`. Private members are dropped, never unwrapped.
	 *
	 * @public
	 */
	static readonly fromJwk: (
		jwk: Jwk,
		options?: { readonly alg?: JwtAlgorithm },
	) => Effect.Effect<VerificationKey, JwtError> = fromJwk;

	/**
	 * Generate a fresh key pair and its public JWK; for tests.
	 *
	 * @remarks
	 * Core `Jwk.generateKeyPair`: RSA keys are 2048-bit with exponent 65537.
	 * Requires core's `Signature` service (`Signature.layerWebCrypto`, which
	 * itself needs `SecureRandom.layerWebCrypto`).
	 *
	 * @public
	 */
	static readonly generate: (
		alg: JwtAlgorithm,
		options?: { readonly kid?: string },
	) => Effect.Effect<
		{ readonly signing: SigningKey; readonly verification: VerificationKey; readonly jwk: Jwk },
		JwtError,
		Signature.Signature
	> = generate;
}
