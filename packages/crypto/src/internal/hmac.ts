// The one HMAC primitive, over WebCrypto. Unspanned: `Hmac.sign` and
// `SigV4.sign` carry the spans, and SigV4's key derivation calls this five
// times per signature.

import { Effect } from "effect";
import { CryptoError } from "../CryptoError.js";
import { subtle, toArrayBuffer } from "./subtle.js";

/**
 * The raw HMAC of `message` under `key`.
 *
 * @internal
 */
export const hmacBytes = (
	algorithm: "SHA-256" | "SHA-512",
	key: Uint8Array,
	message: Uint8Array,
): Effect.Effect<Uint8Array, CryptoError> =>
	Effect.gen(function* () {
		const crypto = yield* subtle;
		const imported = yield* Effect.tryPromise({
			try: () => crypto.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: algorithm }, false, ["sign"]),
			catch: (cause) => CryptoError.of("key", `the HMAC ${algorithm} key could not be imported`, cause),
		});
		const signature = yield* Effect.tryPromise({
			try: () => crypto.sign("HMAC", imported, toArrayBuffer(message)),
			catch: (cause) => CryptoError.of("key", `the HMAC ${algorithm} key could not sign`, cause),
		});
		return new Uint8Array(signature);
	});
