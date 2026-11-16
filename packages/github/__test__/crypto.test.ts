import { assert, describe, it } from "@effect/vitest";
// `blakejs` and `tweetnacl` are test oracles only: the runtime copies of the
// primitives live in `src/internal`, and the reachability test pins that no
// module imports either library at runtime.
import blakejs from "blakejs";
import { Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import nacl from "tweetnacl";
import { encryptSecret } from "../src/internal/crypto.js";

const PUBLIC_KEY_BYTES = 32;

/** The sealed box, or a thrown assertion — the Result is the point elsewhere. */
const sealBytes = (publicKey: string, value: string): Uint8Array => {
	const sealed = Result.getOrThrow(encryptSecret(publicKey, value));
	return Result.getOrThrow(Base64.decode(sealed));
};

const b64 = (bytes: Uint8Array): string => Base64.encode(bytes);

describe("encryptSecret", () => {
	it("produces a sealed box the recipient can open", () => {
		const recipient = nacl.box.keyPair();
		const publicKey = b64(recipient.publicKey);

		const sealed = sealBytes(publicKey, "hunter2");

		// A sealed box is `ephemeral_public_key (32) || ciphertext`.
		const ephemeralPublicKey = sealed.subarray(0, PUBLIC_KEY_BYTES);
		const ciphertext = sealed.subarray(PUBLIC_KEY_BYTES);

		// The recipient recomputes the nonce from the two public keys alone,
		// having received no nonce alongside the box — which is why it is derived
		// rather than random.
		const nonceInput = new Uint8Array(PUBLIC_KEY_BYTES * 2);
		nonceInput.set(ephemeralPublicKey);
		nonceInput.set(recipient.publicKey, PUBLIC_KEY_BYTES);
		const nonce = blakejs.blake2b(nonceInput, undefined, 24);

		const opened = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipient.secretKey);

		assert.isNotNull(opened);
		assert.strictEqual(new TextDecoder().decode(opened as Uint8Array), "hunter2");
	});

	it("puts the ephemeral public key in the first 32 bytes", () => {
		const recipient = nacl.box.keyPair();
		const publicKey = b64(recipient.publicKey);

		const first = sealBytes(publicKey, "x").subarray(0, PUBLIC_KEY_BYTES);
		const second = sealBytes(publicKey, "x").subarray(0, PUBLIC_KEY_BYTES);

		assert.lengthOf(first, PUBLIC_KEY_BYTES);
		// The keypair is ephemeral: encrypting the same plaintext twice must not
		// produce the same box, or the sender is reusing a keypair it promised to
		// discard.
		assert.notStrictEqual(b64(first), b64(second));
	});

	it("cannot be opened by a different recipient", () => {
		const recipient = nacl.box.keyPair();
		const stranger = nacl.box.keyPair();
		const publicKey = b64(recipient.publicKey);

		const sealed = sealBytes(publicKey, "hunter2");
		const ephemeralPublicKey = sealed.subarray(0, PUBLIC_KEY_BYTES);
		const ciphertext = sealed.subarray(PUBLIC_KEY_BYTES);

		const nonceInput = new Uint8Array(PUBLIC_KEY_BYTES * 2);
		nonceInput.set(ephemeralPublicKey);
		nonceInput.set(recipient.publicKey, PUBLIC_KEY_BYTES);
		const nonce = blakejs.blake2b(nonceInput, undefined, 24);

		assert.isNull(nacl.box.open(ciphertext, nonce, ephemeralPublicKey, stranger.secretKey));
	});

	it("fails as a typed Result on a public key that is not base64", () => {
		// Garbage from the API is INPUT. It fails typed rather than throwing, which
		// is what lets the caller map it onto a GitHubError instead of a defect.
		const sealed = encryptSecret("!!! not base64 !!!", "hunter2");

		assert.strictEqual(Result.isFailure(sealed), true);
	});

	it("fails as a typed Result on a public key that is not 32 bytes", () => {
		for (const length of [0, 31, 33]) {
			const sealed = encryptSecret(b64(new Uint8Array(length).fill(7)), "hunter2");
			assert.strictEqual(Result.isFailure(sealed), true, `${length} bytes`);
		}
	});

	it("fails as a typed Result on a low-order public key", () => {
		const zero = encryptSecret(b64(new Uint8Array(32)), "hunter2");
		assert.strictEqual(Result.isFailure(zero), true);
	});

	it("opens for many random recipients and plaintext lengths", () => {
		for (let length = 0; length < 200; length += 7) {
			const recipient = nacl.box.keyPair();
			const value = "x".repeat(length);
			const sealed = sealBytes(b64(recipient.publicKey), value);
			const ephemeralPublicKey = sealed.subarray(0, PUBLIC_KEY_BYTES);
			const nonceInput = new Uint8Array(PUBLIC_KEY_BYTES * 2);
			nonceInput.set(ephemeralPublicKey);
			nonceInput.set(recipient.publicKey, PUBLIC_KEY_BYTES);
			const nonce = blakejs.blake2b(nonceInput, undefined, 24);
			const opened = nacl.box.open(sealed.subarray(PUBLIC_KEY_BYTES), nonce, ephemeralPublicKey, recipient.secretKey);
			assert.isNotNull(opened, `length ${length}`);
			assert.strictEqual(new TextDecoder().decode(opened as Uint8Array), value);
		}
	});

	it("never returns the plaintext", () => {
		const recipient = nacl.box.keyPair();
		const publicKey = b64(recipient.publicKey);

		const text = Result.getOrThrow(encryptSecret(publicKey, "hunter2"));

		assert.notInclude(text, "hunter2");
		assert.notInclude(new TextDecoder().decode(sealBytes(publicKey, "hunter2")), "hunter2");
	});
});
