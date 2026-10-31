// The one HMAC primitive, over core's `Mac` service. Unspanned: `Hmac.sign`
// and `SigV4.sign` carry the spans, and SigV4's key derivation calls this five
// times per signature.

import { Effect } from "effect";
import type { CryptoError } from "effect/crypto";
import { Mac } from "effect/crypto";

/**
 * The core `Mac` algorithm for a kit hash name.
 *
 * @internal
 */
export const macAlgorithm = (algorithm: "SHA-256" | "SHA-512"): Mac.Algorithm =>
	algorithm === "SHA-256" ? Mac.hmacSha256 : Mac.hmacSha512;

/**
 * The raw HMAC of `message` under `key`.
 *
 * @remarks
 * `Mac.key` copies the bytes and refuses an empty key with `InvalidKey`.
 *
 * @internal
 */
export const hmacBytes = (
	algorithm: "SHA-256" | "SHA-512",
	key: Uint8Array,
	message: Uint8Array,
): Effect.Effect<Uint8Array, CryptoError.CryptoError, Mac.Mac> =>
	Effect.flatMap(Mac.key(macAlgorithm(algorithm), key), (macKey) => Mac.Mac.use((mac) => mac.sign(macKey, message)));
