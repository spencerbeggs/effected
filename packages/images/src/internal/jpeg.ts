import { u16be } from "./bytes.js";
import type { ReadResult } from "./result.js";
import { dimensions, malformed, truncated } from "./result.js";

/** Markers plus fill bytes the walk may consume before it gives up. Hostile input cannot loop past it. */
export const JPEG_STEP_BUDGET = 4096;

/** SOFn frame headers: C0-CF except C4 (DHT), C8 (JPG) and CC (DAC). */
const isFrameHeader = (marker: number): boolean =>
	marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Markers that carry no length field. */
const isStandalone = (marker: number): boolean =>
	marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);

export const readJpeg = (b: Uint8Array): ReadResult => {
	let offset = 2; // past SOI
	let steps = 0;
	for (;;) {
		if (++steps > JPEG_STEP_BUDGET) return malformed("segment walk exceeded its step budget");
		if (offset >= b.length) return truncated("ended before a frame header");
		if (b[offset] !== 0xff) return malformed(`expected a marker at offset ${offset}`);
		let at = offset + 1;
		while (at < b.length && b[at] === 0xff) {
			at++;
			if (++steps > JPEG_STEP_BUDGET) return malformed("segment walk exceeded its step budget");
		}
		if (at >= b.length) return truncated("ended inside a marker");
		const marker = b[at];
		offset = at + 1;
		if (isStandalone(marker)) continue;
		if (marker === 0xd9 || marker === 0xda) return malformed("reached end of image or a scan before any frame header");
		if (offset + 2 > b.length) return truncated("ended inside a segment length");
		const length = u16be(b, offset);
		if (length < 2) return malformed(`segment length ${length} is below 2`);
		if (isFrameHeader(marker)) {
			// length(2) precision(1) height(2) width(2) components(1), then at least one 3-byte component
			if (length < 11) return malformed(`frame header length ${length} is below 11`);
			if (offset + 7 > b.length) return truncated("ended inside the frame header");
			return dimensions(u16be(b, offset + 5), u16be(b, offset + 3));
		}
		offset += length;
	}
};
