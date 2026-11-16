// The libsodium cross-check for the sealed box and the three copied primitives. tweetnacl and blakejs are
// independent ports; libsodium is the reference the GitHub secrets API itself decrypts with, so it is the oracle
// that settles the format. `libsodium-wrappers` is a devDependency only; see okf/decisions/sealed-box-primitives-copied.md.
import { assert, beforeAll, describe, it } from "@effect/vitest";
import { Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import sodium from "libsodium-wrappers";
import { blake2b } from "../src/internal/blake2b.js";
import { encryptSecret } from "../src/internal/crypto.js";
import { x25519, x25519PublicKey } from "../src/internal/x25519.js";
import { hsalsaKey, secretbox } from "../src/internal/xsalsa20poly1305.js";

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

beforeAll(async () => {
	await sodium.ready;
});

describe("libsodium cross-check", () => {
	it("crypto_box_seal_open opens what encryptSecret seals", () => {
		for (let length = 0; length < 300; length += 13) {
			const recipient = sodium.crypto_box_keypair();
			const value = "s".repeat(length);
			const sealed = Result.getOrThrow(encryptSecret(Base64.encode(recipient.publicKey), value));
			const bytes = Result.getOrThrow(Base64.decode(sealed));

			const opened = sodium.crypto_box_seal_open(bytes, recipient.publicKey, recipient.privateKey);

			assert.strictEqual(sodium.to_string(opened), value, `length ${length}`);
		}
	});

	it("crypto_box_seal_open opens a multi-byte UTF-8 secret", () => {
		const recipient = sodium.crypto_box_keypair();
		const value = "pässwörd 🔐 日本語";
		const sealed = Result.getOrThrow(encryptSecret(Base64.encode(recipient.publicKey), value));

		const opened = sodium.crypto_box_seal_open(
			Result.getOrThrow(Base64.decode(sealed)),
			recipient.publicKey,
			recipient.privateKey,
		);

		assert.strictEqual(sodium.to_string(opened), value);
	});

	it("blake2b matches crypto_generichash, including the 24-byte nonce length", () => {
		for (const outLen of [16, 24, 32, 48, 64]) {
			for (const size of [0, 1, 63, 64, 127, 128, 129, 1000]) {
				const message = sodium.randombytes_buf(size);
				assert.strictEqual(
					toHex(blake2b(message, outLen)),
					toHex(sodium.crypto_generichash(outLen, message, null)),
					`outLen ${outLen}, size ${size}`,
				);
			}
		}
	});

	it("x25519 matches crypto_scalarmult and crypto_scalarmult_base", () => {
		for (let i = 0; i < 32; i++) {
			const secret = sodium.randombytes_buf(32);
			const peer = sodium.crypto_box_keypair().publicKey;
			assert.strictEqual(toHex(x25519PublicKey(secret)), toHex(sodium.crypto_scalarmult_base(secret)), "public key");
			assert.strictEqual(toHex(x25519(secret, peer)), toHex(sodium.crypto_scalarmult(secret, peer)), "shared secret");
		}
	});

	it("hsalsa + secretbox matches crypto_box_easy", () => {
		for (let length = 0; length < 300; length += 17) {
			const sender = sodium.crypto_box_keypair();
			const recipient = sodium.crypto_box_keypair();
			const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
			const message = sodium.randombytes_buf(length);

			const ours = secretbox(message, nonce, hsalsaKey(x25519(sender.privateKey, recipient.publicKey)));
			const theirs = sodium.crypto_box_easy(message, nonce, recipient.publicKey, sender.privateKey);

			assert.strictEqual(toHex(ours), toHex(theirs), `length ${length}`);
		}
	});
});
