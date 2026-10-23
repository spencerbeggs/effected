// WebCrypto acquisition. `subtle` is read from `globalThis.crypto` so the
// package runs unchanged on Node, Deno, Bun, browsers and workerd; there is
// no `node:crypto` fallback by design.

import { Effect } from "effect";
import { CryptoError } from "../CryptoError.js";

/**
 * The runtime's `SubtleCrypto`, or `unsupportedRuntime` when it has none.
 *
 * @internal
 */
export const subtle: Effect.Effect<SubtleCrypto, CryptoError> = Effect.suspend(() => {
	const value = globalThis.crypto?.subtle;
	if (value === undefined) {
		return Effect.fail(CryptoError.of("unsupportedRuntime", "globalThis.crypto.subtle is not available"));
	}
	return Effect.succeed(value);
});

/**
 * An `ArrayBuffer` holding exactly `bytes`.
 *
 * @remarks
 * WebCrypto's `BufferSource` typing rejects a `Uint8Array` over a
 * `SharedArrayBuffer`, and a view's `.buffer` may be larger than the view. A
 * view that already spans a whole plain `ArrayBuffer` passes that buffer
 * through, uncopied (WebCrypto copies its input when called); any other view
 * is copied into a fresh one.
 *
 * @internal
 */
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const { buffer } = bytes;
	if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
		return buffer;
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};
