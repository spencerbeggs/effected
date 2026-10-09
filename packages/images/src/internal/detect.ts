import type { ImageFormat } from "../ImageFormat.js";
import { isAvifBrand } from "./avif.js";
import { ascii, matches } from "./bytes.js";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** The format whose signature `bytes` starts with, or undefined. A partial signature is no match. */
export const detectFormat = (b: Uint8Array): ImageFormat | undefined => {
	if (matches(b, 0, PNG)) return "png";
	if (matches(b, 0, JPEG)) return "jpeg";
	const gif = b.length >= 6 ? ascii(b, 0, 6) : "";
	if (gif === "GIF87a" || gif === "GIF89a") return "gif";
	if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
	if (isAvifBrand(b)) return "avif";
	return undefined;
};
