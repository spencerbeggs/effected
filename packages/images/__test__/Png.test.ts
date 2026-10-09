import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { readPng } from "../src/internal/png.js";
import { ascii, concat, fixture, u32be } from "./helpers.js";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = (width: number, height: number, length = 13, type = "IHDR") =>
	concat(SIG, u32be(length), ascii(type), u32be(width), u32be(height), [8, 2, 0, 0, 0]);

describe("readPng", () => {
	it("reads the fixture's IHDR", () => {
		assert.deepStrictEqual(readPng(fixture("png.png")), Result.succeed({ width: 3, height: 2 }));
	});

	it("accepts the largest legal dimension, 2^31-1", () => {
		assert.deepStrictEqual(readPng(ihdr(0x7fffffff, 1)), Result.succeed({ width: 0x7fffffff, height: 1 }));
	});

	it("rejects 2^31 as malformed", () => {
		const result = readPng(ihdr(0x80000000, 1));
		assert.isTrue(Result.isFailure(result) && result.failure.reason === "malformed");
	});

	it("rejects a zero dimension as malformed", () => {
		const result = readPng(ihdr(0, 4));
		assert.isTrue(Result.isFailure(result) && result.failure.reason === "malformed");
	});

	it("rejects a first chunk that is not IHDR", () => {
		const result = readPng(ihdr(3, 2, 13, "IDAT"));
		assert.isTrue(Result.isFailure(result) && result.failure.reason === "malformed");
	});

	it("rejects an IHDR whose length is not 13", () => {
		const result = readPng(ihdr(3, 2, 12));
		assert.isTrue(Result.isFailure(result) && result.failure.reason === "malformed");
	});

	it("reports a header cut before the dimensions as truncated", () => {
		const result = readPng(ihdr(3, 2).subarray(0, 20));
		assert.isTrue(Result.isFailure(result) && result.failure.reason === "truncated");
	});
});
