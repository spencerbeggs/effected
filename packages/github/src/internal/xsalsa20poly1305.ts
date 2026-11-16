/**
 * XSalsa20-Poly1305 (the NaCl / libsodium `secretbox`) and HSalsa20, vendored
 * from `@noble/ciphers`, trimmed to the one-shot `crypto_box` building blocks a
 * sealed box needs.
 *
 * Upstream: https://github.com/paulmillr/noble-ciphers
 * Version: 2.4.0, commit d9e8a6a599e7ed729d9be03854c46a3c73bd9a79
 * Files: `src/salsa.ts` (`salsaCore`, `hsalsa`, the `xsalsa20poly1305`
 * construction), `src/_arx.ts` (`runCipher` and the sigma constant, the stream
 * driver `createCipher` builds), `src/_poly1305.ts` (`Poly1305`). `@noble/ciphers`
 * 1.0.0 was audited by Cure53 in 2024.
 *
 * Changes from upstream: merged into one file; removed the `TArg`/`TRet` type
 * helpers, `@example` blocks, the plain `salsa20` and `secretbox` exports, the
 * `createCipher` option machinery (short keys, counter layout options, PRGs) and
 * the `wrapCipher` argument wrapper; the stream driver is specialised to
 * XSalsa20 and works on explicit little-endian word loads and stores instead of
 * `Uint32Array` views over the caller's buffers, which drops the host
 * endianness, alignment and buffer-overlap handling; `Poly1305` is trimmed to a
 * one-shot `poly1305(message, key)` and decrypt is not carried, since a sealed
 * box is only ever written here. `salsaCore`, `hsalsa`, and the `Poly1305`
 * `process` and `finalize` arithmetic are unchanged.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2022 Paul Miller (https://paulmillr.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * @internal
 */

/** XSalsa20 needs a 32-byte key and a 24-byte nonce; Poly1305 tags are 16 bytes. */
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

const rotl = (a: number, b: number): number => (a << b) | (a >>> (32 - b));

/** Little-endian 32-bit load, independent of host endianness and alignment. */
const load32 = (bytes: Uint8Array, offset: number): number =>
	bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24) | 0;

/** The words of `bytes`, read little-endian. */
const words = (bytes: Uint8Array): Uint32Array => {
	const out = new Uint32Array(bytes.length / 4);
	for (let i = 0; i < out.length; i++) out[i] = load32(bytes, i * 4);
	return out;
};

// "expand 32-byte k", as little-endian words (RFC 8439 §2.3 constants).
const sigma32_32 = /* @__PURE__ */ (() => words(Uint8Array.from("expand 32-byte k", (c) => c.charCodeAt(0))))();

/** Uses only the low 32 bits of Salsa20's 64-bit counter state. */
// prettier-ignore
function salsaCore(
	s: Uint32Array,
	k: Uint32Array,
	n: Uint32Array,
	out: Uint32Array,
	cnt: number,
	rounds = 20,
	cntHi = 0,
): void {
	// Public wrappers expose only the low 32 bits of Salsa20's 64-bit counter; y09 stays zero
	// there. hsalsa reuses this core with its input words 2-3 in the counter positions.
	// Based on {@link https://cr.yp.to/salsa20.html | the Salsa20 reference page}.
	const y00 = s[0],
		y01 = k[0],
		y02 = k[1],
		y03 = k[2], // "expa" Key     Key     Key
		y04 = k[3],
		y05 = s[1],
		y06 = n[0],
		y07 = n[1], // Key    "nd 3"  Nonce   Nonce
		y08 = cnt,
		y09 = cntHi,
		y10 = s[2],
		y11 = k[4], // Pos.   Pos.    "2-by"	Key
		y12 = k[5],
		y13 = k[6],
		y14 = k[7],
		y15 = s[3]; // Key    Key     Key     "te k"
	// Save state to temporary variables
	let x00 = y00,
		x01 = y01,
		x02 = y02,
		x03 = y03,
		x04 = y04,
		x05 = y05,
		x06 = y06,
		x07 = y07,
		x08 = y08,
		x09 = y09,
		x10 = y10,
		x11 = y11,
		x12 = y12,
		x13 = y13,
		x14 = y14,
		x15 = y15;
	for (let r = 0; r < rounds; r += 2) {
		x04 ^= rotl((x00 + x12) | 0, 7);
		x08 ^= rotl((x04 + x00) | 0, 9);
		x12 ^= rotl((x08 + x04) | 0, 13);
		x00 ^= rotl((x12 + x08) | 0, 18);
		x09 ^= rotl((x05 + x01) | 0, 7);
		x13 ^= rotl((x09 + x05) | 0, 9);
		x01 ^= rotl((x13 + x09) | 0, 13);
		x05 ^= rotl((x01 + x13) | 0, 18);
		x14 ^= rotl((x10 + x06) | 0, 7);
		x02 ^= rotl((x14 + x10) | 0, 9);
		x06 ^= rotl((x02 + x14) | 0, 13);
		x10 ^= rotl((x06 + x02) | 0, 18);
		x03 ^= rotl((x15 + x11) | 0, 7);
		x07 ^= rotl((x03 + x15) | 0, 9);
		x11 ^= rotl((x07 + x03) | 0, 13);
		x15 ^= rotl((x11 + x07) | 0, 18);
		x01 ^= rotl((x00 + x03) | 0, 7);
		x02 ^= rotl((x01 + x00) | 0, 9);
		x03 ^= rotl((x02 + x01) | 0, 13);
		x00 ^= rotl((x03 + x02) | 0, 18);
		x06 ^= rotl((x05 + x04) | 0, 7);
		x07 ^= rotl((x06 + x05) | 0, 9);
		x04 ^= rotl((x07 + x06) | 0, 13);
		x05 ^= rotl((x04 + x07) | 0, 18);
		x11 ^= rotl((x10 + x09) | 0, 7);
		x08 ^= rotl((x11 + x10) | 0, 9);
		x09 ^= rotl((x08 + x11) | 0, 13);
		x10 ^= rotl((x09 + x08) | 0, 18);
		x12 ^= rotl((x15 + x14) | 0, 7);
		x13 ^= rotl((x12 + x15) | 0, 9);
		x14 ^= rotl((x13 + x12) | 0, 13);
		x15 ^= rotl((x14 + x13) | 0, 18);
	}
	// Write output
	let oi = 0;
	out[oi++] = (y00 + x00) | 0;
	out[oi++] = (y01 + x01) | 0;
	out[oi++] = (y02 + x02) | 0;
	out[oi++] = (y03 + x03) | 0;
	out[oi++] = (y04 + x04) | 0;
	out[oi++] = (y05 + x05) | 0;
	out[oi++] = (y06 + x06) | 0;
	out[oi++] = (y07 + x07) | 0;
	out[oi++] = (y08 + x08) | 0;
	out[oi++] = (y09 + x09) | 0;
	out[oi++] = (y10 + x10) | 0;
	out[oi++] = (y11 + x11) | 0;
	out[oi++] = (y12 + x12) | 0;
	out[oi++] = (y13 + x13) | 0;
	out[oi++] = (y14 + x14) | 0;
	out[oi++] = (y15 + x15) | 0;
}

/**
 * HSalsa20: hashes key and nonce-prefix words into the 32-byte subkey used by
 * XSalsa20 and by `crypto_box`'s shared-key derivation.
 */
// prettier-ignore
export function hsalsa(s: Uint32Array, k: Uint32Array, i: Uint32Array, out: Uint32Array): void {
	const t = new Uint32Array(16);
	salsaCore(s, k, i.subarray(0, 2), t, i[2], 20, i[3]);
	let oi = 0;
	// XSalsa20 takes words 0,5,10,15 and 6,7,8,9 as the 32-byte subkey material.
	out[oi++] = (t[0] - s[0]) | 0;
	out[oi++] = (t[5] - s[1]) | 0;
	out[oi++] = (t[10] - s[2]) | 0;
	out[oi++] = (t[15] - s[3]) | 0;
	out[oi++] = (t[6] - i[0]) | 0;
	out[oi++] = (t[7] - i[1]) | 0;
	out[oi++] = (t[8] - i[2]) | 0;
	out[oi++] = (t[9] - i[3]) | 0;
	t.fill(0);
}

/** `crypto_box_beforenm`'s second step: HSalsa20 of a shared secret with a zero nonce prefix. */
export const hsalsaKey = (sharedSecret: Uint8Array): Uint8Array => {
	const out = new Uint32Array(8);
	hsalsa(sigma32_32, words(sharedSecret), new Uint32Array(4), out);
	const bytes = new Uint8Array(KEY_BYTES);
	storeWords(out, bytes);
	return bytes;
};

/** Little-endian store of `source` words into `target` bytes. */
const storeWords = (source: Uint32Array, target: Uint8Array): void => {
	for (let i = 0; i < source.length; i++) {
		const w = source[i];
		target[i * 4] = w;
		target[i * 4 + 1] = w >>> 8;
		target[i * 4 + 2] = w >>> 16;
		target[i * 4 + 3] = w >>> 24;
	}
};

/**
 * XSalsa20 keystream XORed over `data` in place, starting at block 0. The first
 * 16 nonce bytes derive a subkey through HSalsa20; the last 8 are the Salsa20
 * nonce.
 */
function xsalsa20(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): void {
	const k32 = words(key);
	hsalsa(sigma32_32, k32, words(nonce.subarray(0, 16)), k32);
	// Salsa20's nonce words, then a zero word the core never reads.
	const n32 = new Uint32Array(3);
	n32.set(words(nonce.subarray(16, 24)));
	const block = new Uint8Array(64);
	const b32 = new Uint32Array(16);
	for (let pos = 0, counter = 0; pos < data.length; counter++) {
		salsaCore(sigma32_32, k32, n32, b32, counter);
		storeWords(b32, block);
		const take = Math.min(64, data.length - pos);
		for (let j = 0; j < take; j++) data[pos + j] ^= block[j];
		pos += take;
	}
	k32.fill(0);
	block.fill(0);
	b32.fill(0);
}

// Little-endian 2-byte load used by the Poly1305 limb decomposition.
function u8to16(a: Uint8Array, i: number) {
	return (a[i++] & 0xff) | ((a[i++] & 0xff) << 8);
}

/** Incremental Poly1305 MAC state; `poly1305` below is its one-shot use. */
class Poly1305 {
	readonly blockLen = 16;
	readonly outputLen = 16;
	private buffer = new Uint8Array(16);
	private r = new Uint16Array(10);
	private h = new Uint16Array(10);
	private pad = new Uint16Array(8);
	private pos = 0;

	constructor(key: Uint8Array) {
		const t0 = u8to16(key, 0);
		const t1 = u8to16(key, 2);
		const t2 = u8to16(key, 4);
		const t3 = u8to16(key, 6);
		const t4 = u8to16(key, 8);
		const t5 = u8to16(key, 10);
		const t6 = u8to16(key, 12);
		const t7 = u8to16(key, 14);

		// RFC 8439 §2.5.1 / RFC 7539 §2.5.1 clamp r before multiplication.
		// These masks unpack that clamped value into 13-bit limbs, while pad
		// keeps the raw s half for finalize().
		// {@link https://github.com/floodyberry/poly1305-donna/blob/e6ad6e091d30d7f4ec2d4f978be1fcfcbce72781/poly1305-donna-16.h#L47 | poly1305-donna reference}
		this.r[0] = t0 & 0x1fff;
		this.r[1] = ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
		this.r[2] = ((t1 >>> 10) | (t2 << 6)) & 0x1f03;
		this.r[3] = ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
		this.r[4] = ((t3 >>> 4) | (t4 << 12)) & 0x00ff;
		this.r[5] = (t4 >>> 1) & 0x1ffe;
		this.r[6] = ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
		this.r[7] = ((t5 >>> 11) | (t6 << 5)) & 0x1f81;
		this.r[8] = ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
		this.r[9] = (t7 >>> 5) & 0x007f;
		for (let i = 0; i < 8; i++) this.pad[i] = u8to16(key, 16 + 2 * i);
	}

	private process(data: Uint8Array, offset: number, isLast = false) {
		// RFC 8439 §2.5 / §2.5.1 and RFC 7539 §2.5 / §2.5.1 add an extra high
		// bit to every full 16-byte block. The final partial block gets its
		// explicit `1` byte during digestInto(), so `hibit` stays zero there.
		const hibit = isLast ? 0 : 1 << 11;
		const { h, r } = this;
		const r0 = r[0];
		const r1 = r[1];
		const r2 = r[2];
		const r3 = r[3];
		const r4 = r[4];
		const r5 = r[5];
		const r6 = r[6];
		const r7 = r[7];
		const r8 = r[8];
		const r9 = r[9];

		const t0 = u8to16(data, offset + 0);
		const t1 = u8to16(data, offset + 2);
		const t2 = u8to16(data, offset + 4);
		const t3 = u8to16(data, offset + 6);
		const t4 = u8to16(data, offset + 8);
		const t5 = u8to16(data, offset + 10);
		const t6 = u8to16(data, offset + 12);
		const t7 = u8to16(data, offset + 14);

		const h0 = h[0] + (t0 & 0x1fff);
		const h1 = h[1] + (((t0 >>> 13) | (t1 << 3)) & 0x1fff);
		const h2 = h[2] + (((t1 >>> 10) | (t2 << 6)) & 0x1fff);
		const h3 = h[3] + (((t2 >>> 7) | (t3 << 9)) & 0x1fff);
		const h4 = h[4] + (((t3 >>> 4) | (t4 << 12)) & 0x1fff);
		const h5 = h[5] + ((t4 >>> 1) & 0x1fff);
		const h6 = h[6] + (((t4 >>> 14) | (t5 << 2)) & 0x1fff);
		const h7 = h[7] + (((t5 >>> 11) | (t6 << 5)) & 0x1fff);
		const h8 = h[8] + (((t6 >>> 8) | (t7 << 8)) & 0x1fff);
		const h9 = h[9] + ((t7 >>> 5) | hibit);

		let c = 0;

		let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
		c = d0 >>> 13;
		d0 &= 0x1fff;
		d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
		c += d0 >>> 13;
		d0 &= 0x1fff;

		let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
		c = d1 >>> 13;
		d1 &= 0x1fff;
		d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
		c += d1 >>> 13;
		d1 &= 0x1fff;

		let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
		c = d2 >>> 13;
		d2 &= 0x1fff;
		d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
		c += d2 >>> 13;
		d2 &= 0x1fff;

		let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
		c = d3 >>> 13;
		d3 &= 0x1fff;
		d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
		c += d3 >>> 13;
		d3 &= 0x1fff;

		let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
		c = d4 >>> 13;
		d4 &= 0x1fff;
		d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
		c += d4 >>> 13;
		d4 &= 0x1fff;

		let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
		c = d5 >>> 13;
		d5 &= 0x1fff;
		d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
		c += d5 >>> 13;
		d5 &= 0x1fff;

		let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
		c = d6 >>> 13;
		d6 &= 0x1fff;
		d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
		c += d6 >>> 13;
		d6 &= 0x1fff;

		let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
		c = d7 >>> 13;
		d7 &= 0x1fff;
		d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
		c += d7 >>> 13;
		d7 &= 0x1fff;

		let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
		c = d8 >>> 13;
		d8 &= 0x1fff;
		d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
		c += d8 >>> 13;
		d8 &= 0x1fff;

		let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
		c = d9 >>> 13;
		d9 &= 0x1fff;
		d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
		c += d9 >>> 13;
		d9 &= 0x1fff;

		c = ((c << 2) + c) | 0;
		c = (c + d0) | 0;
		d0 = c & 0x1fff;
		c = c >>> 13;
		d1 += c;

		h[0] = d0;
		h[1] = d1;
		h[2] = d2;
		h[3] = d3;
		h[4] = d4;
		h[5] = d5;
		h[6] = d6;
		h[7] = d7;
		h[8] = d8;
		h[9] = d9;
	}

	private finalize() {
		const { h, pad } = this;
		const g = new Uint16Array(10);
		let c = h[1] >>> 13;
		h[1] &= 0x1fff;
		for (let i = 2; i < 10; i++) {
			h[i] += c;
			c = h[i] >>> 13;
			h[i] &= 0x1fff;
		}
		h[0] += c * 5;
		c = h[0] >>> 13;
		h[0] &= 0x1fff;
		h[1] += c;
		c = h[1] >>> 13;
		h[1] &= 0x1fff;
		h[2] += c;

		// RFC 8439 §2.5 / RFC 7539 §2.5 reduce modulo 2^130-5 before repacking
		// to 16-bit words and adding the raw s half.
		g[0] = h[0] + 5;
		c = g[0] >>> 13;
		g[0] &= 0x1fff;
		for (let i = 1; i < 10; i++) {
			g[i] = h[i] + c;
			c = g[i] >>> 13;
			g[i] &= 0x1fff;
		}
		g[9] -= 1 << 13;

		let mask = (c ^ 1) - 1;
		for (let i = 0; i < 10; i++) g[i] &= mask;
		mask = ~mask;
		for (let i = 0; i < 10; i++) h[i] = (h[i] & mask) | g[i];
		h[0] = (h[0] | (h[1] << 13)) & 0xffff;
		h[1] = ((h[1] >>> 3) | (h[2] << 10)) & 0xffff;
		h[2] = ((h[2] >>> 6) | (h[3] << 7)) & 0xffff;
		h[3] = ((h[3] >>> 9) | (h[4] << 4)) & 0xffff;
		h[4] = ((h[4] >>> 12) | (h[5] << 1) | (h[6] << 14)) & 0xffff;
		h[5] = ((h[6] >>> 2) | (h[7] << 11)) & 0xffff;
		h[6] = ((h[7] >>> 5) | (h[8] << 8)) & 0xffff;
		h[7] = ((h[8] >>> 8) | (h[9] << 5)) & 0xffff;

		let f = h[0] + pad[0];
		h[0] = f & 0xffff;
		for (let i = 1; i < 8; i++) {
			f = (((h[i] + pad[i]) | 0) + (f >>> 16)) | 0;
			h[i] = f & 0xffff;
		}
		g.fill(0);
	}

	update(data: Uint8Array): this {
		const { buffer, blockLen } = this;
		const len = data.length;

		for (let pos = 0; pos < len; ) {
			const take = Math.min(blockLen - this.pos, len - pos);
			// Fast path: we have at least one block in input
			if (take === blockLen) {
				for (; blockLen <= len - pos; pos += blockLen) this.process(data, pos);
				continue;
			}
			buffer.set(data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(buffer, 0, false);
				this.pos = 0;
			}
		}
		return this;
	}

	digest(): Uint8Array {
		const { buffer, h } = this;
		let { pos } = this;
		if (pos) {
			buffer[pos++] = 1;
			for (; pos < 16; pos++) buffer[pos] = 0;
			this.process(buffer, 0, true);
		}
		this.finalize();
		const res = new Uint8Array(this.outputLen);
		let opos = 0;
		for (let i = 0; i < 8; i++) {
			res[opos++] = h[i] >>> 0;
			res[opos++] = h[i] >>> 8;
		}
		this.r.fill(0);
		this.h.fill(0);
		this.pad.fill(0);
		buffer.fill(0);
		return res;
	}
}

/** Poly1305 MAC (RFC 8439 §2.5) of `message` under a 32-byte one-time `key`. */
const poly1305 = (message: Uint8Array, key: Uint8Array): Uint8Array => new Poly1305(key).update(message).digest();

/**
 * Encrypt and authenticate `plaintext` with XSalsa20-Poly1305 (libsodium's
 * `crypto_secretbox_easy`): returns `tag (16 bytes) || ciphertext`.
 *
 * @param plaintext - The message.
 * @param nonce - 24 bytes.
 * @param key - 32 bytes.
 *
 * @internal
 */
export function secretbox(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
	if (key.length !== KEY_BYTES) throw new RangeError(`secretbox key must be ${KEY_BYTES} bytes, got ${key.length}`);
	if (nonce.length !== NONCE_BYTES) {
		throw new RangeError(`secretbox nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
	}
	// output[0..32] = Poly1305 key, output[32..] = plaintext then ciphertext. The
	// first 32 keystream bytes are the one-time Poly1305 key, so the stream runs
	// over 32 zero bytes followed by the plaintext in a single pass.
	const work = new Uint8Array(KEY_BYTES + plaintext.length);
	work.set(plaintext, KEY_BYTES);
	xsalsa20(key, nonce, work);
	const tag = poly1305(work.subarray(KEY_BYTES), work.subarray(0, KEY_BYTES));
	const sealed = new Uint8Array(TAG_BYTES + plaintext.length);
	sealed.set(tag);
	sealed.set(work.subarray(KEY_BYTES), TAG_BYTES);
	work.fill(0);
	return sealed;
}
