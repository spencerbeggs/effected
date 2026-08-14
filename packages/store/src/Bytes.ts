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
 * `Uint8ArrayFromHex` — and **nothing for UTF-8**. So the advice this package
 * gives, "cache values are bytes, so encode them deliberately through a
 * schema," could not be followed to the end: `Schema.fromJsonString(schema)`
 * reaches `string` and stops there. Every consumer hand-wired a `TextEncoder`
 * at exactly the seam the advice exists to close, or paid base64's 33% size
 * premium to stay inside Schema.
 *
 * This closes it. **Decoding** takes UTF-8 text to its bytes and always
 * succeeds; **encoding** takes bytes back to text and *fails* on malformed
 * UTF-8 rather than substituting replacement characters, so a corrupt value
 * stays distinguishable from a valid one that happens to contain `U+FFFD`.
 *
 * It lives here, next to the byte-valued API that needs it, rather than in a
 * schema package. If core ever ships an equivalent, prefer that one.
 *
 * @example
 * ```ts
 * const Payload = Schema.fromJsonString(Settings).pipe(Schema.encodeTo(Uint8ArrayFromUtf8));
 * ```
 *
 * @public
 */
export const Uint8ArrayFromUtf8: Schema.Codec<Uint8Array, string> = Schema.String.pipe(
	Schema.decodeTo(
		Schema.Uint8Array,
		SchemaTransformation.transformOrFail<Uint8Array, string>({
			decode: (text: string) => Effect.succeed(utf8ToBytes(text)),
			encode: (bytes: Uint8Array) =>
				Option.match(bytesToUtf8(bytes), {
					onNone: () => Effect.fail(new SchemaIssue.InvalidValue({ message: "not valid UTF-8" }, bytes)),
					onSome: (text) => Effect.succeed(text),
				}),
		}),
	),
);
