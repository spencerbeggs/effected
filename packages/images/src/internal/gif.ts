import { u16le } from "./bytes.js";
import type { ReadResult } from "./result.js";
import { dimensions, truncated } from "./result.js";

/** The logical screen descriptor follows the 6-byte signature: width(2 LE), height(2 LE). */
export const readGif = (b: Uint8Array): ReadResult =>
	b.length < 10
		? truncated(`need 10 bytes for the screen descriptor, have ${b.length}`)
		: dimensions(u16le(b, 6), u16le(b, 8));
