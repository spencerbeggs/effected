import { Schema } from "effect";
import { ImageFormat } from "./ImageFormat.js";

/**
 * A generator produced bytes the cache will not store.
 *
 * @remarks
 * `empty`: zero bytes. `unparseable`: not a readable image (`cause` is the `ImageParseError`).
 * `rejected-format`: a readable image whose format is outside the caller's `accept` list.
 *
 * @public
 */
export class ImageGenerateError extends Schema.TaggedError<ImageGenerateError>()("ImageGenerateError", {
	/** Why the output was refused. */
	reason: Schema.Literals(["empty", "unparseable", "rejected-format"]),
	/** The output's format, when it was readable. */
	format: Schema.optionalKey(ImageFormat),
	/** The formats the caller accepts, for `rejected-format`. */
	accept: Schema.optionalKey(Schema.Array(ImageFormat)),
	/** The parse failure, for `unparseable`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return this.reason === "empty"
			? "Image generator returned no bytes"
			: this.reason === "unparseable"
				? "Image generator returned bytes that are not a readable image"
				: `Image generator returned a ${this.format ?? "?"} image; accepted: ${(this.accept ?? []).join(", ")}`;
	}
}
