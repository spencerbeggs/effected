/**
 * AES-GCM primitives over WebCrypto, with base64 from core's
 * `effect/encoding/Base64`.
 *
 * @remarks
 * This module imports nothing from the rest of the package. `EncryptedCodec.ts`
 * imports these helpers, so a back-import of `ConfigEncryptionError` would close
 * a cycle that Biome's error-level `noImportCycles` rule rejects. Staying
 * dependency-free also keeps the module cheap to extract later.
 *
 * Failures surface as the plain {@link CryptoFailure} record; the public module
 * lifts them into `ConfigEncryptionError`.
 *
 * @internal
 */
import { Effect } from "effect";
import * as Base64 from "effect/encoding/Base64";

/** AES-GCM's standard IV length, in bytes. @internal */
export const IV_LENGTH = 12;

/** Where a cryptographic step failed. @internal */
export type CryptoPhase = "key-derivation" | "encrypt" | "decrypt" | "encoding";

/** The internal failure shape. `EncryptedCodec.ts` maps this to `ConfigEncryptionError`. @internal */
export interface CryptoFailure {
	readonly phase: CryptoPhase;
	readonly cause: unknown;
}

/** Tag a caught host failure with the phase that produced it, preserving it by identity. */
const fail =
	(phase: CryptoPhase) =>
	(cause: unknown): CryptoFailure => ({ phase, cause });

/**
 * Copy a `Uint8Array` into a fresh `Uint8Array` backed by a plain `ArrayBuffer`,
 * which is required by Web Crypto APIs that accept `BufferSource`.
 *
 * @internal
 */
export function toArrayBufferView(src: Uint8Array): Uint8Array<ArrayBuffer> {
	const buf = new ArrayBuffer(src.length);
	const view = new Uint8Array(buf);
	view.set(src);
	return view;
}

/**
 * Derive an AES-GCM key from a passphrase via PBKDF2.
 *
 * @remarks
 * The caller memoizes this so PBKDF2 runs once per codec instance.
 *
 * @internal
 */
export const deriveKey = (passphrase: string, salt: Uint8Array): Effect.Effect<CryptoKey, CryptoFailure> =>
	Effect.tryPromise({
		try: async () => {
			const enc = new TextEncoder();
			const keyMaterial = await globalThis.crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
				"deriveKey",
			]);
			return await globalThis.crypto.subtle.deriveKey(
				{
					name: "PBKDF2",
					// Copy into ArrayBuffer-backed Uint8Array — required by PBKDF2Params.salt
					salt: toArrayBufferView(salt),
					// OWASP Password Storage Cheat Sheet, PBKDF2-HMAC-SHA256.
					// Derivation is memoized per codec instance, so the cost is paid once.
					iterations: 600_000,
					hash: "SHA-256",
				},
				keyMaterial,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			);
		},
		catch: fail("key-derivation"),
	});

/**
 * Decode the base64 envelope into bytes.
 *
 * @remarks
 * Delegates to core's `effect/encoding/Base64` rather than hand-rolling
 * `atob` and a char-code loop. Core is stricter than `atob`: it strips only
 * CR and LF, so an embedded space or tab, or missing padding, fails here with
 * phase `"encoding"`. The text is trimmed first, so whitespace AROUND the
 * envelope — the realistic residue of a hand edit or an editor's trailing
 * newline — is still tolerated, and `trim` also drops a leading BOM or NBSP,
 * which `atob` rejected. `EncryptedCodec` itself always writes padded,
 * whitespace-free output, so being strict inside the text costs nothing.
 *
 * The decoded view is backed by a plain `ArrayBuffer`; callers that hand a
 * slice of it to WebCrypto get an `ArrayBuffer`-backed view from `slice`.
 *
 * @internal
 */
export const fromBase64 = (raw: string): Effect.Effect<Uint8Array, CryptoFailure> =>
	Effect.mapError(Effect.fromResult(Base64.decode(raw.trim())), (error) => fail("encoding")(withoutInput(error)));

/**
 * Rebuild core's `EncodingError` as a plain `Error` that keeps only its message.
 *
 * @remarks
 * Core's `EncodingError` stores the whole stripped input as `input`, and the
 * public `ConfigEncryptionError` keeps its cause by identity. Passed through
 * as is, a PLAINTEXT config handed to an encrypted codec (a file that was
 * never encrypted, or a resolver pointing at the wrong file) would carry
 * every secret in it into the typed error, the `ParseFailed` event payload,
 * and any log that inspects or serializes the error. Core's messages name at
 * most one offending character, never the input.
 */
const withoutInput = (error: { readonly _tag: string; readonly message: string }): Error => {
	const cause = new Error(error.message);
	cause.name = error._tag;
	return cause;
};

/**
 * Prepend the IV to the ciphertext and base64-encode the envelope.
 *
 * @remarks
 * Synchronous and total: encoding bytes to base64 cannot fail, so there is no
 * error channel to carry.
 *
 * @internal
 */
export const toBase64 = (iv: Uint8Array, ciphertext: ArrayBuffer): string => {
	const ciphertextBytes = new Uint8Array(ciphertext);
	const result = new Uint8Array(IV_LENGTH + ciphertextBytes.length);
	result.set(iv, 0);
	result.set(ciphertextBytes, IV_LENGTH);
	return Base64.encode(result);
};

/** Decrypt AES-GCM ciphertext under `iv`. @internal */
export const decrypt = (
	key: CryptoKey,
	iv: Uint8Array<ArrayBuffer>,
	ciphertext: Uint8Array<ArrayBuffer>,
): Effect.Effect<ArrayBuffer, CryptoFailure> =>
	Effect.tryPromise({
		try: () => globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
		catch: fail("decrypt"),
	});

/** Encrypt `plaintext` with AES-GCM under `iv`. @internal */
export const encrypt = (
	key: CryptoKey,
	iv: Uint8Array<ArrayBuffer>,
	plaintext: Uint8Array<ArrayBuffer>,
): Effect.Effect<ArrayBuffer, CryptoFailure> =>
	Effect.tryPromise({
		try: () => globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
		catch: fail("encrypt"),
	});

/**
 * A fresh cryptographically random 12-byte IV, drawn from WebCrypto.
 *
 * @remarks
 * Deliberately NOT core's `Crypto.randomBytes` in `R`, which is otherwise the
 * kit's rule for any contract core declares. The IV is an AES-GCM nonce:
 * repeating one under the same key destroys GCM's confidentiality and
 * integrity. A swappable random source makes that a wiring accident away —
 * `Crypto.make`'s own documentation example returns zero-filled bytes, and a
 * seeded `TestCrypto` layer that reached production would repeat IVs. The
 * `ConfigCodec` seam also has no `R` channel to carry the service. This is a
 * recorded, security-motivated exception, not a precedent for other
 * randomness.
 *
 * A runtime without `globalThis.crypto` fails typed with phase `"encrypt"`,
 * like the neighbouring WebCrypto steps, rather than escaping as a defect.
 *
 * @internal
 */
export const randomIv: Effect.Effect<Uint8Array<ArrayBuffer>, CryptoFailure> = Effect.try({
	try: () => globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH))),
	catch: fail("encrypt"),
});
