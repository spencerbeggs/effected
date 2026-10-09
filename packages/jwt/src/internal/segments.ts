// The compact JWS serialization (RFC 7515 §7.1): three base64url segments,
// header JSON, payload JSON and signature bytes, joined by ".".
//
// Core `Base64Url` does the codec work. It rejects the standard-base64 `+`
// and `/`, but tolerates `=` padding and strips embedded CR/LF; the compact
// serialization forbids both, so a segment is first held to the bare
// url-safe alphabet. The decoder also ignores set trailing bits (`AQ`, `AR`,
// `AS`, `AT` all decode to one byte), so a decoded segment must re-encode to
// itself. Together these keep one signature to exactly one token spelling.

import { Result } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { JwtError } from "../JwtError.js";

/** A parsed compact JWS, signature unchecked. @internal */
export interface CompactParts {
	readonly header: unknown;
	readonly payload: unknown;
	/** UTF-8 bytes of `header + "." + payload`, as signed. */
	readonly signingInput: Uint8Array;
	readonly signature: Uint8Array;
}

const urlSafe = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const bytesOf = (name: string, segment: string): Result.Result<Uint8Array, JwtError> => {
	if (!urlSafe.test(segment)) {
		return Result.fail(JwtError.of("malformed", `the ${name} segment is not unpadded base64url`));
	}
	return Result.flatMap(
		Result.mapError(Base64Url.decode(segment), (cause) =>
			JwtError.of("malformed", `the ${name} segment is not base64url`, { cause }),
		),
		(bytes) =>
			Base64Url.encode(bytes) === segment
				? Result.succeed(bytes)
				: Result.fail(JwtError.of("malformed", `the ${name} segment is not canonical base64url`)),
	);
};

const jsonOf = (name: string, segment: string): Result.Result<unknown, JwtError> =>
	Result.flatMap(bytesOf(name, segment), (bytes) => {
		try {
			return Result.succeed(JSON.parse(decoder.decode(bytes)) as unknown);
		} catch (cause) {
			return Result.fail(JwtError.of("malformed", `the ${name} segment is not base64url JSON`, { cause }));
		}
	});

/**
 * Split a compact JWS into its decoded parts, without checking the signature.
 *
 * @internal
 */
export const splitCompact = (token: string): Result.Result<CompactParts, JwtError> => {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return Result.fail(JwtError.of("malformed", `expected three segments, got ${parts.length}`));
	}
	const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];
	return Result.flatMap(jsonOf("header", headerSegment), (header) =>
		Result.flatMap(jsonOf("payload", payloadSegment), (payload) =>
			Result.map(bytesOf("signature", signatureSegment), (signature) => ({
				header,
				payload,
				signingInput: encoder.encode(`${headerSegment}.${payloadSegment}`),
				signature,
			})),
		),
	);
};

/**
 * Encode a header and payload into the signing input `header.payload`.
 *
 * @internal
 */
export const joinCompact = (header: unknown, payload: unknown): { readonly signingInput: string } => ({
	signingInput: `${Base64Url.encode(JSON.stringify(header))}.${Base64Url.encode(JSON.stringify(payload))}`,
});

/**
 * Complete a compact JWS by appending the base64url signature.
 *
 * @internal
 */
export const appendSignature = (signingInput: string, signature: Uint8Array): string =>
	`${signingInput}.${Base64Url.encode(signature)}`;
