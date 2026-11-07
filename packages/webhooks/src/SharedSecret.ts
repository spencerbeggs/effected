import { ConstantTime, Hmac } from "@effected/crypto";
import { Effect, Result, Schema } from "effect";
import type { Mac } from "effect/crypto";
import { annotateOutcome, readHeader, readRawHeader, reject } from "./internal/verify.js";
import type { WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "SharedSecret";

/** The versioned domain tag every attestation prefix starts with. Bump the version to change the format. */
const ATTESTATION_TAG = "effected-attestation.v1";

/** The separator between the tag, the part count and each context part. No part may contain it. */
const SEPARATOR = ".";

/**
 * Where a shared secret is delivered.
 *
 * @public
 */
export interface SharedSecretOptions {
	/** The header carrying the secret itself, lower case. */
	readonly header: string;
}

/**
 * What an attestation is bound to.
 *
 * @public
 */
export interface SharedSecretAttestOptions {
	/**
	 * The ordered parts the attestation is bound to, such as a vendor and an environment. Each must be non-empty and
	 * must not contain `.`; order and count are significant.
	 */
	readonly context: ReadonlyArray<string>;
}

/**
 * Where an archived delivery's attestation lives, what it is bound to, and optionally where the live secret is.
 *
 * @public
 */
export interface SharedSecretAttestedOptions {
	/**
	 * The header carrying the secret itself, lower case. When given and present on the delivery, the live secret is
	 * checked as {@link SharedSecret.verify} checks it, and that check decides; when omitted, the live header is never
	 * read.
	 */
	readonly header?: string;
	/** The header carrying the attestation minted by {@link SharedSecret.attest}, lower case. */
	readonly attestation: string;
	/** The same ordered parts the attestation was minted with. */
	readonly context: ReadonlyArray<string>;
}

/**
 * An attestation context that cannot be encoded unambiguously: a part is empty, or contains the `.` separator.
 *
 * @remarks
 * The context usually comes from routing (a vendor, an environment, a path segment), so a bad one is reported as a
 * typed failure rather than a defect: a caller that builds it from a request can answer 404 rather than crash. It
 * is checked before any header is read or any MAC computed. `context` is the whole list as given; it never carries
 * the secret, an attestation or the body.
 *
 * @public
 */
export class AttestationContextError extends Schema.TaggedError<AttestationContextError>()("AttestationContextError", {
	/** The context as given. */
	context: Schema.Array(Schema.String),
	/** The index of the first offending part. */
	index: Schema.Number,
	/** Why that part cannot be encoded: `empty`, or `contains_separator` for a part containing `.`. */
	reason: Schema.Literals(["empty", "contains_separator"]),
}) {
	override get message(): string {
		return this.reason === "empty"
			? `the attestation context part at index ${this.index} is empty`
			: `the attestation context part at index ${this.index} contains "${SEPARATOR}"`;
	}
}

/**
 * The domain-separated prefix for `context`: the tag, the part count, then each part, every one followed by `.`.
 * The count makes the prefix self-delimiting, so no context and body pair signs the same bytes as another pair.
 */
const attestationPrefix = (context: ReadonlyArray<string>): Result.Result<string, AttestationContextError> => {
	for (const [index, part] of context.entries()) {
		if (part === "" || part.includes(SEPARATOR)) {
			return Result.fail(
				new AttestationContextError({
					context: [...context],
					index,
					reason: part === "" ? "empty" : "contains_separator",
				}),
			);
		}
	}
	return Result.succeed(
		[ATTESTATION_TAG, String(context.length), ...context].map((part) => `${part}${SEPARATOR}`).join(""),
	);
};

/** The live-secret check both `verify` and `verifyAttested` run; the caller's span covers it. */
const checkSecret = (
	request: WebhookRequest,
	received: string,
): Effect.Effect<void, WebhookVerificationError, Mac.Mac> =>
	Effect.gen(function* () {
		// A CryptoError means the Mac layer refused its own blinding key: a broken runtime, not a bad delivery.
		const equal = yield* ConstantTime.secretsEqual(request.secret, received).pipe(Effect.orDie);
		if (!equal) return yield* reject(PRESET, "bad_signature");
	});

const verify = Effect.fn("SharedSecret.verify")(function* (request: WebhookRequest, options: SharedSecretOptions) {
	// Raw, never trimmed: whitespace around a secret is a different secret.
	const received = readRawHeader(request, options.header);
	if (received === undefined) return yield* reject(PRESET, "missing_signature");
	return yield* checkSecret(request, received);
}, annotateOutcome(PRESET));

const attest = Effect.fn("SharedSecret.attest")(function* (
	request: WebhookRequest,
	options: SharedSecretAttestOptions,
) {
	const prefix = yield* Effect.fromResult(attestationPrefix(options.context));
	// A CryptoError is a key core's Mac refuses (an empty secret): a broken route, never bad input.
	return yield* Hmac.sign({
		algorithm: "SHA-256",
		key: request.secret,
		message: [prefix, request.body],
		encoding: "hex",
	}).pipe(Effect.orDie);
});

const verifyAttested = Effect.fn("SharedSecret.verifyAttested")(function* (
	request: WebhookRequest,
	options: SharedSecretAttestedOptions,
) {
	const prefix = yield* Effect.fromResult(attestationPrefix(options.context));
	// Step one: the live secret, raw and untrimmed as `verify` reads it. Present, it decides.
	const live = options.header === undefined ? undefined : readRawHeader(request, options.header);
	if (live !== undefined) {
		yield* Effect.annotateCurrentSpan("webhook.verified_by", "secret");
		return yield* checkSecret(request, live);
	}
	// Step two: the archived attestation, a MAC rather than a secret, so trimmed as the signature presets trim.
	const proof = readHeader(request, options.attestation);
	if (proof === undefined) return yield* reject(PRESET, "missing_signature");
	yield* Effect.annotateCurrentSpan("webhook.verified_by", "attestation");
	// Decoded and compared as bytes by `Mac.verify`, in constant time; hex in either case, and one that does not
	// decode is false. A CryptoError dies, as in `attest`.
	const verified = yield* Hmac.verify({
		algorithm: "SHA-256",
		key: request.secret,
		message: [prefix, request.body],
		signature: proof,
		encoding: "hex",
	}).pipe(Effect.orDie);
	if (!verified) return yield* reject(PRESET, "bad_signature", "the attestation does not match");
}, annotateOutcome(PRESET));

/**
 * A shared secret sent verbatim in a caller-named header, such as Cloudflare's `cf-webhook-auth`, plus the
 * attestation pair that lets an archived delivery be re-verified without archiving the secret.
 *
 * @remarks
 * Compared with `ConstantTime.secretsEqual`, which blinds both sides with an HMAC under a fresh `Mac` key first,
 * so neither the secret's length nor a matching prefix leaks. The header value is compared exactly as received:
 * unlike the signature presets, it is never trimmed, because trimming would loosen a secret comparison. "As
 * received" means as the header lookup returns it: a lookup over a fetch `Request` sees values the `Headers` class
 * has already trimmed of leading and trailing whitespace, so padding never reaches the comparison there.
 *
 * A shared-secret vendor's "signature" is the route secret itself, so an archive must never keep it, and an archived
 * delivery without it cannot be re-verified. {@link SharedSecret.attest} mints a proof to archive in its place, and
 * {@link SharedSecret.verifyAttested} checks it on replay.
 *
 * @public
 */
export class SharedSecret {
	private constructor() {}

	/**
	 * The versioned domain tag every attestation's signed bytes start with: `effected-attestation.v1`.
	 *
	 * @remarks
	 * An attestation is the lower-case hex HMAC-SHA256, under the route secret's UTF-8 bytes, of this prefix followed
	 * by the raw body:
	 *
	 * `effected-attestation.v1.<count>.<part>.<part>.`
	 *
	 * where `<count>` is the number of context parts in decimal and each part is followed by `.`. For the context
	 * `["coolify", "production"]` the prefix is `effected-attestation.v1.2.coolify.production.`, and for an empty
	 * context it is `effected-attestation.v1.0.`. The tag keeps an attestation from doubling as any vendor's HMAC of
	 * the body under a reused secret; the context binds it to its route; the count makes the prefix self-delimiting,
	 * so a part cannot move across the boundary into the body.
	 *
	 * @public
	 */
	static readonly ATTESTATION_TAG: "effected-attestation.v1" = ATTESTATION_TAG;

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header or with an empty value; `bad_signature` when the raw value is not the
	 * secret, surrounding whitespace included.
	 *
	 * Requires `Mac.Mac` (`effect/crypto`) in `R`, as the HMAC presets do: `Mac.layerWebCrypto` with
	 * `SecureRandom.layerWebCrypto`, or a platform family layer such as `NodeCrypto.layerMac`. A `CryptoError` from the
	 * `Mac` layer is a defect, as is a runtime with no `crypto.subtle` on the WebCrypto layer.
	 *
	 * On `Mac.layerWebCrypto` this is truly asynchronous: a test that forks it and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options: SharedSecretOptions,
	) => Effect.Effect<void, WebhookVerificationError, Mac.Mac> = verify;

	/**
	 * Mint the attestation of a delivery on its route, to archive in place of the secret.
	 *
	 * @remarks
	 * The lower-case hex HMAC-SHA256 under `request.secret` of the domain-separated prefix for `context` followed by
	 * `request.body`; the format is under {@link SharedSecret.ATTESTATION_TAG}. Mint it only after the live secret
	 * verified, and archive it as a header the vendor never sends, stripping that header from what arrives on the
	 * wire, so an attestation is only ever read back from the archive. Forging one needs the secret, so accepting it
	 * admits nothing the live secret would not.
	 *
	 * Fails with {@link AttestationContextError} when a context part is empty or contains `.`. An empty secret is
	 * refused by core `Mac` as `InvalidKey`, which is a defect, as is any other `CryptoError`. Requires `Mac.Mac` in
	 * `R`, and is truly asynchronous on `Mac.layerWebCrypto`, as {@link SharedSecret.verify} is.
	 *
	 * @public
	 */
	static readonly attest: (
		request: WebhookRequest,
		options: SharedSecretAttestOptions,
	) => Effect.Effect<string, AttestationContextError, Mac.Mac> = attest;

	/**
	 * Verify a delivery by its live secret or, failing that, by the attestation {@link SharedSecret.attest} minted.
	 *
	 * @remarks
	 * Two steps, after the context is validated:
	 *
	 * 1. When `header` is given and the delivery carries it with a non-empty value, the live secret is compared raw, as
	 *    {@link SharedSecret.verify} compares it, and that answer is final: a wrong secret is `bad_signature` even
	 *    beside a valid attestation, and a whitespace-only value is a wrong secret, never a reason to consult the
	 *    attestation.
	 * 2. Otherwise the `attestation` header is read (trimmed; empty or whitespace is absent) and checked with
	 *    `@effected/crypto`'s `Hmac.verify`, which decodes the hex and compares bytes with `Mac.verify` in constant
	 *    time, so either case verifies and one that does not decode is `bad_signature`.
	 *
	 * Neither present is `missing_signature`. The same delivery therefore verifies live (secret, no attestation yet)
	 * and on replay (attestation, secret never archived). An invalid context fails with
	 * {@link AttestationContextError} before any header is read. Omit `header` to accept the attestation alone.
	 *
	 * Requires `Mac.Mac` in `R`; a `CryptoError` is a defect. The span records which step decided, never a value.
	 *
	 * @public
	 */
	static readonly verifyAttested: (
		request: WebhookRequest,
		options: SharedSecretAttestedOptions,
	) => Effect.Effect<void, WebhookVerificationError | AttestationContextError, Mac.Mac> = verifyAttested;
}
