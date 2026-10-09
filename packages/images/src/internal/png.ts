import { ascii, u32be } from "./bytes.js";
import type { ReadResult } from "./result.js";
import { dimensions, malformed, truncated } from "./result.js";

/** IHDR is the first chunk: length(4)=13, type(4)="IHDR", width(4), height(4) after the 8-byte signature. */
export const readPng = (b: Uint8Array): ReadResult => {
	if (b.length < 24) return truncated(`need 24 bytes for IHDR dimensions, have ${b.length}`);
	if (ascii(b, 12, 4) !== "IHDR") return malformed("first chunk is not IHDR");
	const length = u32be(b, 8);
	if (length !== 13) return malformed(`IHDR length ${length} is not 13`);
	return dimensions(u32be(b, 16), u32be(b, 20));
};
