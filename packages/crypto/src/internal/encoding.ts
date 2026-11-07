// The output encodings `Hmac` and `Hash` share, over core `effect/encoding`.
// One pair of helpers, so the two cannot drift on what `hex` or `base64url`
// means.

import type { Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";

/**
 * Bytes in one of the kit's output encodings: `bytes` passes through, `hex`
 * is lower case, `base64` padded and `base64url` unpadded.
 *
 * @internal
 */
export const encodeBytes = (
	bytes: Uint8Array,
	encoding: "bytes" | "hex" | "base64" | "base64url",
): Uint8Array | string => {
	switch (encoding) {
		case "bytes":
			return bytes;
		case "hex":
			return Hex.encode(bytes);
		case "base64":
			return Base64.encode(bytes);
		case "base64url":
			return Base64Url.encode(bytes);
	}
};

/**
 * Bytes from one of the kit's string encodings. Hex is accepted in either
 * case.
 *
 * @internal
 */
export const decodeBytes = (
	value: string,
	encoding: "hex" | "base64" | "base64url",
): Result.Result<Uint8Array, unknown> => {
	switch (encoding) {
		case "hex":
			return Hex.decode(value);
		case "base64":
			return Base64.decode(value);
		case "base64url":
			return Base64Url.decode(value);
	}
};
