import { Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import * as EncodingError from "effect/encoding/EncodingError";
import { blake2b } from "./blake2b.js";
import { x25519, x25519PublicKey } from "./x25519.js";
import { hsalsaKey, secretbox } from "./xsalsa20poly1305.js";

/** A sealed box opens with the recipient's key; the nonce is derived, not sent. */
const NONCE_BYTES = 24;
const PUBLIC_KEY_BYTES = 32;

const utf8 = new TextEncoder();

const invalidKey = (publicKey: string, message: string): EncodingError.EncodingError =>
	new EncodingError.EncodingError({ kind: "Decode", module: "SealedBox", input: publicKey, message });

/**
 * Encrypt a secret with libsodium's sealed-box algorithm, the format GitHub's
 * secrets API requires.
 *
 * @remarks
 * A sealed box is `ephemeral_public_key (32 bytes) || ciphertext`. The sender
 * mints a throwaway keypair, derives the nonce deterministically from both
 * public keys, encrypts with `crypto_box`, and discards the ephemeral secret
 * key — so nobody, including this process a moment later, can decrypt what it
 * just wrote. Only the holder of `publicKey`'s private half can.
 *
 * The nonce is `blake2b(ephemeral_pk || recipient_pk, 24)`. It is **derived**
 * rather than random because the recipient has to recompute it from the two
 * public keys alone, having received no nonce alongside the box. Both the
 * concatenation order and the 24-byte length are fixed by the libsodium
 * specification — changing either produces a box GitHub accepts and cannot
 * decrypt, which is a silent failure that surfaces as a workflow reading a
 * corrupt secret rather than as an error here.
 *
 * ## Nothing here is Node-specific

Base64 goes through core's `Base64`, text through `TextEncoder`, and the
ephemeral secret key through `globalThis.crypto.getRandomValues`, so this
module's graph imports **no builtin** and runs on workerd. The primitives
(X25519, HSalsa20, XSalsa20-Poly1305 and BLAKE2b) are in-house copies of audited
`@noble` code, each carrying its provenance header; they are one-shot functions
with no dependency of their own.

A malformed `publicKey` (not base64, not 32 bytes, or a low-order point) fails as
 * a typed `Result` rather than throwing: garbage from the API is input, and
 * input failures are typed.
 *
 * @param publicKey - The repository, environment or organization public key,
 * base64, as returned by GitHub's `.../secrets/public-key` endpoints.
 * @param secretValue - The plaintext to seal.
 * @returns The sealed box, base64, ready to send as `encrypted_value`.
 *
 * @internal
 */
export const encryptSecret = (
	publicKey: string,
	secretValue: string,
): Result.Result<string, EncodingError.EncodingError> =>
	Result.flatMap(Base64.decode(publicKey), (publicKeyBytes) => {
		if (publicKeyBytes.length !== PUBLIC_KEY_BYTES) {
			return Result.fail(
				invalidKey(publicKey, `a sealed-box public key is ${PUBLIC_KEY_BYTES} bytes, got ${publicKeyBytes.length}`),
			);
		}
		const ephemeralSecretKey = globalThis.crypto.getRandomValues(new Uint8Array(PUBLIC_KEY_BYTES));
		try {
			const ephemeralPublicKey = x25519PublicKey(ephemeralSecretKey);

			const nonceInput = new Uint8Array(PUBLIC_KEY_BYTES * 2);
			nonceInput.set(ephemeralPublicKey);
			nonceInput.set(publicKeyBytes, PUBLIC_KEY_BYTES);
			const nonce = blake2b(nonceInput, NONCE_BYTES);

			// crypto_box: the X25519 shared secret, hashed through HSalsa20, keys the secretbox.
			const sharedKey = hsalsaKey(x25519(ephemeralSecretKey, publicKeyBytes));
			const ciphertext = secretbox(utf8.encode(secretValue), nonce, sharedKey);

			const sealed = new Uint8Array(ephemeralPublicKey.length + ciphertext.length);
			sealed.set(ephemeralPublicKey);
			sealed.set(ciphertext, ephemeralPublicKey.length);

			return Result.succeed(Base64.encode(sealed));
		} catch {
			// The only throw reachable with well-sized inputs is x25519 refusing a
			// low-order recipient point, which no honest key is.
			return Result.fail(invalidKey(publicKey, "the public key is a low-order curve point"));
		} finally {
			ephemeralSecretKey.fill(0);
		}
	});
