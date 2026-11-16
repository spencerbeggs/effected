import { assert, describe, it } from "@effect/vitest";
// Test oracles only; see crypto.test.ts. `blakejs` is CommonJS, so it is a default import.
import blakejs from "blakejs";
import nacl from "tweetnacl";
import { blake2b } from "../src/internal/blake2b.js";
import { x25519, x25519PublicKey } from "../src/internal/x25519.js";
import { hsalsaKey, secretbox } from "../src/internal/xsalsa20poly1305.js";

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const random = (length: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(length));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("blake2b", () => {
	it("matches RFC 7693 Appendix A: BLAKE2b-512 of 'abc'", () => {
		assert.strictEqual(
			toHex(blake2b(utf8("abc"), 64)),
			"ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
		);
	});

	it("matches the reference BLAKE2b-512 of the empty message", () => {
		assert.strictEqual(
			toHex(blake2b(new Uint8Array(0), 64)),
			"786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
		);
	});

	it("matches the reference BLAKE2b-256 of 'abc'", () => {
		assert.strictEqual(
			toHex(blake2b(utf8("abc"), 32)),
			"bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
		);
	});

	it("is not a truncation: a 24-byte digest differs from the prefix of the 64-byte one", () => {
		// outLen is part of the parameter block, so BLAKE2b-24 is its own function.
		const long = blake2b(utf8("abc"), 64);
		const short = blake2b(utf8("abc"), 24);
		assert.lengthOf(short, 24);
		assert.notStrictEqual(toHex(short), toHex(long.subarray(0, 24)));
		assert.strictEqual(toHex(short), toHex(blakejs.blake2b(utf8("abc"), undefined, 24)));
	});

	it("rejects an output length outside 1..64", () => {
		for (const outLen of [0, 65, -1, 1.5, Number.NaN]) {
			assert.throws(() => blake2b(utf8("abc"), outLen), RangeError);
		}
	});

	it("agrees with blakejs on random inputs, across every block boundary", () => {
		// 0, 1, 127, 128, 129, 255, 256 and 257 bytes cover the empty message, a
		// partial block, an exact block (which is the LAST block, not a full one
		// followed by an empty one) and the carry into the next.
		const lengths = [0, 1, 2, 31, 32, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1000];
		for (const length of lengths) {
			for (const outLen of [1, 16, 24, 32, 48, 64]) {
				const message = random(length);
				assert.strictEqual(
					toHex(blake2b(message, outLen)),
					toHex(blakejs.blake2b(message, undefined, outLen)),
					`length ${length}, outLen ${outLen}`,
				);
			}
		}
	});

	it("does not mutate its input", () => {
		const message = random(200);
		const copy = Uint8Array.from(message);
		blake2b(message, 24);
		assert.deepStrictEqual(message, copy);
	});
});

describe("x25519", () => {
	it("matches RFC 7748 §5.2 test vector 1", () => {
		assert.strictEqual(
			toHex(
				x25519(
					fromHex("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4"),
					fromHex("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c"),
				),
			),
			"c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
		);
	});

	it("matches RFC 7748 §5.2 test vector 2", () => {
		assert.strictEqual(
			toHex(
				x25519(
					fromHex("4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d"),
					fromHex("e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493"),
				),
			),
			"95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
		);
	});

	it("matches RFC 7748 §5.2 after one iteration from k = u = 9", () => {
		const nine = new Uint8Array(32);
		nine[0] = 9;
		assert.strictEqual(toHex(x25519(nine, nine)), "422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079");
	});

	it("matches RFC 7748 §6.1: both public keys and the shared secret", () => {
		const alicePrivate = fromHex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
		const alicePublic = fromHex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
		const bobPrivate = fromHex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
		const bobPublic = fromHex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
		const shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";
		assert.strictEqual(toHex(x25519PublicKey(alicePrivate)), toHex(alicePublic));
		assert.strictEqual(toHex(x25519PublicKey(bobPrivate)), toHex(bobPublic));
		assert.strictEqual(toHex(x25519(alicePrivate, bobPublic)), shared);
		assert.strictEqual(toHex(x25519(bobPrivate, alicePublic)), shared);
	});

	it("agrees with tweetnacl's scalar multiplication on random keys", () => {
		for (let i = 0; i < 25; i++) {
			const secret = random(32);
			const peer = nacl.box.keyPair().publicKey;
			assert.strictEqual(toHex(x25519PublicKey(secret)), toHex(nacl.scalarMult.base(secret)), "public key");
			assert.strictEqual(toHex(x25519(secret, peer)), toHex(nacl.scalarMult(secret, peer)), "shared secret");
		}
	});

	it("does not mutate the secret key it clamps", () => {
		const secret = random(32);
		const copy = Uint8Array.from(secret);
		x25519PublicKey(secret);
		assert.deepStrictEqual(secret, copy);
	});

	it("rejects low-order public keys before the ladder", () => {
		const secret = random(32);
		const zero = new Uint8Array(32);
		const one = new Uint8Array(32);
		one[0] = 1;
		assert.throws(() => x25519(secret, zero), /invalid private or public key/);
		assert.throws(() => x25519(secret, one), /invalid private or public key/);
	});

	it("rejects wrong-sized inputs", () => {
		assert.throws(() => x25519(new Uint8Array(31), new Uint8Array(32)), RangeError);
		assert.throws(() => x25519(new Uint8Array(32), new Uint8Array(33)), RangeError);
	});
});

describe("xsalsa20poly1305", () => {
	// NaCl's tests/box.c: Alice's secret, Bob's public key, a nonce and a message.
	// crypto_box is X25519 -> HSalsa20 -> XSalsa20-Poly1305, so this one vector
	// pins all three of the building blocks this module and `x25519` provide.
	const alicePrivate = fromHex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
	const bobPublic = fromHex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
	const nonce = fromHex("69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37");
	const message = fromHex(
		"be075fc53c81f2d5cf141316ebeb0c7b5228c52a4c62cbd44b66849b64244ffce5ecbaaf33bd751a1ac728d45e6c61296cdc3c01233561f41db66cce314adb310e3be8250c46f06dceea3a7fa1348057e2f6556ad6b1318a024a838f21af1fde048977eb48f59ffd4924ca1c60902e52f0a089bc76897040e082f937763848645e0705",
	);
	const box =
		"f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5";

	it("matches NaCl's crypto_box known-answer vector (tag || ciphertext)", () => {
		const key = hsalsaKey(x25519(alicePrivate, bobPublic));
		assert.strictEqual(toHex(secretbox(message, nonce, key)), box);
	});

	it("derives the crypto_box key the way tweetnacl's box.before does", () => {
		for (let i = 0; i < 10; i++) {
			const a = nacl.box.keyPair();
			const b = nacl.box.keyPair();
			assert.strictEqual(
				toHex(hsalsaKey(x25519(a.secretKey, b.publicKey))),
				toHex(nacl.box.before(b.publicKey, a.secretKey)),
			);
		}
	});

	it("agrees with tweetnacl's secretbox and is opened by nacl.secretbox.open", () => {
		const lengths = [0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000];
		for (const length of lengths) {
			const key = random(32);
			const n = random(24);
			const plaintext = random(length);
			const sealed = secretbox(plaintext, n, key);
			assert.strictEqual(toHex(sealed), toHex(nacl.secretbox(plaintext, n, key)), `length ${length}`);
			const opened = nacl.secretbox.open(sealed, n, key);
			assert.isNotNull(opened, `length ${length}`);
			assert.deepStrictEqual(opened, plaintext);
		}
	});

	it("does not mutate its inputs", () => {
		const key = random(32);
		const n = random(24);
		const plaintext = random(100);
		const copies = [key, n, plaintext].map((bytes) => Uint8Array.from(bytes));
		secretbox(plaintext, n, key);
		assert.deepStrictEqual([key, n, plaintext], copies);
	});

	it("rejects a wrong-sized key or nonce", () => {
		assert.throws(() => secretbox(new Uint8Array(1), new Uint8Array(24), new Uint8Array(31)), RangeError);
		assert.throws(() => secretbox(new Uint8Array(1), new Uint8Array(23), new Uint8Array(32)), RangeError);
	});
});
