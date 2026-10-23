import type { Redacted } from "effect";
import { Effect, Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import { ConstantTime } from "./ConstantTime.js";
import type { CryptoError } from "./CryptoError.js";
import { messageBytes, secretBytes } from "./internal/bytes.js";
import { hmacBytes } from "./internal/hmac.js";

/**
 * The hash an HMAC is computed over.
 *
 * @public
 */
export type HmacAlgorithm = "SHA-256" | "SHA-512";

/**
 * How an HMAC is returned, or how a received one is encoded.
 *
 * @remarks
 * - `bytes` — the raw `Uint8Array`.
 * - `hex` — lower-case hexadecimal.
 * - `base64` — RFC 4648 base64, padded.
 * - `base64url` — RFC 4648 base64url, unpadded.
 *
 * @public
 */
export type HmacEncoding = "bytes" | "hex" | "base64" | "base64url";

/**
 * The string encodings of an HMAC: every {@link HmacEncoding} but `bytes`.
 *
 * @public
 */
export type HmacStringEncoding = Exclude<HmacEncoding, "bytes">;

/**
 * HMAC key material: raw bytes, or a `Redacted` string used as its UTF-8
 * bytes.
 *
 * @public
 */
export type HmacKey = Uint8Array | Redacted.Redacted<string>;

/**
 * An HMAC message: bytes, a string, or a list of parts.
 *
 * @remarks
 * A string is its UTF-8 bytes. A list is the concatenation of its parts'
 * bytes, in order, so a prefix and a raw body are signed without the caller
 * building the joined buffer, and never through a decoded string.
 *
 * @public
 */
export type HmacMessage = Uint8Array | string | ReadonlyArray<Uint8Array | string>;

/**
 * What every HMAC operation takes: the hash, the key and the message.
 *
 * @public
 */
export interface HmacInput {
	/** The hash the HMAC is computed over. */
	readonly algorithm: HmacAlgorithm;
	/** The key. A `Redacted` is read only when the key is imported. */
	readonly key: HmacKey;
	/** The message; see {@link HmacMessage}. */
	readonly message: HmacMessage;
}

/**
 * The input to {@link Hmac.sign} for a raw-bytes HMAC.
 *
 * @public
 */
export interface HmacSignBytesOptions extends HmacInput {
	/** `bytes`, the default. */
	readonly encoding?: "bytes";
}

/**
 * The input to {@link Hmac.sign} for an encoded-string HMAC.
 *
 * @public
 */
export interface HmacSignStringOptions extends HmacInput {
	/** The output encoding. */
	readonly encoding: HmacStringEncoding;
}

/**
 * The input to {@link Hmac.sign}.
 *
 * @public
 */
export type HmacSignOptions = HmacSignBytesOptions | HmacSignStringOptions;

/**
 * The input to {@link Hmac.verify} for a signature held as raw bytes.
 *
 * @public
 */
export interface HmacVerifyBytesOptions extends HmacInput {
	/** The received signature. */
	readonly signature: Uint8Array;
}

/**
 * The input to {@link Hmac.verify} for a signature held as an encoded string.
 *
 * @public
 */
export interface HmacVerifyStringOptions extends HmacInput {
	/** The received signature, encoded as `encoding` says. */
	readonly signature: string;
	/** How `signature` is encoded. */
	readonly encoding: HmacStringEncoding;
}

/**
 * The input to {@link Hmac.verify}.
 *
 * @public
 */
export type HmacVerifyOptions = HmacVerifyBytesOptions | HmacVerifyStringOptions;

const encode = (bytes: Uint8Array, encoding: HmacEncoding): Uint8Array | string => {
	switch (encoding) {
		case "bytes":
			return bytes;
		case "hex":
			return Hex.encode(bytes);
		case "base64":
			return Base64.encode(bytes);
		case "base64url":
			return Base64Url.encode(bytes);
	}
};

const decode = (value: string, encoding: HmacStringEncoding): Result.Result<Uint8Array, unknown> => {
	switch (encoding) {
		case "hex":
			return Hex.decode(value);
		case "base64":
			return Base64.decode(value);
		case "base64url":
			return Base64Url.decode(value);
	}
};

const signAny = Effect.fn("Hmac.sign")(function* (options: HmacSignOptions) {
	yield* Effect.annotateCurrentSpan("algorithm", options.algorithm);
	const mac = yield* hmacBytes(options.algorithm, secretBytes(options.key), messageBytes(options.message));
	return encode(mac, options.encoding ?? "bytes");
});

function sign(options: HmacSignBytesOptions): Effect.Effect<Uint8Array, CryptoError>;
function sign(options: HmacSignStringOptions): Effect.Effect<string, CryptoError>;
function sign(options: HmacSignOptions): Effect.Effect<Uint8Array | string, CryptoError> {
	return signAny(options);
}

const verify = Effect.fn("Hmac.verify")(function* (options: HmacVerifyOptions) {
	yield* Effect.annotateCurrentSpan("algorithm", options.algorithm);
	const expected = yield* hmacBytes(options.algorithm, secretBytes(options.key), messageBytes(options.message));
	if (!("encoding" in options)) return ConstantTime.equal(expected, options.signature);
	// A signature that does not decode is a wrong signature, not an error.
	const received = decode(options.signature, options.encoding);
	return Result.isSuccess(received) && ConstantTime.equal(expected, received.success);
});

/**
 * HMAC sign and verify (RFC 2104) over WebCrypto, with SHA-256 or SHA-512.
 *
 * @remarks
 * Both return an `Effect` because WebCrypto's `sign` is asynchronous. Both
 * fail with {@link CryptoError}: `unsupportedRuntime` when the runtime has no
 * `crypto.subtle`, `key` when WebCrypto refuses the key (an empty key, for
 * instance). The span carries the algorithm, never the key or the MAC.
 *
 * @public
 */
export class Hmac {
	private constructor() {}

	/**
	 * Compute the HMAC of `message` under `key`.
	 *
	 * @remarks
	 * Returns raw bytes unless `encoding` names a string form: `hex` (lower
	 * case), `base64` (padded) or `base64url` (unpadded). A list `message` is
	 * signed as its parts' bytes joined in order.
	 *
	 * WebCrypto's `sign` is truly asynchronous: the effect suspends on a
	 * promise, not a scheduled fiber, so a test that forks it and then adjusts
	 * `TestClock` can race or hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly sign: {
		(options: HmacSignBytesOptions): Effect.Effect<Uint8Array, CryptoError>;
		(options: HmacSignStringOptions): Effect.Effect<string, CryptoError>;
	} = sign;

	/**
	 * Whether `signature` is the HMAC of `message` under `key`.
	 *
	 * @remarks
	 * Recomputes the HMAC and compares with {@link ConstantTime.equal}. A
	 * string signature is decoded per `encoding` first; one that does not
	 * decode, or decodes to the wrong length, answers `false` rather than
	 * failing. Hex is accepted in either case.
	 *
	 * Truly asynchronous, as {@link Hmac.sign} is: a forked verify does not
	 * finish under `TestClock` adjustment alone; await it or use a latch.
	 *
	 * @public
	 */
	static readonly verify: (options: HmacVerifyOptions) => Effect.Effect<boolean, CryptoError> = verify;
}
