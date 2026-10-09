import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { readWebp } from "../src/internal/webp.js";
import { ascii, concat, fixture, isReason, u16le, u24le, u32le } from "./helpers.js";

const riff = (fourcc: string, payload: ReadonlyArray<number>) =>
	concat(ascii("RIFF"), u32le(4 + 8 + payload.length), ascii("WEBP"), ascii(fourcc), u32le(payload.length), payload);

describe("readWebp", () => {
	it("reads all three fixture variants", () => {
		assert.deepStrictEqual(readWebp(fixture("lossy.webp")), Result.succeed({ width: 11, height: 6 }));
		assert.deepStrictEqual(readWebp(fixture("lossless.webp")), Result.succeed({ width: 13, height: 7 }));
		assert.deepStrictEqual(readWebp(fixture("alpha.webp")), Result.succeed({ width: 15, height: 8 }));
	});

	it("VP8: masks the 2 scale bits off each 16-bit dimension", () => {
		const payload = [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(0xc000 | 640), ...u16le(0x4000 | 480)];
		assert.deepStrictEqual(readWebp(riff("VP8 ", payload)), Result.succeed({ width: 640, height: 480 }));
	});

	it("VP8: a bad start code is malformed", () => {
		const payload = [0, 0, 0, 0x9d, 0x01, 0x2b, ...u16le(640), ...u16le(480)];
		assert.isTrue(isReason(readWebp(riff("VP8 ", payload)), "malformed"));
	});

	it("VP8L: decodes the 14-bit packed width-1/height-1", () => {
		// width 16384, height 16384: both fields all ones (0x3fff)
		const payload = [0x2f, 0xff, 0xff, 0xff, 0x0f];
		assert.deepStrictEqual(readWebp(riff("VP8L", payload)), Result.succeed({ width: 16384, height: 16384 }));
	});

	it("VP8L: a bad signature byte is malformed", () => {
		assert.isTrue(isReason(readWebp(riff("VP8L", [0x2e, 0, 0, 0, 0])), "malformed"));
	});

	it("VP8X: reads 24-bit canvas width-1/height-1", () => {
		const payload = [0x10, 0, 0, 0, ...u24le(1199), ...u24le(629)];
		assert.deepStrictEqual(readWebp(riff("VP8X", payload)), Result.succeed({ width: 1200, height: 630 }));
	});

	it("an unknown first chunk is malformed", () => {
		assert.isTrue(isReason(readWebp(riff("ANIM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "malformed"));
	});

	it("a header cut inside the first chunk is truncated", () => {
		assert.isTrue(isReason(readWebp(riff("VP8X", [0x10, 0, 0, 0, ...u24le(1199)])), "truncated"));
		assert.isTrue(isReason(readWebp(concat(ascii("RIFF"), u32le(4), ascii("WEBP"), ascii("VP"))), "truncated"));
	});
});
