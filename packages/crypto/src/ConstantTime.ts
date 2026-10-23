import type { PlatformError, Redacted } from "effect";
import { Crypto, Effect } from "effect";
import { secretBytes, utf8 } from "./internal/bytes.js";

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

const secretsEqual = (
	expected: SecretInput,
	received: SecretInput,
): Effect.Effect<boolean, PlatformError.PlatformError, Crypto.Crypto> =>
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto;
		const left = yield* crypto.digest("SHA-256", secretBytes(expected));
		const right = yield* crypto.digest("SHA-256", secretBytes(received));
		return equal(left, right);
	});

/**
 * Comparison whose running time does not depend on where two values differ.
 *
 * @remarks
 * The guarantee is best-effort: WebCrypto has no `timingSafeEqual`, so this
 * is a JavaScript loop the engine is free to optimise. Compare a fixed-length
 * digest with {@link ConstantTime.equal}; compare a shared secret with
 * {@link ConstantTime.secretsEqual}, which hashes both sides first so neither
 * the secret's length nor a matching prefix can leak.
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
	 * Whether two secrets are equal, compared through their SHA-256 digests.
	 *
	 * @remarks
	 * Both sides are hashed with core `Crypto.digest`, so the comparison runs
	 * over two 32-byte digests: the secret's length and any matching prefix
	 * never reach the loop. Use it for a shared-secret header. A `Redacted`
	 * value is read only to hash it. Fails only if the platform digest does.
	 *
	 * @public
	 */
	static readonly secretsEqual: (
		expected: SecretInput,
		received: SecretInput,
	) => Effect.Effect<boolean, PlatformError.PlatformError, Crypto.Crypto> = secretsEqual;
}
