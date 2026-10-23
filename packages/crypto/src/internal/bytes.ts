import { Redacted } from "effect";

const encoder = new TextEncoder();

/**
 * UTF-8 bytes of a string; bytes pass through unchanged.
 *
 * @internal
 */
export const utf8 = (value: string | Uint8Array): Uint8Array =>
	typeof value === "string" ? encoder.encode(value) : value;

/**
 * The bytes of key or secret material, reading a `Redacted` only here.
 *
 * @internal
 */
export const secretBytes = (value: Uint8Array | string | Redacted.Redacted<string>): Uint8Array =>
	Redacted.isRedacted(value) ? encoder.encode(Redacted.value(value)) : utf8(value);

/**
 * One message from its parts, each a string (as UTF-8) or raw bytes, joined
 * as bytes in order. A single part passes through uncopied.
 *
 * @internal
 */
export const messageBytes = (message: Uint8Array | string | ReadonlyArray<Uint8Array | string>): Uint8Array => {
	if (typeof message === "string" || message instanceof Uint8Array) return utf8(message);
	const parts = message.map(utf8);
	if (parts.length === 1 && parts[0] !== undefined) return parts[0];
	let length = 0;
	for (const part of parts) length += part.byteLength;
	const out = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
};
