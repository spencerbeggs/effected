import { Effect, Result, Schema } from "effect";
import { ImageFormat, MIME_TYPES } from "./ImageFormat.js";
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
	/** The IANA media type for `format`. */
	mimeType: Schema.String,
	/** Stored pixel width. */
	width: Dimension,
	/** Stored pixel height. */
	height: Dimension,
}) {
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
