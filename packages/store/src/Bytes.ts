import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";

const encoder = new TextEncoder();
// `fatal` is the whole point: the default decoder substitutes U+FFFD for
// malformed bytes, which turns a corrupt value into a plausible one. A cache
// read has to be able to tell those apart.
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encode UTF-8 text to bytes. Total.
 *
 * @internal
 */
export const utf8ToBytes = (text: string): Uint8Array => encoder.encode(text);

/**
 * Decode bytes as UTF-8 text, or `None` when they are not valid UTF-8.
 *
 * @internal
 */
export const bytesToUtf8 = (bytes: Uint8Array): Option.Option<string> => {
	try {
		return Option.some(decoder.decode(bytes));
	} catch {
		return Option.none();
	}
};

/**
 * A `Uint8Array` codec over UTF-8 text: the last inch between a string-shaped
 * schema and a byte-valued store.
 *
 * @remarks
 * Core's Schema ships `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and
 * `Uint8ArrayFromHex` — and **nothing for UTF-8**. `Schema.fromJsonString(schema)`
 * reaches `string` and stops there, so this codec supplies the last step from
 * text to the bytes a cache value is, without a hand-wired `TextEncoder` or
 * base64's 33% size premium.
 *
 * **Decoding** takes UTF-8 text to its bytes and always
 * succeeds; **encoding** takes bytes back to text and *fails* on malformed
 * UTF-8 rather than substituting replacement characters, so a corrupt value
 * stays distinguishable from a valid one that happens to contain `U+FFFD`.
 *
 * @example
 * ```ts
 * import { Uint8ArrayFromUtf8 } from "@effected/store";
 * import { Schema } from "effect";
 *
 * const bytes = Schema.decodeSync(Uint8ArrayFromUtf8)("héllo"); // => Uint8Array of the UTF-8 bytes
 * const text = Schema.encodeSync(Uint8ArrayFromUtf8)(bytes); // => "héllo"
 * ```
 *
 * @public
 */
export const Uint8ArrayFromUtf8: Schema.Codec<Uint8Array, string> = Schema.String.pipe(
	Schema.decodeTo(
		Schema.Uint8Array,
		SchemaTransformation.transformEffect<Uint8Array, string>({
			decode: (text: string) => Effect.succeed(utf8ToBytes(text)),
			encode: (bytes: Uint8Array) =>
				Option.match(bytesToUtf8(bytes), {
					onNone: () => Effect.fail(new SchemaIssue.InvalidValue({ message: "not valid UTF-8" }, bytes)),
					onSome: (text) => Effect.succeed(text),
				}),
		}),
	),
);
