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
