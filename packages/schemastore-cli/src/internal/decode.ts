// The decode helpers the loader and the runner share, so a forged config and
// an unreadable catalog slice report their Schema issues in one spelling.

import type { Result } from "effect";
import { Schema } from "effect";

/**
 * JSON text to an untyped value, failing typed (never throwing) on text that
 * does not parse. Bound once: every `decodeUnknownResult` call derives a
 * decoder. Callers keep the parse and the shape decode as two steps where
 * they must tell "not JSON" from "the wrong shape" — a one-step
 * `fromJsonString(S)` separates the two only by issue tag.
 *
 * @internal
 */
export const decodeJson: (text: string) => Result.Result<unknown, Schema.SchemaError> = Schema.decodeUnknownResult(
	Schema.fromJsonString(Schema.Unknown),
);

/**
 * Flatten a Schema decode failure to one line: each issue as
 * `<message> at <path>`, issues separated by `"; "`. Run the decode with
 * `errors: "all"` so every issue is reported, not only the first.
 *
 * @internal
 */
export const flattenSchemaError = (error: Schema.SchemaError): string =>
	error.message.replace(/\n\s+at /g, " at ").replace(/\n/g, "; ");
