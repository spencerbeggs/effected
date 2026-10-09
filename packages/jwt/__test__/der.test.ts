import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { derLength, pemBody, wrapPkcs1 } from "../src/internal/der.js";

describe("derLength", () => {
	it("uses the short form below 128 and the minimal long form above", () => {
		assert.deepStrictEqual(derLength(0), Uint8Array.of(0x00));
		assert.deepStrictEqual(derLength(127), Uint8Array.of(0x7f));
		assert.deepStrictEqual(derLength(128), Uint8Array.of(0x81, 0x80));
		assert.deepStrictEqual(derLength(255), Uint8Array.of(0x81, 0xff));
		assert.deepStrictEqual(derLength(256), Uint8Array.of(0x82, 0x01, 0x00));
		assert.deepStrictEqual(derLength(1191), Uint8Array.of(0x82, 0x04, 0xa7));
		assert.deepStrictEqual(derLength(65536), Uint8Array.of(0x83, 0x01, 0x00, 0x00));
	});
});

describe("wrapPkcs1", () => {
	// node:crypto is the oracle: it re-encodes the same key as PKCS#8, and the
	// wrap must produce those exact bytes. The sizes cover the outer and inner
	// lengths in the 0x81 form (a 512-bit key, ~300 bytes) and the 0x82 form
	// (a 2048-bit key, ~1190 bytes).
	for (const modulusLength of [512, 1024, 2048]) {
		it(`matches node's PKCS#8 encoding byte for byte for a ${modulusLength}-bit key`, () => {
			const { privateKey } = generateKeyPairSync("rsa", {
				modulusLength,
				privateKeyEncoding: { type: "pkcs1", format: "der" },
				publicKeyEncoding: { type: "spki", format: "der" },
			});
			const expected = createPrivateKey({ key: privateKey, format: "der", type: "pkcs1" }).export({
				type: "pkcs8",
				format: "der",
			});
			assert.deepStrictEqual(wrapPkcs1(new Uint8Array(privateKey)), new Uint8Array(expected));
		});
	}

	it("frames a short body with short-form lengths", () => {
		const wrapped = wrapPkcs1(Uint8Array.of(0xaa, 0xbb));
		assert.deepStrictEqual(
			wrapped,
			Uint8Array.of(
				0x30,
				0x16,
				0x02,
				0x01,
				0x00,
				0x30,
				0x0d,
				0x06,
				0x09,
				0x2a,
				0x86,
				0x48,
				0x86,
				0xf7,
				0x0d,
				0x01,
				0x01,
				0x01,
				0x05,
				0x00,
				0x04,
				0x02,
				0xaa,
				0xbb,
			),
		);
	});
});

describe("pemBody", () => {
	it("reads the label and body of one block", () => {
		const parsed = pemBody("-----BEGIN RSA PRIVATE KEY-----\nAQID\nBA==\n-----END RSA PRIVATE KEY-----\n");
		assert.isTrue(Result.isSuccess(parsed));
		if (Result.isSuccess(parsed)) {
			assert.strictEqual(parsed.success.label, "RSA PRIVATE KEY");
			assert.deepStrictEqual(parsed.success.der, Uint8Array.of(1, 2, 3, 4));
		}
	});

	it("rejects mismatched labels, two blocks and a non-base64 body as key without echoing the body", () => {
		const inputs = [
			"-----BEGIN PRIVATE KEY-----\nAQID\n-----END RSA PRIVATE KEY-----",
			"-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----\n-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----",
			"-----BEGIN PRIVATE KEY-----\nU0VDUkVU*U0VDUkVU\n-----END PRIVATE KEY-----",
			"-----BEGIN PRIVATE KEY-----\nU0VDUkVUU0VDUkVU=\n-----END PRIVATE KEY-----",
		];
		for (const input of inputs) {
			const parsed = pemBody(input);
			assert.isTrue(Result.isFailure(parsed), input);
			if (Result.isFailure(parsed)) {
				assert.strictEqual(parsed.failure.reason, "key");
				assert.notInclude(JSON.stringify(parsed.failure), "U0VDUkVU");
				assert.notInclude(String(parsed.failure), "U0VDUkVU");
			}
		}
	});
});
