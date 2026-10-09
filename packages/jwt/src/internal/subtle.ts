// WebCrypto acquisition. `subtle` is read from `globalThis.crypto` so the
// package runs unchanged on Node, Deno, Bun, browsers and workerd; there is
// no `node:crypto` fallback by design.

import { Effect } from "effect";
import { JwtError } from "../JwtError.js";

/**
 * The runtime's `SubtleCrypto`, or `unsupportedRuntime` when it has none.
 *
 * @internal
 */
export const subtle: Effect.Effect<SubtleCrypto, JwtError> = Effect.suspend(() => {
	const value = globalThis.crypto?.subtle;
	if (value === undefined) {
		return Effect.fail(JwtError.of("unsupportedRuntime", "globalThis.crypto.subtle is not available"));
	}
	return Effect.succeed(value);
});

/**
 * A fresh `ArrayBuffer` holding exactly `bytes`.
 *
 * @remarks
 * WebCrypto's `BufferSource` typing rejects a `Uint8Array` over a
 * `SharedArrayBuffer`, and a view's `.buffer` may be larger than the view.
 * Copying sidesteps both.
 *
 * @internal
 */
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};
