import { Effect } from "effect";
import { Digest } from "effect/crypto";
import type { HmacEncoding, HmacMessage, HmacStringEncoding } from "./Hmac.js";
import { messageBytes } from "./internal/bytes.js";
import { encodeBytes } from "./internal/encoding.js";

/**
 * The digest algorithms {@link Hash.digest} computes: every algorithm core's
 * `Digest` service supports.
 *
 * @remarks
 * MD5 and SHA-1 are broken for collision resistance. Use them only to match an
 * existing protocol or checksum, never for a new integrity or identity key.
 *
 * @public
 */
export type HashAlgorithm = "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/**
 * A message to hash: bytes, a string, or a list of parts.
 *
 * @remarks
 * The same type as {@link HmacMessage}, with the same rules: a string is its
 * UTF-8 bytes (a lone surrogate becomes `EF BF BD`, as `TextEncoder` and
 * `node:crypto` both write it), and a list is its parts' bytes joined in
 * order, so `[prefix, body]` hashes exactly what
 * `createHash(...).update(prefix).update(body)` hashes.
 *
 * @public
 */
export type HashMessage = HmacMessage;

/**
 * How a digest is returned: the same encodings as {@link HmacEncoding}.
 *
 * @remarks
 * - `bytes` — the raw `Uint8Array`.
 * - `hex` — lower-case hexadecimal.
 * - `base64` — RFC 4648 base64, padded.
 * - `base64url` — RFC 4648 base64url, unpadded.
 *
 * @public
 */
export type HashEncoding = HmacEncoding;

/**
 * The string encodings of a digest: every {@link HashEncoding} but `bytes`.
 *
 * @public
 */
export type HashStringEncoding = HmacStringEncoding;

/**
 * What every digest takes: the algorithm and the message.
 *
 * @public
 */
export interface HashInput {
	/** The digest algorithm. */
	readonly algorithm: HashAlgorithm;
	/** The message; see {@link HashMessage}. */
	readonly message: HashMessage;
}

/**
 * The input to {@link Hash.digest} for a raw-bytes digest.
 *
 * @public
 */
export interface HashDigestBytesOptions extends HashInput {
	/** `bytes`, the default. */
	readonly encoding?: "bytes";
}

/**
 * The input to {@link Hash.digest} for an encoded-string digest.
 *
 * @public
 */
export interface HashDigestStringOptions extends HashInput {
	/** The output encoding. */
	readonly encoding: HashStringEncoding;
}

/**
 * The input to {@link Hash.digest}.
 *
 * @public
 */
export type HashDigestOptions = HashDigestBytesOptions | HashDigestStringOptions;

// Own-property lookup only: a caller bypassing the type with "constructor"
// must not reach `Object.prototype`.
const algorithms: Readonly<Record<HashAlgorithm, Digest.Algorithm>> = {
	MD5: Digest.md5,
	"SHA-1": Digest.sha1,
	"SHA-256": Digest.sha256,
	"SHA-384": Digest.sha384,
	"SHA-512": Digest.sha512,
};

// Unspanned: a digest cannot fail, so it is not a fallible boundary.
const digestAny = (options: HashDigestOptions): Effect.Effect<Uint8Array | string, never, Digest.Digest> =>
	Effect.suspend(() => {
		const name = options.algorithm;
		if (!Object.hasOwn(algorithms, name)) {
			return Effect.die(new Error(`Hash.digest: unsupported algorithm ${JSON.stringify(name)}`));
		}
		const algorithm = algorithms[name];
		const data = messageBytes(options.message);
		const encoding = options.encoding ?? "bytes";
		return Digest.Digest.use((digest) =>
			Effect.map(digest.digest(algorithm, data), (bytes) => encodeBytes(bytes, encoding)),
		);
	});

function digest(options: HashDigestBytesOptions): Effect.Effect<Uint8Array, never, Digest.Digest>;
function digest(options: HashDigestStringOptions): Effect.Effect<string, never, Digest.Digest>;
function digest(options: HashDigestOptions): Effect.Effect<Uint8Array | string, never, Digest.Digest> {
	return digestAny(options);
}

/**
 * Message digests over core's `Digest` service, taking the same messages and
 * returning the same encodings as {@link Hmac.sign}.
 *
 * @remarks
 * Requires `Digest.Digest` (`effect/crypto`) in `R`: provide
 * `Digest.layerWebCrypto` (Node, Workers, any runtime with WebCrypto) or a
 * platform family layer such as `NodeCrypto.layerDigest`. What this adds over
 * `Digest` is the input and output shape: string and multi-part messages, so a
 * prefix plus a body is hashed without the caller encoding and joining the
 * bytes, and hex, base64 and base64url output as well as bytes.
 *
 * A digest cannot fail: the error channel is `never`, as core's is. On
 * `Digest.layerWebCrypto` a runtime with no `crypto.subtle` is a defect, so a
 * SHA digest dies there (MD5 runs in pure TypeScript and keeps working). An
 * algorithm name outside {@link HashAlgorithm}, which only a caller bypassing
 * the type can pass, also dies.
 *
 * @example
 * ```ts
 * import { Hash } from "@effected/crypto";
 * import { Effect } from "effect";
 * import { Digest } from "effect/crypto";
 *
 * const key = Hash.digest({ algorithm: "SHA-256", message: ["2934792.", "body"], encoding: "hex" });
 * // Effect<string, never, Digest>
 *
 * const program = key.pipe(Effect.provide(Digest.layerWebCrypto));
 * ```
 *
 * @public
 */
export class Hash {
	private constructor() {}

	/**
	 * Compute the digest of `message`.
	 *
	 * @remarks
	 * Returns raw bytes unless `encoding` names a string form: `hex` (lower
	 * case), `base64` (padded) or `base64url` (unpadded). A list `message` is
	 * hashed as its parts' bytes joined in order, each string as UTF-8, so the
	 * result is byte-identical to `node:crypto`'s
	 * `createHash(...).update(a).update(b)`. Requires `Digest.Digest` in `R`
	 * and never fails.
	 *
	 * On `Digest.layerWebCrypto`, a SHA digest is truly asynchronous: the effect
	 * suspends on a `crypto.subtle` promise, not a scheduled fiber, so a test
	 * that forks it and then adjusts `TestClock` can race or hang. Await it, or
	 * gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly digest: {
		(options: HashDigestBytesOptions): Effect.Effect<Uint8Array, never, Digest.Digest>;
		(options: HashDigestStringOptions): Effect.Effect<string, never, Digest.Digest>;
	} = digest;
}
