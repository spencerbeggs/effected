import { Schema } from "effect";

/**
 * The image formats `@effected/images` reads.
 *
 * @public
 */
export const ImageFormat = Schema.Literals(["png", "jpeg", "gif", "webp", "avif"]);

/**
 * One of the image formats `@effected/images` reads.
 *
 * @public
 */
export type ImageFormat = typeof ImageFormat.Type;

/**
 * The IANA media type for each format.
 *
 * @internal
 */
export const MIME_TYPES: Readonly<Record<ImageFormat, string>> = {
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
};
