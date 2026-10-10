// Byte helpers shared by the DER builder and the capped body reader.

/**
 * The parts, one after another, in a fresh array.
 *
 * @internal
 */
export const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
};

/**
 * A UTF-8 decoder that throws on malformed input instead of substituting
 * U+FFFD. Stateless between `decode` calls without `stream`, so one is shared.
 *
 * @internal
 */
export const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
