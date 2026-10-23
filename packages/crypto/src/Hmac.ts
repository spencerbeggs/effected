import type { Redacted } from "effect";
import { Effect, Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import { ConstantTime } from "./ConstantTime.js";
import type { CryptoError } from "./CryptoError.js";
import { secretBytes, utf8 } from "./internal/bytes.js";
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
 * What {@link Hmac.sign} returns for an encoding: bytes for `bytes`, a
 * string otherwise.
 *
 * @public
 */
export type HmacOutput<E extends HmacEncoding> = E extends "bytes" ? Uint8Array : string;

/**
 * The input to {@link Hmac.sign}.
 *
 * @public
 */
export interface HmacSignOptions<E extends HmacEncoding = HmacEncoding> {
	/** The hash the HMAC is computed over. */
	readonly algorithm: HmacAlgorithm;
	/** The key. A `Redacted` is read only when the key is imported. */
	readonly key: HmacKey;
	/** The message; a string is signed as its UTF-8 bytes. */
	readonly message: Uint8Array | string;
	/** The output encoding; `bytes` when omitted. */
	readonly encoding?: E;
}

/**
 * The input to {@link Hmac.verify} for a signature held as raw bytes.
 *
 * @public
 */
export interface HmacVerifyBytesOptions {
	/** The hash the HMAC is computed over. */
	readonly algorithm: HmacAlgorithm;
	/** The key. A `Redacted` is read only when the key is imported. */
	readonly key: HmacKey;
	/** The message; a string is signed as its UTF-8 bytes. */
	readonly message: Uint8Array | string;
	/** The received signature. */
	readonly signature: Uint8Array;
}

/**
 * The input to {@link Hmac.verify} for a signature held as an encoded string.
 *
 * @public
 */
export interface HmacVerifyStringOptions {
	/** The hash the HMAC is computed over. */
	readonly algorithm: HmacAlgorithm;
	/** The key. A `Redacted` is read only when the key is imported. */
	readonly key: HmacKey;
	/** The message; a string is signed as its UTF-8 bytes. */
	readonly message: Uint8Array | string;
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

const sign = Effect.fn("Hmac.sign")(function* (options: HmacSignOptions) {
	yield* Effect.annotateCurrentSpan("algorithm", options.algorithm);
	const mac = yield* hmacBytes(options.algorithm, secretBytes(options.key), utf8(options.message));
	return encode(mac, options.encoding ?? "bytes");
});

const verify = Effect.fn("Hmac.verify")(function* (options: HmacVerifyOptions) {
	yield* Effect.annotateCurrentSpan("algorithm", options.algorithm);
	const expected = yield* hmacBytes(options.algorithm, secretBytes(options.key), utf8(options.message));
	if (typeof options.signature !== "string") return ConstantTime.equal(expected, options.signature);
	// A signature that does not decode is a wrong signature, not an error.
	const received = decode(options.signature, (options as HmacVerifyStringOptions).encoding);
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
	 * case), `base64` (padded) or `base64url` (unpadded).
	 *
	 * @public
	 */
	static readonly sign: <E extends HmacEncoding = "bytes">(
		options: HmacSignOptions<E>,
	) => Effect.Effect<HmacOutput<E>, CryptoError> = sign as never;

	/**
	 * Whether `signature` is the HMAC of `message` under `key`.
	 *
	 * @remarks
	 * Recomputes the HMAC and compares with {@link ConstantTime.equal}. A
	 * string signature is decoded per `encoding` first; one that does not
	 * decode, or decodes to the wrong length, answers `false` rather than
	 * failing. Hex is accepted in either case.
	 *
	 * @public
	 */
	static readonly verify: (options: HmacVerifyOptions) => Effect.Effect<boolean, CryptoError> = verify;
}
