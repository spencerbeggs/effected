import { Schema } from "effect";
import { ImageFormat } from "./ImageFormat.js";

/**
 * Bytes that could not be read as an image header.
 *
 * @remarks
 * `unrecognized`: no known signature. `truncated`: a signature matched but the
 * bytes end before the dimension fields. `malformed`: a header field is
 * impossible (a zero or out-of-range dimension, an inconsistent length, or a
 * walk that exhausted its step budget).
 *
 * @public
 */
export class ImageParseError extends Schema.TaggedError<ImageParseError>()("ImageParseError", {
	/** Why the header could not be read. */
	reason: Schema.Literals(["unrecognized", "truncated", "malformed"]),
	/** The format whose signature matched, when one did. */
	format: Schema.optionalKey(ImageFormat),
	/** What exactly was wrong. */
	detail: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const lead =
			this.reason === "unrecognized"
				? "Unrecognized image signature"
				: `${this.reason === "truncated" ? "Truncated" : "Malformed"} ${this.format ?? "image"} header`;
		return this.detail === undefined ? lead : `${lead}: ${this.detail}`;
	}
}
