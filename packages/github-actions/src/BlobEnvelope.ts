import { Result, Schema } from "effect";

/**
 * Raised when bytes cannot be read as an envelope.
 *
 * @public
 */
export class BlobEnvelopeError extends Schema.TaggedErrorClass<BlobEnvelopeError>()("BlobEnvelopeError", {
	/**
	 * `notAnEnvelope` — the magic prefix is absent, so these are raw bytes
	 * written before this format existed (or by something else entirely).
	 * `unsupportedVersion` — an envelope from a newer revision.
	 * `truncated` — the frame ends mid-header or mid-metadata.
	 * `metadataDecodeFailed` — the metadata is well-framed but does not satisfy
	 * the caller's schema. `metadataEncodeFailed` — the value being stored does
	 * not satisfy it.
	 */
	reason: Schema.Literals([
		"notAnEnvelope",
		"unsupportedVersion",
		"truncated",
		"metadataDecodeFailed",
		"metadataEncodeFailed",
	]),
	/** The envelope version found, when one was readable. */
	version: Schema.optionalKey(Schema.Number),
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "notAnEnvelope":
				return "Bytes are not an @effected/github-actions blob envelope";
			case "unsupportedVersion":
				return `Blob envelope version ${this.version} is not supported`;
			case "truncated":
				return "Blob envelope is truncated";
			case "metadataDecodeFailed":
				return "Blob envelope metadata did not satisfy the schema";
			default:
				return "Blob metadata could not be encoded";
		}
	}
}

/** Identifies the frame family. Four bytes: `E F B S`. */
const MAGIC = Uint8Array.from([0x45, 0x46, 0x42, 0x53]);

/** The only version this build writes. */
const VERSION = 1;

/** magic + version + metadata length. */
const HEADER_BYTES = MAGIC.length + 1 + 4;

/**
 * The schema-versioned frame that gives a stored blob a **metadata channel**.
 *
 * @remarks
 * Layout:
 *
 * ```text
 * [4B magic "EFBS"][1B version][4B metadata length, big-endian][metadata JSON][body]
 * ```
 *
 * Three properties earn the format, and each replaces something a consumer was
 * hand-rolling:
 *
 * - **The magic prefix makes a legacy blob legible.** Raw, unframed bytes
 *   decode as `notAnEnvelope` rather than as garbage metadata, so a store
 *   holding pre-envelope entries produces a clean miss instead of a corrupt
 *   read.
 * - **The version lives in the blob, not in the key.** A consumer previously
 *   namespaced keys (`v2/...`) to represent a format change, because there was
 *   no in-band version. Here a revision is detected on read and reported
 *   typed, so **keys stay stable** and old entries age out naturally.
 * - **The metadata is the caller's own schema.** This module owns *framing*;
 *   the caller owns *meaning*. Fields like a cache tag or a duration stop
 *   being bytes at fixed offsets in a consumer's private codec.
 *
 * **Pure**: `Result`-returning, no IO, no service — the framing is testable
 * from a byte array, which is the point.
 *
 * @public
 */
export class BlobEnvelope {
	private constructor() {}

	/** The version this build writes. */
	static readonly version: number = VERSION;

	/** Frame metadata and a body into a single blob. */
	static encodeResult<A, I>(
		metadata: A,
		body: Uint8Array,
		schema: Schema.Codec<A, I>,
	): Result.Result<Uint8Array, BlobEnvelopeError> {
		const encoded = Schema.encodeUnknownResult(schema)(metadata);
		if (Result.isFailure(encoded)) {
			return Result.fail(new BlobEnvelopeError({ reason: "metadataEncodeFailed", cause: encoded.failure }));
		}
		const metaBytes = new TextEncoder().encode(JSON.stringify(encoded.success));
		const out = new Uint8Array(HEADER_BYTES + metaBytes.length + body.length);
		out.set(MAGIC, 0);
		out[MAGIC.length] = VERSION;
		new DataView(out.buffer).setUint32(MAGIC.length + 1, metaBytes.length, false);
		out.set(metaBytes, HEADER_BYTES);
		out.set(body, HEADER_BYTES + metaBytes.length);
		return Result.succeed(out);
	}

	/** Read a framed blob back into its metadata and body. */
	static decodeResult<A, I>(
		bytes: Uint8Array,
		schema: Schema.Codec<A, I>,
	): Result.Result<{ readonly metadata: A; readonly body: Uint8Array }, BlobEnvelopeError> {
		if (bytes.length < MAGIC.length || !MAGIC.every((byte, index) => bytes[index] === byte)) {
			return Result.fail(new BlobEnvelopeError({ reason: "notAnEnvelope" }));
		}
		if (bytes.length < HEADER_BYTES) {
			return Result.fail(new BlobEnvelopeError({ reason: "truncated" }));
		}
		const version = bytes[MAGIC.length] ?? 0;
		if (version !== VERSION) {
			return Result.fail(new BlobEnvelopeError({ reason: "unsupportedVersion", version }));
		}
		const metaLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length + 1, false);
		if (bytes.length < HEADER_BYTES + metaLength) {
			return Result.fail(new BlobEnvelopeError({ reason: "truncated" }));
		}
		const metaText = new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metaLength));
		let parsed: unknown;
		try {
			parsed = JSON.parse(metaText);
		} catch (cause) {
			return Result.fail(new BlobEnvelopeError({ reason: "metadataDecodeFailed", cause }));
		}
		const decoded = Schema.decodeUnknownResult(schema)(parsed);
		if (Result.isFailure(decoded)) {
			return Result.fail(new BlobEnvelopeError({ reason: "metadataDecodeFailed", cause: decoded.failure }));
		}
		return Result.succeed({
			metadata: decoded.success,
			// `slice`, not `subarray`: the body must not alias the frame's buffer,
			// or a caller mutating it would corrupt the envelope it came from.
			body: bytes.slice(HEADER_BYTES + metaLength),
		});
	}
}
