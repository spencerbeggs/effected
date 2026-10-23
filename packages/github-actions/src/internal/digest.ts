// The sanctioned `node:crypto` digests, spelled once.
//
// This module is the package's only `node:crypto` import, for two kinds of call
// site core `Crypto.digest` cannot serve (the recorded verdicts of #767): the
// streamed `digestFile` a multi-gigabyte toolchain archive needs, since nothing
// in core or WebCrypto hashes a stream, and the synchronous digests behind
// `CacheKey`, which moving onto core `Crypto` would make effectful with
// `Crypto` in `R`. HMAC is not here: the S3 blob store signs through
// `@effected/crypto`'s `SigV4`. Keeping every `createHash` behind this module
// makes the licence auditable in one place.

import { createHash } from "node:crypto";
import type { FileSystem, PlatformError } from "effect";
import { Effect, Stream } from "effect";
import * as Hex from "effect/encoding/Hex";

/** The raw SHA-256 of a string or byte array held in memory. @internal */
export const sha256 = (value: string | Uint8Array): Uint8Array =>
	new Uint8Array(createHash("sha256").update(value).digest());

/** The hex SHA-256 of a string or byte array held in memory. @internal */
export const sha256Hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

/**
 * The raw digest of a file's bytes under `algorithm`, streamed rather than
 * buffered. Raw, because a caller that folds several file digests into one
 * (`CacheKey.hashFiles`, byte-compatible with the runner's `hashFiles()`)
 * hashes the digest BYTES, not their hex spelling.
 *
 * `algorithm` must be one `node:crypto` supports — every caller's grammar
 * admits only `sha1`/`sha256`/`sha384`/`sha512`, so `createHash` cannot throw.
 *
 * @internal
 */
export const digestFile = (
	fs: FileSystem.FileSystem,
	file: string,
	algorithm: string,
): Effect.Effect<Uint8Array, PlatformError.PlatformError> =>
	Effect.suspend(() => {
		const accumulator = createHash(algorithm);
		return Stream.runForEach(fs.stream(file), (chunk) =>
			Effect.sync(() => {
				accumulator.update(chunk);
			}),
		).pipe(Effect.map(() => new Uint8Array(accumulator.digest())));
	});

/** {@link digestFile}, as hex. @internal */
export const digestFileHex = (
	fs: FileSystem.FileSystem,
	file: string,
	algorithm: string,
): Effect.Effect<string, PlatformError.PlatformError> => Effect.map(digestFile(fs, file, algorithm), Hex.encode);
