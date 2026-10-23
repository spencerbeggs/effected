import type { Redacted } from "effect";
import { Effect } from "effect";
import { CryptoError } from "./CryptoError.js";
import { secretBytes, utf8 } from "./internal/bytes.js";
import { subtle, toArrayBuffer } from "./internal/subtle.js";

/**
 * Secret material for {@link ConstantTime.secretsEqual}: bytes, a string, or
 * a `Redacted` string.
 *
 * @remarks
 * Strings, redacted or not, are compared as their UTF-8 bytes.
 *
 * @public
 */
export type SecretInput = Uint8Array | string | Redacted.Redacted<string>;

const equal = (a: Uint8Array | string, b: Uint8Array | string): boolean => {
	const left = utf8(a);
	const right = utf8(b);
	if (left.length !== right.length) return false;
	let difference = 0;
	// No early exit: every byte is visited whatever the inputs, so the loop's
	// running time does not depend on where the first mismatch sits.
	for (let index = 0; index < left.length; index++) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
};

const secretsEqual = (expected: SecretInput, received: SecretInput): Effect.Effect<boolean, CryptoError> =>
	Effect.gen(function* () {
		const crypto = yield* subtle;
		// A fresh, non-extractable key per comparison: the MACs it produces are
		// never seen outside this call, so blinding with it reveals nothing.
		const key = yield* Effect.tryPromise({
			try: () => crypto.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
			catch: (cause) => CryptoError.of("key", "the HMAC SHA-256 blinding key could not be generated", cause),
		});
		const blind = (secret: SecretInput) =>
			Effect.tryPromise({
				try: () => crypto.sign("HMAC", key, toArrayBuffer(secretBytes(secret))),
				catch: (cause) => CryptoError.of("key", "the HMAC SHA-256 blinding key could not sign", cause),
			});
		const left = yield* blind(expected);
		const right = yield* blind(received);
		return equal(new Uint8Array(left), new Uint8Array(right));
	});

/**
 * Comparison whose running time does not depend on where two values differ.
 *
 * @remarks
 * The guarantee is best-effort: WebCrypto has no `timingSafeEqual`, so this
 * is a JavaScript loop the engine is free to optimise. Compare a fixed-length
 * digest with {@link ConstantTime.equal}; compare a shared secret with
 * {@link ConstantTime.secretsEqual}, which blinds both sides with a keyed MAC
 * first so neither the secret's length nor a matching prefix can leak.
 *
 * @public
 */
export class ConstantTime {
	private constructor() {}

	/**
	 * Whether `a` and `b` hold the same bytes.
	 *
	 * @remarks
	 * Strings are compared as their UTF-8 bytes, so a string and the bytes of
	 * its UTF-8 encoding are equal. The XOR accumulator visits every byte with
	 * no early return on a mismatch. A length mismatch returns `false`
	 * immediately, which reveals the length; that is harmless for digests and
	 * MACs, whose length is public.
	 *
	 * @public
	 */
	static readonly equal: (a: Uint8Array | string, b: Uint8Array | string) => boolean = equal;

	/**
	 * Whether two secrets are equal, compared through their HMACs under a
	 * fresh random key.
	 *
	 * @remarks
	 * Each call generates a non-extractable HMAC-SHA256 key with WebCrypto,
	 * MACs both sides under it and compares the two 32-byte MACs with
	 * {@link ConstantTime.equal}: the secret's length and any matching prefix
	 * never reach the loop, and the blinding is keyed, so its output cannot be
	 * precomputed. Use it for a shared-secret header. A `Redacted` value is
	 * read only to MAC it. Needs nothing in `R`; fails with
	 * {@link CryptoError} only when the runtime has no `crypto.subtle`
	 * (`unsupportedRuntime`) or WebCrypto refuses the key (`key`).
	 *
	 * WebCrypto is truly asynchronous: a test that forks this and then adjusts
	 * `TestClock` can race or hang; await it or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly secretsEqual: (expected: SecretInput, received: SecretInput) => Effect.Effect<boolean, CryptoError> =
		secretsEqual;
}
