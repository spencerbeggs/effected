/**
 * BLAKE2b (RFC 7693) with a variable output length, vendored from
 * `@noble/hashes`, trimmed to an unkeyed one-shot `blake2b(message, outLen)`.
 *
 * Upstream: https://github.com/paulmillr/noble-hashes
 * Version: 2.4.0, commit 663c2aeeffc308ac0cded59bd32f7c212adacfc2
 * Files: `src/blake2.ts` (`G1b`, `G2b`, the compression round loop, the
 * `_BLAKE2b` initialisation and digest layout), `src/_blake.ts` (`BSIGMA`),
 * and the 64-bit helpers they use from `src/_ts`. `@noble/hashes` 1.0.0 was
 * audited by Cure53 in 2022.
 *
 * Changes from upstream: merged into one file; removed the `TArg`/`TRet` type
 * helpers, `@example` blocks, BLAKE2s, keyed, salted and personalised modes, and
 * the incremental `update`/`digest`/`clone` class with its `Uint32Array` views
 * over caller buffers, which the one-shot function replaces; message words are
 * read with explicit little-endian loads, which drops the host-endianness and
 * alignment handling; the `BSIGMA` table keeps only the twelve rows BLAKE2b
 * uses. `G1b`, `G2b`, the u64 helpers, the IV and the compression function are
 * unchanged.
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

const BLOCK_BYTES = 128;
const MAX_OUT_BYTES = 64;

// --- 64-bit helpers on (high, low) 32-bit halves, from `src/_ts` ---

// High 32-bit half of a 64-bit right rotate, valid for `s` in `1..31`.
const rotrSH = (h: number, l: number, s: number): number => (h >>> s) | (l << (32 - s));
// Low 32-bit half of a 64-bit right rotate, valid for `s` in `1..31`.
const rotrSL = (h: number, l: number, s: number): number => (h << (32 - s)) | (l >>> s);
// High 32-bit half of a 64-bit right rotate, valid for `s` in `33..63`.
const rotrBH = (h: number, l: number, s: number): number => (h << (64 - s)) | (l >>> (s - 32));
// Low 32-bit half of a 64-bit right rotate, valid for `s` in `33..63`.
const rotrBL = (h: number, l: number, s: number): number => (h >>> (s - 32)) | (l << (64 - s));
// High 32-bit half of a 64-bit right rotate for `s === 32`.
const rotr32H = (_h: number, l: number): number => l;
// Low 32-bit half of a 64-bit right rotate for `s === 32`.
const rotr32L = (h: number, _l: number): number => h;

// Add two split 64-bit words and return the split `{ h, l }` sum.
function add(
	Ah: number,
	Al: number,
	Bh: number,
	Bl: number,
): {
	h: number;
	l: number;
} {
	const l = (Al >>> 0) + (Bl >>> 0);
	return { h: (Ah + Bh + ((l / 2 ** 32) | 0)) | 0, l: l | 0 };
}
// Unmasked low-word accumulator for 3-way addition; pass the raw result into `add3H(...)`.
const add3L = (Al: number, Bl: number, Cl: number): number => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
// High-word finalize step for 3-way addition; `low` must be the untruncated output of `add3L(...)`.
const add3H = (low: number, Ah: number, Bh: number, Ch: number): number => (Ah + Bh + Ch + ((low / 2 ** 32) | 0)) | 0;
// Split a JS number into u32 halves without a BigInt allocation (exact for 0 <= n < 2**53).
const fromNumH = (n: number): number => (n / 2 ** 32) | 0;
const fromNumL = (n: number): number => n >>> 0;

// --- BLAKE2b ---

// prettier-ignore
const BSIGMA = /* @__PURE__ */ Uint8Array.from([
	0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3, 11, 8, 12,
	0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4, 7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8, 9, 0, 5, 7, 2, 4, 10,
	15, 14, 1, 11, 12, 6, 8, 3, 13, 2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9, 12, 5, 1, 15, 14, 13, 4, 10, 0,
	7, 6, 3, 9, 2, 8, 11, 13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10, 6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7,
	1, 4, 10, 5, 10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
	15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
]);

// Same IV words as `SHA512_IV`, but endian-swapped into LE u32 low/high halves
// for the BLAKE2b u64 helpers below.
const B2B_IV = /* @__PURE__ */ Uint32Array.from([
	0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1,
	0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
// Shared synchronous BLAKE2b work vector as LE u32 low/high halves.
const BBUF = /* @__PURE__ */ new Uint32Array(32);

// BLAKE2b G mix split into two half-rounds over LE u32 low/high limbs.
function G1b(a: number, b: number, c: number, d: number, msg: Uint32Array, x: number) {
	// NOTE: V is LE here
	const Xl = msg[x],
		Xh = msg[x + 1]; // prettier-ignore
	let Al = BBUF[2 * a],
		Ah = BBUF[2 * a + 1]; // prettier-ignore
	let Bl = BBUF[2 * b],
		Bh = BBUF[2 * b + 1]; // prettier-ignore
	let Cl = BBUF[2 * c],
		Ch = BBUF[2 * c + 1]; // prettier-ignore
	let Dl = BBUF[2 * d],
		Dh = BBUF[2 * d + 1]; // prettier-ignore
	// v[a] = (v[a] + v[b] + x) | 0;
	const ll = add3L(Al, Bl, Xl);
	Ah = add3H(ll, Ah, Bh, Xh);
	Al = ll | 0;
	// v[d] = rotr(v[d] ^ v[a], 32)
	let xh = Dh ^ Ah,
		xl = Dl ^ Al; // prettier-ignore
	Dh = rotr32H(xh, xl);
	Dl = rotr32L(xh, xl);
	// v[c] = (v[c] + v[d]) | 0;
	({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
	// v[b] = rotr(v[b] ^ v[c], 24)
	xh = Bh ^ Ch;
	xl = Bl ^ Cl;
	Bh = rotrSH(xh, xl, 24);
	Bl = rotrSL(xh, xl, 24);
	BBUF[2 * a] = Al;
	BBUF[2 * a + 1] = Ah;
	BBUF[2 * b] = Bl;
	BBUF[2 * b + 1] = Bh;
	BBUF[2 * c] = Cl;
	BBUF[2 * c + 1] = Ch;
	BBUF[2 * d] = Dl;
	BBUF[2 * d + 1] = Dh;
}

// Second half-round of the same LE-limb BLAKE2b G mix; `x` is the message word offset.
function G2b(a: number, b: number, c: number, d: number, msg: Uint32Array, x: number) {
	// NOTE: V is LE here
	const Xl = msg[x],
		Xh = msg[x + 1]; // prettier-ignore
	let Al = BBUF[2 * a],
		Ah = BBUF[2 * a + 1]; // prettier-ignore
	let Bl = BBUF[2 * b],
		Bh = BBUF[2 * b + 1]; // prettier-ignore
	let Cl = BBUF[2 * c],
		Ch = BBUF[2 * c + 1]; // prettier-ignore
	let Dl = BBUF[2 * d],
		Dh = BBUF[2 * d + 1]; // prettier-ignore
	// v[a] = (v[a] + v[b] + x) | 0;
	const ll = add3L(Al, Bl, Xl);
	Ah = add3H(ll, Ah, Bh, Xh);
	Al = ll | 0;
	// v[d] = rotr(v[d] ^ v[a], 16)
	let xh = Dh ^ Ah,
		xl = Dl ^ Al; // prettier-ignore
	Dh = rotrSH(xh, xl, 16);
	Dl = rotrSL(xh, xl, 16);
	// v[c] = (v[c] + v[d]) | 0;
	({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
	// v[b] = rotr(v[b] ^ v[c], 63)
	xh = Bh ^ Ch;
	xl = Bl ^ Cl;
	Bh = rotrBH(xh, xl, 63);
	Bl = rotrBL(xh, xl, 63);
	BBUF[2 * a] = Al;
	BBUF[2 * a + 1] = Ah;
	BBUF[2 * b] = Bl;
	BBUF[2 * b + 1] = Bh;
	BBUF[2 * c] = Cl;
	BBUF[2 * c + 1] = Ch;
	BBUF[2 * d] = Dl;
	BBUF[2 * d + 1] = Dh;
}

/**
 * BLAKE2b digest of `message`, `outLen` bytes long (1..64). Unkeyed.
 *
 * @param message - The bytes to hash.
 * @param outLen - The digest length in bytes; libsodium's sealed-box nonce is 24.
 *
 * @internal
 */
export function blake2b(message: Uint8Array, outLen: number): Uint8Array {
	if (!Number.isInteger(outLen) || outLen < 1 || outLen > MAX_OUT_BYTES) {
		throw new RangeError(`blake2b outLen must be 1..${MAX_OUT_BYTES}, got ${outLen}`);
	}
	// State words as little-endian low/high halves, initialised from the IV with
	// RFC 7693 §2.5's parameter block (`0x0101kknn`, no key) xored into h[0].
	const state = Uint32Array.from(B2B_IV.subarray(0, 16));
	state[0] ^= outLen | (0x01 << 16) | (0x01 << 24);
	const block = new Uint8Array(BLOCK_BYTES);
	const msg = new Uint32Array(32);
	const total = message.length;
	let pos = 0;
	let length = 0;
	// Every block but the last is full; the last (possibly empty, for an empty
	// message) is zero-padded and carries the finalisation flag.
	for (;;) {
		const take = Math.min(BLOCK_BYTES, total - pos);
		const isLast = total - pos <= BLOCK_BYTES;
		block.fill(0);
		block.set(message.subarray(pos, pos + take));
		for (let i = 0; i < 32; i++) {
			const o = i * 4;
			msg[i] = block[o] | (block[o + 1] << 8) | (block[o + 2] << 16) | (block[o + 3] << 24) | 0;
		}
		pos += take;
		length += take;
		compress(state, msg, length, isLast);
		if (isLast) break;
	}
	const out = new Uint8Array(MAX_OUT_BYTES);
	for (let i = 0; i < 16; i++) {
		const w = state[i];
		out[i * 4] = w;
		out[i * 4 + 1] = w >>> 8;
		out[i * 4 + 2] = w >>> 16;
		out[i * 4 + 3] = w >>> 24;
	}
	return out.slice(0, outLen);
}

/** One BLAKE2b compression: folds `msg` (32 LE words) into `state` (16 LE words). */
function compress(state: Uint32Array, msg: Uint32Array, length: number, isLast: boolean): void {
	// First half from state, second half from IV.
	BBUF.set(state);
	BBUF.set(B2B_IV, 16);
	const l = fromNumL(length);
	const h = fromNumH(length);
	BBUF[24] = B2B_IV[8] ^ l; // Low word of the offset.
	BBUF[25] = B2B_IV[9] ^ h; // High word.
	// Invert all bits for last block
	if (isLast) {
		BBUF[28] = ~BBUF[28];
		BBUF[29] = ~BBUF[29];
	}
	let j = 0;
	const s = BSIGMA;
	// SIGMA selects 64-bit message words; multiply by 2 because `msg` stores
	// each word as [low32, high32].
	for (let i = 0; i < 12; i++) {
		G1b(0, 4, 8, 12, msg, 2 * s[j++]);
		G2b(0, 4, 8, 12, msg, 2 * s[j++]);
		G1b(1, 5, 9, 13, msg, 2 * s[j++]);
		G2b(1, 5, 9, 13, msg, 2 * s[j++]);
		G1b(2, 6, 10, 14, msg, 2 * s[j++]);
		G2b(2, 6, 10, 14, msg, 2 * s[j++]);
		G1b(3, 7, 11, 15, msg, 2 * s[j++]);
		G2b(3, 7, 11, 15, msg, 2 * s[j++]);

		G1b(0, 5, 10, 15, msg, 2 * s[j++]);
		G2b(0, 5, 10, 15, msg, 2 * s[j++]);
		G1b(1, 6, 11, 12, msg, 2 * s[j++]);
		G2b(1, 6, 11, 12, msg, 2 * s[j++]);
		G1b(2, 7, 8, 13, msg, 2 * s[j++]);
		G2b(2, 7, 8, 13, msg, 2 * s[j++]);
		G1b(3, 4, 9, 14, msg, 2 * s[j++]);
		G2b(3, 4, 9, 14, msg, 2 * s[j++]);
	}
	for (let i = 0; i < 16; i++) state[i] ^= BBUF[i] ^ BBUF[i + 16];
	BBUF.fill(0);
}
