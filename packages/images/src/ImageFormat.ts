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
 * The conventional file extension for each format — the one table every extension in the package is read from.
 * `ImageFacts#extension` declares the union these values must fall in.
 *
 * @internal
 */
export const EXTENSIONS = {
	png: "png",
	jpeg: "jpg",
	gif: "gif",
	webp: "webp",
	avif: "avif",
} as const satisfies Record<ImageFormat, string>;

/**
 * The IANA media type for each format. `ImageFacts.mimeType`'s schema is built from these values.
 *
 * @internal
 */
export const MIME_TYPES = {
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
} as const satisfies Record<ImageFormat, string>;

/**
 * The schema of `ImageFacts.mimeType`: the literals of {@link MIME_TYPES}, so the two cannot drift.
 *
 * @internal
 */
export const ImageMimeTypeSchema = Schema.Literals([
	MIME_TYPES.png,
	MIME_TYPES.jpeg,
	MIME_TYPES.gif,
	MIME_TYPES.webp,
	MIME_TYPES.avif,
]);
