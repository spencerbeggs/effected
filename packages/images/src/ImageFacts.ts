import { Effect, Result, Schema } from "effect";
import { EXTENSIONS, ImageFormat, ImageMimeTypeSchema, MIME_TYPES } from "./ImageFormat.js";
import { ImageParseError } from "./ImageParseError.js";
import { readAvif } from "./internal/avif.js";
import { detectFormat } from "./internal/detect.js";
import { readGif } from "./internal/gif.js";
import { readJpeg } from "./internal/jpeg.js";
import { readPng } from "./internal/png.js";
import type { ReadResult } from "./internal/result.js";
import { readWebp } from "./internal/webp.js";

const READERS: Readonly<Record<ImageFormat, (bytes: Uint8Array) => ReadResult>> = {
	png: readPng,
	jpeg: readJpeg,
	gif: readGif,
	webp: readWebp,
	avif: readAvif,
};

const Dimension = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * One of the five media types `ImageFacts.mimeType` holds, one per `ImageFormat`.
 *
 * @public
 */
export type ImageMimeType = ImageFacts["mimeType"];

/**
 * The conventional file extension for an image format, without the dot: `jpeg` is written `jpg`, the others keep
 * their format name. The type of `ImageFacts#extension`.
 *
 * @public
 */
export type ImageExtension = ImageFacts["extension"];

/**
 * What an image's header says about it: format, MIME type and stored pixel dimensions.
 *
 * @remarks
 * Dimensions are as stored in the file; EXIF orientation is not applied.
 *
 * @public
 */
export class ImageFacts extends Schema.Class<ImageFacts>("ImageFacts")({
	/** The detected format. */
	format: ImageFormat,
	/** The IANA media type for `format`: one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`. */
	mimeType: ImageMimeTypeSchema,
	/** Stored pixel width. */
	width: Dimension,
	/** Stored pixel height. */
	height: Dimension,
}) {
	/**
	 * The conventional file extension for `format`, without the dot: `jpg` for `jpeg`, the format name otherwise.
	 *
	 * @remarks
	 * A getter, not a field: it is derived from `format` on read, so it is absent from the encoded form and a decoded
	 * value has it again. Name a written file with it instead of keeping a private format-to-extension table.
	 */
	// The union is written out rather than named: a named alias here would be a second root symbol that ./cache's
	// self-reference reaches, forgotten from cache.d.ts. ImageExtension is derived from this getter instead.
	get extension(): "png" | "jpg" | "gif" | "webp" | "avif" {
		return EXTENSIONS[this.format];
	}

	/**
	 * Read facts from an image's bytes — the synchronous primitive.
	 *
	 * @remarks
	 * Reads only the header. Never throws: unknown bytes are `unrecognized`, a
	 * header that ends early is `truncated`, an impossible header is `malformed`.
	 */
	static fromBytesResult(bytes: Uint8Array): Result.Result<ImageFacts, ImageParseError> {
		const format = detectFormat(bytes);
		if (format === undefined) return Result.fail(new ImageParseError({ reason: "unrecognized" }));
		const read = READERS[format](bytes);
		if (Result.isFailure(read)) {
			return Result.fail(new ImageParseError({ reason: read.failure.reason, format, detail: read.failure.detail }));
		}
		return Result.succeed(
			ImageFacts.make({ format, mimeType: MIME_TYPES[format], width: read.success.width, height: read.success.height }),
		);
	}

	/**
	 * Read facts from an image's bytes — {@link ImageFacts.fromBytesResult} with a span.
	 */
	static readonly fromBytes: (bytes: Uint8Array) => Effect.Effect<ImageFacts, ImageParseError> = Effect.fn(
		"ImageFacts.fromBytes",
	)((bytes: Uint8Array) => Effect.fromResult(ImageFacts.fromBytesResult(bytes)));
}
