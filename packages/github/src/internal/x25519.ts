/**
 * X25519 (RFC 7748) scalar multiplication, vendored from `@noble/curves`,
 * trimmed to the Montgomery ladder over curve25519 and the field helpers it
 * needs.
 *
 * Upstream: https://github.com/paulmillr/noble-curves
 * Version: 2.4.0, commit 656c4364dffa44c64aa0c49914b8000b278b67a9
 * Files: `src/abstract/montgomery.ts` (`cmask`, `cswap`, `montgomeryLadder`,
 * `decodeU`, `decodeScalar`, the low-order input check, `scalarMult`),
 * `src/ed25519.ts` (`ed25519_pow_2_252_3`, `adjustScalarBytes`, the x25519
 * `powPminus2`), `src/abstract/modular.ts` (`mod`, `pow2`), and the byte/number
 * conversions from `src/utils.ts`. `@noble/curves` 1.0.0 was audited by Cure53
 * in 2023.
 *
 * Changes from upstream: merged into one file; removed the `TArg`/`TRet` type
 * helpers, `@example` blocks, X448, the generic `montgomery()` factory and its
 * option validation, `keygen`/`randomSecretKey` (the caller draws secret keys
 * from `globalThis.crypto.getRandomValues`), the Edwards-table fixed-base
 * shortcut (the base point goes through the same ladder as any other point, which
 * upstream does when no shortcut is supplied), and the `__TEST` hook. Byte and
 * number conversions are inlined for fixed 32-byte little-endian values. The
 * ladder, `cswap`/`cmask`, the `x^(p-2)` addition chain, scalar clamping and
 * the low-order rejection are unchanged.
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

const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _2n = /* @__PURE__ */ BigInt(2);
const _3n = /* @__PURE__ */ BigInt(3);
const _5n = /* @__PURE__ */ BigInt(5);

const FIELD_BYTES = 32;
const MONTGOMERY_BITS = 255;
// The field prime 2^255 - 19.
const P = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
// The base point's u-coordinate.
const Gu = /* @__PURE__ */ BigInt(9);
// RFC 7748 §5: a24 = (486662 - 2) / 4 = 121665 for curve25519.
const a24 = /* @__PURE__ */ BigInt(121665);
// RFC: x25519 "the resulting integer is of the form 2^254 plus
// eight times a value between 0 and 2^251 - 1 (inclusive)"
const minScalar = _2n ** BigInt(254);
const maxAdded = BigInt(8) * (_2n ** BigInt(251) - _1n);
const maxScalar = minScalar + maxAdded + _1n; // (inclusive)

const mod = (a: bigint, b: bigint): bigint => {
	const result = a % b;
	return result >= _0n ? result : b + result;
};

// Repeatedly square `x` `power` times, modulo `modulo`.
function pow2(x: bigint, power: bigint, modulo: bigint): bigint {
	let res = x;
	while (power-- > _0n) {
		res *= res;
		res %= modulo;
	}
	return res;
}

const modP = (n: bigint) => mod(n, P);

// Little-endian bytes to bigint.
const bytesToNumberLE = (bytes: Uint8Array): bigint => {
	let n = _0n;
	for (let i = bytes.length - 1; i >= 0; i--) n = (n << BigInt(8)) | BigInt(bytes[i]);
	return n;
};

// Bigint to fixed-length little-endian bytes.
const numberToBytesLE = (n: bigint, len: number): Uint8Array => {
	const out = new Uint8Array(len);
	let rest = n;
	for (let i = 0; i < len; i++) {
		out[i] = Number(rest & BigInt(0xff));
		rest >>= BigInt(8);
	}
	return out;
};

function ed25519_pow_2_252_3(x: bigint) {
	// prettier-ignore
	const _10n = BigInt(10),
		_20n = BigInt(20),
		_40n = BigInt(40),
		_80n = BigInt(80);

	const x2 = (x * x) % P;
	const b2 = (x2 * x) % P; // x^3, 11
	const b4 = (pow2(b2, _2n, P) * b2) % P; // x^15, 1111
	const b5 = (pow2(b4, _1n, P) * x) % P; // x^31
	const b10 = (pow2(b5, _5n, P) * b5) % P;
	const b20 = (pow2(b10, _10n, P) * b10) % P;
	const b40 = (pow2(b20, _20n, P) * b20) % P;
	const b80 = (pow2(b40, _40n, P) * b40) % P;
	const b160 = (pow2(b80, _80n, P) * b80) % P;
	const b240 = (pow2(b160, _80n, P) * b80) % P;
	const b250 = (pow2(b240, _10n, P) * b10) % P;
	const pow_p_5_8 = (pow2(b250, _2n, P) * x) % P;
	// ^ This is x^((p-5)/8); multiply by x once more to get x^((p+3)/8).
	return { pow_p_5_8, b2 };
}

// Mutates and returns the provided 32-byte buffer in place.
function adjustScalarBytes(bytes: Uint8Array): Uint8Array {
	// Section 5: For X25519, in order to decode 32 random bytes as an integer scalar,
	// set the three least significant bits of the first byte
	bytes[0] &= 248; // 0b1111_1000
	// and the most significant bit of the last to zero,
	bytes[31] &= 127; // 0b0111_1111
	// set the second most significant bit of the last byte to 1
	bytes[31] |= 64; // 0b0100_0000
	return bytes;
}

// x^(p-2) aka x^(2^255-21)
const powPminus2 = (x: bigint): bigint => {
	const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
	return mod(pow2(pow_p_5_8, _3n, P) * b2, P);
};

// cswap from RFC7748 "example code", adapted to BigInt.
//
// RFC: "dummy = mask(swap) AND (x_2 XOR x_3), where mask(swap) is the all-1 or all-0 word of the
// same length as x_2 and x_3". On fixed-width machine words both cases cost the same. BigInt has
// no fixed width, so a {0n, 1n} selector does not: V8 short-circuits `0n * v` - and, identically,
// `0n & v`, `v + 0n`, `v - 0n` - to a no-op, while `1n * v` is a real multiply. The ladder calls
// this with swap = k_t XOR k_(t+1), which would make total running time a linear function of how
// often adjacent bits of the secret scalar differ: remotely measurable, and worth ~4 bits of a
// long-term key.
//
// So select with a full-width mask instead, and interpolate rather than mask off a dummy.

/**
 * Selector for cswap(): `P` to keep, `P + 1` to swap, chosen by the low bit of `swap`.
 * Higher bits are ignored, and `swap` is passed in whole rather than as a {0n, 1n} bit on
 * purpose: `P + (swap & _1n)` would short-circuit the addition whenever the bit is clear, which
 * is the very leak this construction avoids, one round-trip further down. Subtracting `swap`
 * with its low bit cleared keeps every operand full-width instead.
 * @param P - Field modulus.
 * @param swap - Value whose low bit selects; ignored above that bit.
 * @returns `P` when the low bit is clear, `P + 1` when it is set.
 */
function cmask(P: bigint, swap: bigint): bigint {
	return P + swap - ((swap >> _1n) << _1n);
}

/**
 * Swap two field elements when `mask` is `P + 1`, keep them when it is `P`:
 *
 *   d    = 6P + x_3 - x_2
 *   x_2' = d * mask + x_2   (mod P)      x_3' = (x_2 + x_3) - x_2'
 *
 * The extra `6P * mask` vanishes modulo P, so `mask === P` leaves x_2 and `mask === P + 1`
 * leaves x_3. Without the offset, the reduction dividend changes sign with input order and crosses
 * BigInt limb boundaries; those classes measured differently on the tested Node/V8 build. For
 * canonical inputs, the deliberately left-associative `offset + x_3 - x_2` is between 5P and 7P,
 * keeping the dividend positive and in one word-count band for both RFC fields and masks. Six is
 * the smallest coefficient `c` for which the shared offset `cP` has that property.
 *
 * This reduced the tested sign/size timing ratios, but JavaScript BigInt has no constant-time
 * contract and the contents of the multiply and remainder still vary. Valid ladder states can
 * contain genuine zero coordinates; this construction does not mask those value-shape effects.
 * Computing `x_3'` independently as `((6P + x_2 - x_3) * mask + x_3) % P` is more symmetric.
 * On the tested Node/V8 build, it reduced the timing difference between keeping `(0, v)` and
 * swapping `(v, 0)`—both return `(0, v)`—from about 10%/13% for X25519/X448 to about 3%.
 * Successful calls cannot reach that zero-in-the-first-output case. For the case they can reach,
 * swapping `(0, v)` and keeping `(v, 0)` both return `(v, 0)`; the difference instead grew from
 * about 0.7%/1.1% to 2.7%/2.8%. The extra multiply/remainder also made public
 * `getSharedSecret()` about 16% slower. The retained one-remainder form measured about 2.5%
 * slower than the prior helper for public X25519 `getSharedSecret()` in the same environment.
 * x_3' falls out of the sum, which a swap leaves invariant: no second multiply or reduction is
 * needed. Bind `6P` once per field so production and the timing regression exercise the same
 * configured helper without paying for the multiplication in every ladder round.
 *
 * The returned function is called twice per ladder round, so it validates nothing. Both elements
 * MUST already be reduced mod P; unreduced input silently corrupts the kept-side output.
 * @param P - Field modulus.
 * @returns A field-bound swap function taking mask, x_2, and x_3.
 */
function cswap(P: bigint): (mask: bigint, x_2: bigint, x_3: bigint) => { x_2: bigint; x_3: bigint } {
	const offset = BigInt(6) * P;
	return (mask: bigint, x_2: bigint, x_3: bigint): { x_2: bigint; x_3: bigint } => {
		const sum = x_2 + x_3;
		const d = offset + x_3 - x_2;
		const a = (d * mask + x_2) % P;
		return { x_2: a, x_3: sum - a };
	};
}

/** Internal helpers, exported for tests only. Not part of the public API. */

// Low-order points: useless as public keys, rejected before the ladder runs.
const lowOrderU = new Set([
	_0n,
	_1n,
	P - _1n,
	BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
	BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823"),
]);

const swap = cswap(P);

function decodeU(u: Uint8Array): bigint {
	const _u = Uint8Array.from(u);
	// RFC: When receiving such an array, implementations of X25519
	// (but not X448) MUST mask the most significant bit in the final byte.
	_u[31] &= 127; // 0b0111_1111
	// RFC: Implementations MUST accept non-canonical values and process them as
	// if they had been reduced modulo the field prime.
	return modP(bytesToNumberLE(_u));
}

function decodeScalar(scalar: Uint8Array): bigint {
	return bytesToNumberLE(adjustScalarBytes(Uint8Array.from(scalar)));
}

function inRange(title: string, n: bigint, min: bigint, max: bigint): void {
	if (!(min <= n && n < max)) throw new RangeError("expected valid " + title);
}

function montgomeryLadder(u: bigint, scalar: bigint): bigint {
	inRange("u", u, _0n, P);
	inRange("scalar", scalar, minScalar, maxScalar);
	const k = scalar;
	const x_1 = u;
	let x_2 = _1n;
	let z_2 = _0n;
	let x_3 = u;
	let z_3 = _1n;
	// The RFC tracks `swap` across rounds to hold k_t XOR k_(t+1); the low bit of `kx >> t` is
	// the same value, without the carried state. aInRange above pins bit (MONTGOMERY_BITS - 1)
	// of k set and everything above it clear, so `kx >> t` is never zero and its width is a
	// function of t alone - never of a secret bit.
	const kx = k ^ (k >> _1n);
	for (let t = BigInt(MONTGOMERY_BITS - 1); t >= _0n; t--) {
		const mask = cmask(P, kx >> t);
		({ x_2, x_3 } = swap(mask, x_2, x_3));
		({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));

		const A = x_2 + z_2;
		const AA = modP(A * A);
		const B = x_2 - z_2;
		const BB = modP(B * B);
		const E = AA - BB;
		const C = x_3 + z_3;
		const D = x_3 - z_3;
		const DA = modP(D * A);
		const CB = modP(C * B);
		const dacb = DA + CB;
		const da_cb = DA - CB;
		x_3 = modP(dacb * dacb);
		z_3 = modP(x_1 * modP(da_cb * da_cb));
		x_2 = modP(AA * BB);
		z_2 = modP(E * (AA + modP(a24 * E)));
	}
	// trailing cswap: the RFC's `swap` holds k_0 here, which is the low bit of k
	const mask = cmask(P, k);
	({ x_2, x_3 } = swap(mask, x_2, x_3));
	({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
	const z2 = powPminus2(z_2); // `Fp.pow(x, P - _2n)` is much slower equivalent
	return modP(x_2 * z2); // Return x_2 * (z_2^(p - 2))
}

/**
 * X25519 scalar multiplication: the shared secret of `secretKey` and the peer's
 * `u` coordinate, or a public key when `u` is the base point.
 *
 * @remarks
 * Throws on a low-order `u`, which no honest peer produces: the check runs before
 * the ladder so an attacker-chosen point never touches the secret scalar.
 *
 * @internal
 */
export function x25519(secretKey: Uint8Array, u: Uint8Array): Uint8Array {
	if (secretKey.length !== FIELD_BYTES) throw new RangeError(`x25519 scalar must be ${FIELD_BYTES} bytes`);
	if (u.length !== FIELD_BYTES) throw new RangeError(`x25519 u coordinate must be ${FIELD_BYTES} bytes`);
	const pointU = decodeU(u);
	if (lowOrderU.has(pointU)) throw new Error("invalid private or public key received");
	const pu = montgomeryLadder(pointU, decodeScalar(secretKey));
	if (pu === _0n) throw new Error("invalid private or public key received");
	return numberToBytesLE(modP(pu), FIELD_BYTES);
}

/** The base point's u-coordinate, encoded: `9` followed by 31 zero bytes. */
const BASE_POINT = /* @__PURE__ */ numberToBytesLE(Gu, FIELD_BYTES);

/** The X25519 public key for `secretKey`. */
export const x25519PublicKey = (secretKey: Uint8Array): Uint8Array => x25519(secretKey, BASE_POINT);
