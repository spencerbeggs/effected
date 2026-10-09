import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { JPEG_STEP_BUDGET, readJpeg } from "../src/internal/jpeg.js";
import { concat, fixture, isReason, u16be } from "./helpers.js";

const SOI = [0xff, 0xd8];
const sof = (marker: number, width: number, height: number) => [
	0xff,
	marker,
	...u16be(11),
	8,
	...u16be(height),
	...u16be(width),
	1,
	1,
	0x11,
	0,
];
const segment = (marker: number, payload: ReadonlyArray<number>) => [
	0xff,
	marker,
	...u16be(payload.length + 2),
	...payload,
];

describe("readJpeg", () => {
	it("reads baseline (SOF0) and progressive (SOF2) fixtures", () => {
		assert.deepStrictEqual(readJpeg(fixture("baseline.jpg")), Result.succeed({ width: 5, height: 3 }));
		assert.deepStrictEqual(readJpeg(fixture("progressive.jpg")), Result.succeed({ width: 7, height: 4 }));
	});

	it("skips an APP1 payload that embeds a thumbnail SOF (review focus 2)", () => {
		const thumbnail = [0xff, 0xc0, ...u16be(11), 8, ...u16be(1), ...u16be(1), 1, 1, 0x11, 0];
		const bytes = concat(SOI, segment(0xe1, [...thumbnail, 0, 0]), sof(0xc0, 1200, 630));
		assert.deepStrictEqual(readJpeg(bytes), Result.succeed({ width: 1200, height: 630 }));
	});

	it("does not mistake DHT (C4), JPG (C8) or DAC (CC) for a frame header", () => {
		const bytes = concat(SOI, segment(0xc4, [0, 0]), segment(0xc8, [0]), segment(0xcc, [0, 0]), sof(0xc1, 9, 4));
		assert.deepStrictEqual(readJpeg(bytes), Result.succeed({ width: 9, height: 4 }));
	});

	it("tolerates fill bytes and standalone RST markers between segments", () => {
		const bytes = concat(SOI, [0xff, 0xff, 0xff], [0xff, 0xd0], sof(0xc0, 3, 2));
		assert.deepStrictEqual(readJpeg(bytes), Result.succeed({ width: 3, height: 2 }));
	});

	it("endless fill bytes exhaust the budget as malformed", () => {
		const bytes = concat(SOI, new Array(JPEG_STEP_BUDGET * 3).fill(0xff), [0x00]);
		assert.isTrue(isReason(readJpeg(bytes), "malformed"));
	});

	it("endless minimal APP0 segments exhaust the budget as malformed", () => {
		const app0 = segment(0xe0, []);
		const bytes = concat(SOI, ...new Array(JPEG_STEP_BUDGET + 10).fill(app0), sof(0xc0, 3, 2));
		assert.isTrue(isReason(readJpeg(bytes), "malformed"));
	});

	it("a scan before any frame header is malformed", () => {
		assert.isTrue(isReason(readJpeg(concat(SOI, segment(0xda, [0, 0]))), "malformed"));
	});

	it("a segment length below 2 is malformed", () => {
		assert.isTrue(isReason(readJpeg(concat(SOI, [0xff, 0xe0, 0, 1])), "malformed"));
	});

	it("a non-marker byte where a marker belongs is malformed", () => {
		assert.isTrue(isReason(readJpeg(concat(SOI, [0x12, 0x34])), "malformed"));
	});

	it("a zero height (DNL-deferred) is malformed", () => {
		assert.isTrue(isReason(readJpeg(concat(SOI, sof(0xc0, 5, 0))), "malformed"));
	});

	it("a frame header declaring a length below 11 is malformed", () => {
		const bytes = concat(SOI, [0xff, 0xc0, ...u16be(2), 8, ...u16be(3), ...u16be(5), 1, 1, 0x11, 0]);
		assert.isTrue(isReason(readJpeg(bytes), "malformed"));
	});

	it("a frame header cut short is truncated", () => {
		assert.isTrue(isReason(readJpeg(concat(SOI, sof(0xc0, 5, 3)).subarray(0, 8)), "truncated"));
	});
});
