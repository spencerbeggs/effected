// PEM armour and the one DER structure this package builds: the PKCS#8
// `PrivateKeyInfo` around a PKCS#1 `RSAPrivateKey`. WebCrypto imports only
// PKCS#8, and github.com hands out App keys as PKCS#1
// (`BEGIN RSA PRIVATE KEY`), so the wrap is what lets those keys import on a
// runtime with no `node:crypto`.
//
// Nothing here may echo key material: a failure names what was wrong with
// the armour, never the bytes, and never attaches core's `EncodingError`
// (whose `input` is the whole base64 body) as a cause.

import { Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { JwtError } from "../JwtError.js";
import { concat } from "./bytes.js";

/**
 * A DER definite length: one byte below 128, else `0x80 | n` followed by
 * the length in n big-endian bytes (X.690 §8.1.3).
 *
 * @internal
 */
export const derLength = (length: number): Uint8Array => {
	if (length < 0x80) return Uint8Array.of(length);
	const bytes: Array<number> = [];
	for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
	return Uint8Array.of(0x80 | bytes.length, ...bytes);
};

const tlv = (tag: number, value: Uint8Array): Uint8Array =>
	concat([Uint8Array.of(tag), derLength(value.byteLength), value]);

// INTEGER 0 — the PrivateKeyInfo version.
const version = Uint8Array.of(0x02, 0x01, 0x00);
// SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
const rsaAlgorithmIdentifier = Uint8Array.of(
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
);

/**
 * Wrap a DER PKCS#1 `RSAPrivateKey` in a PKCS#8 `PrivateKeyInfo`:
 * `SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING pkcs1 }`.
 *
 * @internal
 */
export const wrapPkcs1 = (pkcs1: Uint8Array): Uint8Array =>
	tlv(0x30, concat([version, rsaAlgorithmIdentifier, tlv(0x04, pkcs1)]));

const armour = /^-----BEGIN ([A-Z0-9 ]+)-----\r?\n([A-Za-z0-9+/=\s]+?)\r?\n-----END \1-----\s*$/;

/**
 * The label and DER body of a single PEM block.
 *
 * @remarks
 * Exactly one block, nothing before it; whitespace inside the body is
 * ignored. A two-character escaped newline (backslash, `n`) is read as a
 * newline first, because keys are often carried in a one-line environment
 * variable; a backslash cannot occur in PEM armour or base64, so the
 * rewrite never changes a well-formed key. Every failure is `key` and
 * carries no part of the input.
 *
 * @internal
 */
export const pemBody = (pem: string): Result.Result<{ readonly label: string; readonly der: Uint8Array }, JwtError> => {
	const match = armour.exec(pem.replace(/\\n/g, "\n").trim());
	if (match === null) return Result.fail(JwtError.of("key", "the key is not a single PEM block"));
	const [, label = "", body = ""] = match;
	const der = Base64.decode(body.replace(/\s+/g, ""));
	if (Result.isFailure(der) || der.success.byteLength === 0) {
		return Result.fail(JwtError.of("key", `the ${label} PEM body is not base64`));
	}
	return Result.succeed({ label, der: der.success });
};
