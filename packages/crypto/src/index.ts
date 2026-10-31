/**
 * HMAC, constant-time comparison and AWS SigV4 request signing, safe for
 * Cloudflare Workers. Every HMAC comes from core's `Mac.Mac` and every digest
 * from core's `Digest.Digest` (`effect/crypto`), both required in `R`; a
 * failure is core's `CryptoError`.
 * `Fingerprint` hashes a canonical JSON text for three-way drift detection.
 *
 * @packageDocumentation
 */

export type { SecretInput } from "./ConstantTime.js";
export { ConstantTime } from "./ConstantTime.js";
export { DriftApply, DriftDecision, DriftDetected, DriftUnchanged } from "./DriftDecision.js";
export type { FingerprintDecideInput } from "./Fingerprint.js";
export { Fingerprint } from "./Fingerprint.js";
export { FingerprintError } from "./FingerprintError.js";
export type {
	HmacAlgorithm,
	HmacEncoding,
	HmacInput,
	HmacKey,
	HmacMessage,
	HmacSignBytesOptions,
	HmacSignOptions,
	HmacSignStringOptions,
	HmacStringEncoding,
	HmacVerifyBytesOptions,
	HmacVerifyOptions,
	HmacVerifyStringOptions,
} from "./Hmac.js";
export { Hmac } from "./Hmac.js";
export { HttpRedaction } from "./HttpRedaction.js";
export type { SigV4Canonical, SigV4Credentials, SigV4Request, SigV4Signed } from "./SigV4.js";
export { SigV4 } from "./SigV4.js";
export { SigV4PathError } from "./SigV4PathError.js";
