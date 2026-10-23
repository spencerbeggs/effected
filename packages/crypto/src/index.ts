/**
 * HMAC, constant-time comparison and AWS SigV4 request signing over
 * WebCrypto, safe for Cloudflare Workers. Every digest comes from core
 * `Crypto`, required in `R`.
 *
 * @packageDocumentation
 */

export type { SecretInput } from "./ConstantTime.js";
export { ConstantTime } from "./ConstantTime.js";
export { CryptoError, CryptoErrorReason } from "./CryptoError.js";
export type {
	HmacAlgorithm,
	HmacEncoding,
	HmacInput,
	HmacKey,
	HmacSignBytesOptions,
	HmacSignOptions,
	HmacSignStringOptions,
	HmacStringEncoding,
	HmacVerifyBytesOptions,
	HmacVerifyOptions,
	HmacVerifyStringOptions,
} from "./Hmac.js";
export { Hmac } from "./Hmac.js";
export type { SigV4Canonical, SigV4Credentials, SigV4Request } from "./SigV4.js";
export { SigV4 } from "./SigV4.js";
