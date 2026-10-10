import { Effect, Redacted, Result } from "effect";
import { generateParams, importParams, isAlgorithm } from "./internal/algorithms.js";
import { pemBody, wrapPkcs1 } from "./internal/der.js";
import { quote } from "./internal/quote.js";
import { subtle, toArrayBuffer } from "./internal/subtle.js";
import type { Jwk } from "./Jwk.js";
import { JwtError } from "./JwtError.js";

/**
 * The signature algorithms this package supports: RSASSA-PKCS1-v1_5 with
 * SHA-256, and ECDSA over P-256 with SHA-256. `none` is not representable.
 *
 * @public
 */
export type JwtAlgorithm = "RS256" | "ES256";

/** The public JWK members WebCrypto's `importKey("jwk", ...)` is given; structural, as `JsonWebKey` is not global everywhere. */
interface PublicJwk {
	readonly kty: "RSA" | "EC";
	readonly n?: string;
	readonly e?: string;
	readonly crv?: string;
	readonly x?: string;
	readonly y?: string;
}

/**
 * A private key that signs, bound to the one algorithm it was imported for.
 *
 * @remarks
 * Created only by {@link (JwtKey:variable)}. The `CryptoKey` is not
 * extractable, so the key material cannot be read back out.
 *
 * @public
 */
export class SigningKey {
	/** @internal */
	static make(alg: JwtAlgorithm, kid: string | undefined, key: CryptoKey): SigningKey {
		return new SigningKey(alg, kid, key);
	}

	private constructor(
		/** The algorithm this key signs with. */
		readonly alg: JwtAlgorithm,
		/** The key id written into a token header's `kid`, when there is one. */
		readonly kid: string | undefined,
		/** The WebCrypto key, usable for `sign` only. */
		readonly key: CryptoKey,
	) {}
}

/**
 * A public key that verifies, bound to the one algorithm it was imported for.
 *
 * @remarks
 * Created only by {@link (JwtKey:variable)}. Verification takes the
 * algorithm from this key, never from the token header.
 *
 * @public
 */
export class VerificationKey {
	/** @internal */
	static make(alg: JwtAlgorithm, kid: string | undefined, key: CryptoKey): VerificationKey {
		return new VerificationKey(alg, kid, key);
	}

	private constructor(
		/** The algorithm this key verifies. */
		readonly alg: JwtAlgorithm,
		/** The key id matched against a token header's `kid`, when there is one. */
		readonly kid: string | undefined,
		/** The WebCrypto key, usable for `verify` only. */
		readonly key: CryptoKey,
	) {}
}

const importKey = (
	material:
		| { readonly format: "pkcs8"; readonly data: ArrayBuffer }
		| { readonly format: "jwk"; readonly data: PublicJwk },
	alg: JwtAlgorithm,
	usage: "sign" | "verify",
	extra: { readonly kid: string } | undefined,
): Effect.Effect<CryptoKey, JwtError> =>
	Effect.flatMap(subtle, (crypto) =>
		Effect.tryPromise({
			try: () =>
				material.format === "jwk"
					? crypto.importKey("jwk", material.data, importParams(alg), true, [usage])
					: crypto.importKey("pkcs8", material.data, importParams(alg), false, [usage]),
			catch: (cause) =>
				JwtError.of("key", `the key does not import as an ${alg} ${material.format} key`, { ...extra, cause }),
		}),
	).pipe(Effect.flatMap((key) => checkStrength(key, alg, extra)));

/** RFC 7518 §3.3: an RS256 key MUST be 2048 bits or larger. */
const minimumRsaModulusLength = 2048;

// Both importers pass through here, so neither can bind a short RSA key.
// WebCrypto reports an RSA key's size on `algorithm.modulusLength`.
const checkStrength = (
	key: CryptoKey,
	alg: JwtAlgorithm,
	extra: { readonly kid: string } | undefined,
): Effect.Effect<CryptoKey, JwtError> => {
	if (alg !== "RS256") return Effect.succeed(key);
	const { modulusLength } = key.algorithm as { readonly modulusLength?: unknown };
	return typeof modulusLength === "number" && modulusLength >= minimumRsaModulusLength
		? Effect.succeed(key)
		: Effect.fail(
				JwtError.of(
					"key",
					`RS256 needs an RSA key of at least ${minimumRsaModulusLength} bits, got ${String(modulusLength)}`,
					extra,
				),
			);
};

const fromPkcs8Pem = Effect.fn("JwtKey.fromPkcs8Pem")(function* (
	pem: Redacted.Redacted<string>,
	options: { readonly alg: JwtAlgorithm; readonly kid?: string },
) {
	const { label, der } = yield* Effect.fromResult(pemBody(Redacted.value(pem)));
	let pkcs8: Uint8Array;
	if (label === "PRIVATE KEY") {
		pkcs8 = der;
	} else if (label === "RSA PRIVATE KEY" && options.alg === "RS256") {
		pkcs8 = wrapPkcs1(der);
	} else {
		return yield* JwtError.of("key", `a ${label} PEM block cannot be imported as an ${options.alg} signing key`);
	}
	const key = yield* importKey(
		{ format: "pkcs8", data: toArrayBuffer(pkcs8) },
		options.alg,
		"sign",
		options.kid !== undefined ? { kid: options.kid } : undefined,
	);
	return SigningKey.make(options.alg, options.kid, key);
});

// The public members WebCrypto needs, and nothing else: private members are
// `Redacted` in `Jwk` and are never unwrapped here, and members such as
// `key_ops` or `ext` could make an otherwise valid import fail.
const publicJwk = (
	jwk: Jwk,
	alg: JwtAlgorithm,
	extra: { readonly kid: string } | undefined,
): Result.Result<PublicJwk, JwtError> => {
	const fail = (detail: string) => Result.fail(JwtError.of("key", detail, extra));
	if (alg === "RS256") {
		if (jwk.kty !== "RSA") return fail(`an ${jwk.kty} JWK cannot carry RS256`);
		if (jwk.n === undefined || jwk.e === undefined) return fail("the RSA JWK lacks n or e");
		return Result.succeed({ kty: "RSA", n: jwk.n, e: jwk.e });
	}
	if (jwk.kty !== "EC") return fail(`an ${jwk.kty} JWK cannot carry ES256`);
	if (jwk.crv !== "P-256") return fail("ES256 needs a P-256 JWK");
	if (jwk.x === undefined || jwk.y === undefined) return fail("the EC JWK lacks x or y");
	return Result.succeed({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });
};

const fromJwk = Effect.fn("JwtKey.fromJwk")(function* (jwk: Jwk, options?: { readonly alg?: JwtAlgorithm }) {
	const extra = jwk.kid !== undefined ? { kid: jwk.kid } : undefined;
	if (jwk.use !== undefined && jwk.use !== "sig") {
		return yield* JwtError.of("key", `the JWK is for use ${quote(jwk.use)}, not "sig"`, extra);
	}
	const keyOps = jwk.key_ops;
	if (keyOps !== undefined && !(Array.isArray(keyOps) && keyOps.includes("verify"))) {
		return yield* JwtError.of("key", "the JWK's key_ops does not include verify", extra);
	}
	if (jwk.alg !== undefined && !isAlgorithm(jwk.alg)) {
		return yield* JwtError.of(
			"unsupportedAlgorithm",
			`the JWK names ${quote(jwk.alg)}; only RS256 and ES256 are supported`,
			extra,
		);
	}
	if (jwk.alg !== undefined && options?.alg !== undefined && jwk.alg !== options.alg) {
		return yield* JwtError.of("algorithmMismatch", `the JWK names ${jwk.alg} but ${options.alg} was required`, extra);
	}
	const alg = jwk.alg ?? options?.alg;
	if (alg === undefined) return yield* JwtError.of("key", "the JWK names no algorithm", extra);
	const material = yield* Effect.fromResult(publicJwk(jwk, alg, extra));
	const key = yield* importKey({ format: "jwk", data: material }, alg, "verify", extra);
	return VerificationKey.make(alg, jwk.kid, key);
});

const generate = Effect.fn("JwtKey.generate")(function* (alg: JwtAlgorithm, options?: { readonly kid?: string }) {
	const crypto = yield* subtle;
	// `extractable: false` binds the private key; WebCrypto always makes the
	// public half of a generated pair extractable, which `exportKey` needs.
	const pair = yield* Effect.tryPromise({
		try: () => crypto.generateKey(generateParams(alg), false, ["sign", "verify"]),
		catch: (cause) => JwtError.of("key", `an ${alg} key pair could not be generated`, { cause }),
	});
	const exported = yield* Effect.tryPromise({
		try: () => crypto.exportKey("jwk", pair.publicKey),
		catch: (cause) => JwtError.of("key", `the ${alg} public key could not be exported`, { cause }),
	});
	const kid = options?.kid;
	const common = { alg, use: "sig", ...(kid !== undefined ? { kid } : {}) };
	const jwk: Jwk =
		alg === "RS256"
			? {
					kty: "RSA",
					...common,
					...(exported.n !== undefined ? { n: exported.n } : {}),
					...(exported.e !== undefined ? { e: exported.e } : {}),
				}
			: {
					kty: "EC",
					...common,
					crv: "P-256",
					...(exported.x !== undefined ? { x: exported.x } : {}),
					...(exported.y !== undefined ? { y: exported.y } : {}),
				};
	return {
		signing: SigningKey.make(alg, kid, pair.privateKey),
		verification: VerificationKey.make(alg, kid, pair.publicKey),
		jwk,
	};
});

/**
 * Importers and a generator for {@link SigningKey} and {@link VerificationKey}.
 *
 * @public
 */
export const JwtKey: {
	/**
	 * Import a PEM private key as a signing key for `alg`.
	 *
	 * @remarks
	 * Accepts PKCS#8 (`BEGIN PRIVATE KEY`) for either algorithm, and PKCS#1
	 * (`BEGIN RSA PRIVATE KEY`, what github.com hands out for App keys) for
	 * `RS256`, which is wrapped to PKCS#8 in-process so it imports on any
	 * WebCrypto runtime. Anything else, an RSA key under 2048 bits, or a body
	 * that does not import is `key`. Newlines may arrive escaped as the two
	 * characters backslash and `n`, the one-line form an environment variable
	 * carries. The PEM is unwrapped here and nowhere else.
	 */
	readonly fromPkcs8Pem: (
		pem: Redacted.Redacted<string>,
		options: { readonly alg: JwtAlgorithm; readonly kid?: string },
	) => Effect.Effect<SigningKey, JwtError>;
	/**
	 * Import the public half of a JWK as a verification key.
	 *
	 * @remarks
	 * The algorithm is the JWK's `alg`, else `options.alg`; neither is `key`.
	 * An `alg` other than `RS256` or `ES256` is `unsupportedAlgorithm`, and a
	 * JWK `alg` that differs from `options.alg` is `algorithmMismatch`. A JWK
	 * whose type cannot carry the algorithm (an RSA key for `ES256`, a curve
	 * other than P-256), whose `use` is not `sig`, whose `key_ops` does not
	 * include `verify`, that is an RSA key under 2048 bits, or that does not
	 * import is `key`. Private members are ignored, never unwrapped.
	 */
	readonly fromJwk: (jwk: Jwk, options?: { readonly alg?: JwtAlgorithm }) => Effect.Effect<VerificationKey, JwtError>;
	/**
	 * Generate a fresh key pair and its public JWK; for tests.
	 *
	 * @remarks
	 * The private key is not extractable. RSA keys are 2048-bit with
	 * exponent 65537.
	 */
	readonly generate: (
		alg: JwtAlgorithm,
		options?: { readonly kid?: string },
	) => Effect.Effect<
		{ readonly signing: SigningKey; readonly verification: VerificationKey; readonly jwk: Jwk },
		JwtError
	>;
} = { fromPkcs8Pem, fromJwk, generate };
