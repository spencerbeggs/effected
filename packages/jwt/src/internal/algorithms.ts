// The two signature algorithms and their WebCrypto parameters, in one place
// for the importers (`JwtKey`) and the signer/verifier (`Jws`).
//
// Only `Crypto`, `CryptoKey` and `SubtleCrypto` are global on every runtime's
// type lib, so the WebCrypto dictionaries are written structurally rather than
// named (`RsaHashedImportParams`, `EcdsaParams`, ...).
//
// `Algorithm` is the same union as the public `JwtAlgorithm` in `JwtKey.ts`;
// it is restated here rather than imported so the two modules do not form an
// import cycle.

import { JwtError } from "../JwtError.js";
import { quote } from "./quote.js";

/** @internal */
export type Algorithm = "RS256" | "ES256";

const supported: ReadonlyArray<string> = ["RS256", "ES256"];

/** @internal */
export const isAlgorithm = (alg: string): alg is Algorithm => supported.includes(alg);

/**
 * The failure for a token whose header names an algorithm outside
 * {@link Algorithm}; raised before any key is resolved.
 *
 * @internal
 */
export const unsupportedAlgorithm = (alg: string): JwtError =>
	JwtError.of("unsupportedAlgorithm", `the token claims ${quote(alg)}; only RS256 and ES256 are accepted`);

/** Parameters for `importKey`. @internal */
export const importParams = (alg: Algorithm) =>
	alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" };

/** Parameters for `generateKey`; RSA keys are 2048-bit with exponent 65537. @internal */
export const generateParams = (alg: Algorithm) =>
	alg === "RS256"
		? { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" }
		: { name: "ECDSA", namedCurve: "P-256" };

/**
 * Parameters for `sign` and `verify`. ES256's WebCrypto signature is the raw
 * `r || s` pair, which is exactly the JWS encoding (RFC 7518 §3.4), so no DER
 * conversion is involved.
 *
 * @internal
 */
export const signParams = (alg: Algorithm) =>
	alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
