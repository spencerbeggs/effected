import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { AVIF_BOX_BUDGET, isAvifBrand, readAvif } from "../src/internal/avif.js";
import { ascii, concat, fixture, isReason, u32be } from "./helpers.js";

const box = (type: string, ...payload: ReadonlyArray<ReadonlyArray<number>>) => {
	const body = payload.flat();
	return [...u32be(8 + body.length), ...ascii(type), ...body];
};
const fullBox = (type: string, ...payload: ReadonlyArray<ReadonlyArray<number>>) => box(type, [0, 0, 0, 0], ...payload);
const ftyp = box("ftyp", ascii("avif"), u32be(0), ascii("avifmif1miaf"));
const ispe = (w: number, h: number) => fullBox("ispe", u32be(w), u32be(h));
const avif = (...ipcoChildren: ReadonlyArray<ReadonlyArray<number>>) =>
	concat(ftyp, fullBox("meta", box("hdlr", [0]), box("iprp", box("ipco", ...ipcoChildren))));

describe("readAvif", () => {
	it("reads the fixture", () => {
		assert.deepStrictEqual(readAvif(fixture("avif.avif")), Result.succeed({ width: 17, height: 9 }));
	});

	it("picks the largest ispe (a thumbnail does not win)", () => {
		assert.deepStrictEqual(
			readAvif(avif(ispe(4, 4), box("pixi", [0]), ispe(1200, 630))),
			Result.succeed({ width: 1200, height: 630 }),
		);
	});

	it("detects the avif and avis brands, major or compatible", () => {
		assert.isTrue(isAvifBrand(concat(ftyp)));
		assert.isTrue(isAvifBrand(concat(box("ftyp", ascii("mif1"), u32be(0), ascii("miafavis")))));
		assert.isFalse(isAvifBrand(concat(box("ftyp", ascii("heic"), u32be(0), ascii("mif1heic")))));
	});

	it("thousands of filler boxes before meta exhaust the budget as malformed", () => {
		const filler = new Array(AVIF_BOX_BUDGET + 10).fill(box("free"));
		const bytes = concat(ftyp, ...filler, fullBox("meta", box("iprp", box("ipco", ispe(1, 1)))));
		assert.isTrue(isReason(readAvif(bytes), "malformed"));
	});

	it("meta without iprp is malformed", () => {
		assert.isTrue(isReason(readAvif(concat(ftyp, fullBox("meta", box("hdlr", [0])))), "malformed"));
	});

	it("ipco without any ispe is malformed", () => {
		assert.isTrue(isReason(readAvif(avif(box("pixi", [0]))), "malformed"));
	});

	it("an ispe whose payload is too short is malformed", () => {
		assert.isTrue(isReason(readAvif(avif(fullBox("ispe", u32be(4)))), "malformed"));
	});

	it("a 64-bit largesize beyond 32 bits is malformed", () => {
		const huge = [...u32be(1), ...ascii("free"), ...u32be(1), ...u32be(0)];
		assert.isTrue(isReason(readAvif(concat(ftyp, huge, new Array(64).fill(0))), "malformed"));
	});

	it("a child that overruns its parent (within the buffer) is malformed", () => {
		const meta = [...u32be(8 + 4 + 8), ...ascii("meta"), 0, 0, 0, 0, ...u32be(200), ...ascii("iprp")];
		assert.isTrue(isReason(readAvif(concat(ftyp, meta, box("free", new Array(300).fill(0)))), "malformed"));
	});

	it("a nested box that overruns the buffer too is malformed, not truncated", () => {
		const meta = [...u32be(8 + 4 + 8), ...ascii("meta"), 0, 0, 0, 0, ...u32be(0xfffffff0), ...ascii("iprp")];
		assert.isTrue(isReason(readAvif(concat(ftyp, meta)), "malformed"));
	});

	it("bytes that end before meta are truncated", () => {
		assert.isTrue(isReason(readAvif(concat(ftyp)), "truncated"));
	});
});
