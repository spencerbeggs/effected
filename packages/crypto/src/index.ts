/**
 * HMAC, constant-time comparison and AWS SigV4 request signing over
 * WebCrypto, safe for Cloudflare Workers. Every digest comes from core
 * `Crypto`, required in `R`; secret blinding is keyed, so it is WebCrypto HMAC.
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
export type { SigV4Canonical, SigV4Credentials, SigV4Request, SigV4Signed } from "./SigV4.js";
export { SigV4 } from "./SigV4.js";
export { SigV4PathError } from "./SigV4PathError.js";
