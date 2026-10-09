import { ascii, u16le, u24le } from "./bytes.js";
import type { ReadResult } from "./result.js";
import { dimensions, malformed, truncated } from "./result.js";

// RIFF(4) size(4 LE) "WEBP"(4), then the first chunk: fourcc(4) size(4 LE) payload at offset 20.
const PAYLOAD = 20;

export const readWebp = (b: Uint8Array): ReadResult => {
	if (b.length < 16) return truncated("need the first chunk's fourcc");
	const fourcc = ascii(b, 12, 4);
	switch (fourcc) {
		case "VP8 ": {
			// frame tag(3), start code 9D 01 2A, width(2 LE) & 0x3fff, height(2 LE) & 0x3fff
			if (b.length < PAYLOAD + 10) return truncated("need the VP8 frame header");
			if (b[PAYLOAD + 3] !== 0x9d || b[PAYLOAD + 4] !== 0x01 || b[PAYLOAD + 5] !== 0x2a) {
				return malformed("VP8 start code is not 9D 01 2A");
			}
			return dimensions(u16le(b, PAYLOAD + 6) & 0x3fff, u16le(b, PAYLOAD + 8) & 0x3fff);
		}
		case "VP8L": {
			// signature 0x2F, then 14 bits width-1 and 14 bits height-1, little-endian bit order
			if (b.length < PAYLOAD + 5) return truncated("need the VP8L header");
			if (b[PAYLOAD] !== 0x2f) return malformed("VP8L signature byte is not 0x2F");
			const b1 = b[PAYLOAD + 1];
			const b2 = b[PAYLOAD + 2];
			const b3 = b[PAYLOAD + 3];
			const b4 = b[PAYLOAD + 4];
			const width = 1 + (((b2 & 0x3f) << 8) | b1);
			const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
			return dimensions(width, height);
		}
		case "VP8X": {
			// flags(1) reserved(3), canvas width-1 (3 LE), canvas height-1 (3 LE)
			if (b.length < PAYLOAD + 10) return truncated("need the VP8X canvas size");
			return dimensions(1 + u24le(b, PAYLOAD + 4), 1 + u24le(b, PAYLOAD + 7));
		}
		default:
			return malformed(`unknown first WebP chunk ${JSON.stringify(fourcc)}`);
	}
};
