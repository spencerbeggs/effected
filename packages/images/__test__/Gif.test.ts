import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { readGif } from "../src/internal/gif.js";
import { ascii, concat, fixture, isReason, u16le } from "./helpers.js";

describe("readGif", () => {
	it("reads the fixture's logical screen descriptor", () => {
		assert.deepStrictEqual(readGif(fixture("gif.gif")), Result.succeed({ width: 9, height: 5 }));
	});

	it("reads little-endian dimensions", () => {
		assert.deepStrictEqual(
			readGif(concat(ascii("GIF87a"), u16le(300), u16le(2))),
			Result.succeed({ width: 300, height: 2 }),
		);
	});

	it("rejects a zero dimension as malformed", () => {
		assert.isTrue(isReason(readGif(concat(ascii("GIF89a"), u16le(0), u16le(2))), "malformed"));
	});

	it("reports a descriptor cut short as truncated", () => {
		assert.isTrue(isReason(readGif(concat(ascii("GIF89a"), u16le(9), [5])), "truncated"));
	});
});
