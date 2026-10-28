// The `JsoncFingerprint` facade: canonical JSON serialization (RFC 8785, JSON
// Canonicalization Scheme) and SHA-256 content fingerprints over it.
//
// The pure core is the JCS emitter — compact output, object keys sorted by
// UTF-16 code units, ES number serialization — with the package's usual
// `Result` primitive / spanned `Effect` twin arrangement. Hashing is the one
// effectful edge: it requires core's `Crypto.Crypto` service in `R` and owns
// no backend, so consumers provide `@effect/platform-node`'s
// `NodeCrypto.layer` (or any `Crypto` layer) at the application edge.
//
// This is a deliberately different contract from `Jsonc.stringify` (plain
// `JSON.stringify` semantics — nested unrepresentables dropped or nulled):
// fingerprints must never silently alter the document, so every non-JSON
// value is a typed failure carrying the JSON-pointer path to fix. The lenient
// rules in `JsoncCanonicalizeOptions` (bigint, undefined, non-finite numbers,
// toJSON) are opt-in per value kind and inert for plain JSON input.

import type { PlatformError } from "effect";
import { Crypto, Effect, Result, Schema } from "effect";
import * as Hex from "effect/encoding/Hex";
import { causeMessage } from "./internal/causeMessage.js";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";

/**
 * The public canonicalize-error code vocabulary, appearing as the `code` field
 * of {@link JsoncCanonicalizeError}:
 *
 * - `UnrepresentableValue` — an `undefined`, function or symbol anywhere in
 *   the value. Unlike `Jsonc.stringify` (which follows `JSON.stringify`'s
 *   drop/null semantics for nested cases), canonicalization refuses to alter
 *   the document, so these fail typed at any position. Array holes read as
 *   `undefined` and fail here too, carrying the hole's index in `path`. A
 *   property getter that throws during the read also fails here, at the
 *   member's path — a benign getter's value canonicalizes normally, matching
 *   `JSON.stringify`'s accessor semantics.
 * - `BigIntValue` — a `bigint` (anywhere), which JSON cannot represent.
 * - `NonFiniteNumber` — `NaN`, `Infinity` or `-Infinity`, which RFC 8785
 *   forbids (`JSON.stringify` would silently rewrite them to `null`).
 * - `LoneSurrogate` — a string value or object member key containing an
 *   unpaired UTF-16 surrogate. RFC 8785 requires I-JSON (RFC 7493) input,
 *   which malformed Unicode is not (`JSON.stringify` would silently emit a
 *   `\udxxx` escape).
 * - `NonPlainObject` — an object that is neither an array nor a plain object
 *   (a `Date`, `Map`, class instance, …). `toJSON` methods are ignored by
 *   default; encode domain values to plain JSON (e.g. via `Schema`) first,
 *   or opt in with {@link JsoncCanonicalizeOptions}' `toJSON` rule.
 *
 * The `UnrepresentableValue` (for `undefined`), `BigIntValue` and
 * `NonFiniteNumber` failures are the strict default too; each has a
 * {@link JsoncCanonicalizeOptions} rule that accepts the value instead.
 * - `NestingDepthExceeded` — the value nests deeper than the package
 *   hardening cap, which also intercepts cyclic values before they can
 *   recurse forever.
 * - `InvalidDigest` — the {@link JsoncDigest} supplied to
 *   {@link JsoncFingerprint.hashResult} or
 *   {@link JsoncFingerprint.hashTextResult} threw, or returned something
 *   other than a 32-byte SHA-256 digest. The `path` is `""`: the failure is
 *   the caller's platform binding, not a position in the document.
 *
 * @public
 */
export const JsoncCanonicalizeErrorCode = Schema.Literals([
	"UnrepresentableValue",
	"BigIntValue",
	"NonFiniteNumber",
	"LoneSurrogate",
	"NonPlainObject",
	"NestingDepthExceeded",
	"InvalidDigest",
]);

/**
 * The union of all canonicalize-error code string literals.
 *
 * @public
 */
export type JsoncCanonicalizeErrorCode = typeof JsoncCanonicalizeErrorCode.Type;

/**
 * Canonicalization failure: a `JsoncCanonicalizeErrorCode` naming the
 * failure mode, the JSON-pointer `path` to the offending value (`""` is the
 * document root) and a human-readable `detail`. Raised by
 * {@link JsoncFingerprint.canonicalize},
 * {@link JsoncFingerprint.canonicalizeResult},
 * {@link JsoncFingerprint.hash}, {@link JsoncFingerprint.hashResult} and
 * {@link JsoncFingerprint.hashTextResult}.
 *
 * @public
 */
export class JsoncCanonicalizeError extends Schema.TaggedError<JsoncCanonicalizeError>()("JsoncCanonicalizeError", {
	code: JsoncCanonicalizeErrorCode,
	path: Schema.String,
	detail: Schema.String,
}) {
	override get message(): string {
		return `Canonical JSON serialization failed: ${this.code} at "${this.path}" — ${this.detail}`;
	}
}

/**
 * Options controlling {@link JsoncFingerprint.hashText}. All fields are
 * omissible.
 *
 * - `normalizeEol` — normalize `\r\n` and bare `\r` line endings to `\n`
 *   before hashing, so the same file content fingerprints identically across
 *   checkout line-ending settings. Defaults to `false` — by default the bytes
 *   hashed are exactly the UTF-8 encoding of the text given.
 *
 * @public
 */
export class JsoncTextHashOptions extends Schema.Class<JsoncTextHashOptions>("JsoncTextHashOptions")({
	normalizeEol: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * Options relaxing {@link JsoncFingerprint.canonicalizeResult} (and the
 * `canonicalize`, `hash` and `hashResult` statics built on it) for values
 * that are not plain JSON. Every field is omissible and defaults to the
 * strict RFC 8785 behaviour, so an empty options value changes nothing.
 *
 * - `bigint` — `"fail"` (default) fails `BigIntValue`; `"number"` writes the
 *   `bigint` as its bare decimal literal (`123456789012345678901n` →
 *   `123456789012345678901`), a JSON number token no `number` can hold.
 *   A `bigint` and the `number` of the same value are guaranteed the same
 *   text, and so the same fingerprint, only when the value is a safe integer
 *   (`Number.isSafeInteger`). Past that bound a `number` writes its shortest
 *   round-trip form: `2 ** 60` writes `1152921504606847000` while `2n ** 60n`
 *   writes `1152921504606846976`, and from `1e21` up a `number` writes
 *   exponent notation (`1e+21`). Some larger values happen to agree
 *   (`2 ** 53`, `1e20`); do not rely on it.
 * - `undefined` — `"fail"` (default) fails `UnrepresentableValue`;
 *   `"omit"` follows `JSON.stringify`: an object member whose value is
 *   `undefined` is left out, and an `undefined` array element (or a hole in a
 *   sparse array) is written `null`, so indexes never shift. An `undefined`
 *   document root still fails, since there is no text to write. Functions
 *   and symbols fail at any position in either mode.
 * - `nonFinite` — `"fail"` (default) fails `NonFiniteNumber`; `"null"`
 *   writes `NaN`, `Infinity` and `-Infinity` as `null`, as `JSON.stringify`
 *   does. YAML's `.nan` and `.inf` decode to these.
 * - `toJSON` — `"ignore"` (default) never calls `toJSON`, so a `Date` fails
 *   `NonPlainObject`. `"date"` calls it on a `Date` only, the same rule
 *   `@effected/crypto`'s `Fingerprint` applies: a valid `Date` writes its ISO
 *   string and an invalid one `null`. `"all"` calls it on any object (arrays
 *   included) carrying a callable `toJSON`, as `JSON.stringify` does. Either
 *   way it is called once per position with the member key, the array index
 *   or `""` at the root, and its result is canonicalized under the same
 *   options, without calling the result's own `toJSON`. A `toJSON` that throws
 *   fails `UnrepresentableValue` at its path.
 *
 * @remarks
 * For plain JSON input every option is inert, so the output equals strict
 * RFC 8785 byte for byte. Lenient output is still deterministic, and it is
 * still JSON text, but it is no longer RFC 8785 canonical JSON: two values
 * that differ only where an option applied (a member that is `undefined`
 * against one that is absent, `NaN` against `null`) fingerprint the same.
 *
 * `"all"` trusts every `toJSON`. Effect data types such as `Option` and
 * `HashMap` carry one that is a debug rendering, not a stable contract, so
 * prefer `"date"` and encode domain values to plain JSON (for example with
 * `Schema`) before fingerprinting.
 *
 * Unchanged by any option: lone surrogates fail `LoneSurrogate`, non-plain
 * objects with no honoured `toJSON` fail `NonPlainObject`, a throwing getter
 * fails `UnrepresentableValue`, and nesting past the hardening cap fails
 * `NestingDepthExceeded`, which is also where a cyclic value lands, whether
 * the cycle runs through properties or through `toJSON` results.
 *
 * @example
 * ```ts
 * import { JsoncCanonicalizeOptions, JsoncFingerprint } from "@effected/jsonc";
 * import { Result } from "effect";
 *
 * const lenient = JsoncCanonicalizeOptions.make({ bigint: "number", undefined: "omit", toJSON: "date" });
 * const text = JsoncFingerprint.canonicalizeResult(
 *   { ticket: 123456789012345678901n, note: undefined, at: new Date(0) },
 *   lenient,
 * );
 * if (Result.isSuccess(text)) {
 *   console.log(text.success);
 *   // => '{"at":"1970-01-01T00:00:00.000Z","ticket":123456789012345678901}'
 * }
 * ```
 *
 * @public
 */
export class JsoncCanonicalizeOptions extends Schema.Class<JsoncCanonicalizeOptions>("JsoncCanonicalizeOptions")({
	bigint: Schema.optionalKey(Schema.Literals(["fail", "number"])),
	undefined: Schema.optionalKey(Schema.Literals(["fail", "omit"])),
	nonFinite: Schema.optionalKey(Schema.Literals(["fail", "null"])),
	toJSON: Schema.optionalKey(Schema.Literals(["ignore", "date", "all"])),
}) {}

// ── Internal: the JCS emitter ───────────────────────────────────────────────

// Throw carrier so the single recursive emitter can surface a typed error
// from arbitrary depth without threading Results through the walk. Caught and
// converted at the `canonicalizeResult` boundary; never escapes the module.
class CanonicalizeFailure {
	constructor(readonly error: JsoncCanonicalizeError) {}
}

const escapePointerSegment = (segment: string): string => segment.replace(/~/g, "~0").replace(/\//g, "~1");

// RFC 8785 §3.2.3: object members sort by the UTF-16 code units of their
// (unescaped) keys — exactly what `<` on JS strings compares.
const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Member and element reads go through this guard. An accessor property is
// invoked, matching `JSON.stringify` semantics — a benign getter's value
// canonicalizes normally — but a getter that throws must not escape as a raw
// exception through the `canonicalizeResult` boundary: it fails typed at the
// member's JSON-pointer path instead. The `try` wraps ONLY the property read,
// never the recursive `emit` of the value it produced, so a
// `CanonicalizeFailure` from deeper in the walk cannot be caught (and
// re-labelled) here.
const readProperty = (container: object, key: string | number, path: string): unknown => {
	try {
		return (container as Record<string | number, unknown>)[key];
	} catch {
		throw new CanonicalizeFailure(
			JsoncCanonicalizeError.make({
				code: "UnrepresentableValue",
				path,
				detail: "the property getter for this value threw; getters must return plain JSON values",
			}),
		);
	}
};

// The options resolved once per canonicalization, so the hot walk reads
// booleans instead of re-defaulting optional fields at every node.
interface Policy {
	readonly bigintAsNumber: boolean;
	readonly omitUndefined: boolean;
	readonly nonFiniteAsNull: boolean;
	readonly toJSON: "ignore" | "date" | "all";
}

const toPolicy = (options?: JsoncCanonicalizeOptions): Policy => ({
	bigintAsNumber: options?.bigint === "number",
	omitUndefined: options?.undefined === "omit",
	nonFiniteAsNull: options?.nonFinite === "null",
	toJSON: options?.toJSON ?? "ignore",
});

// `toJSON`, applied the way `JSON.stringify` applies it: once per position,
// called with the member key (the index as a string for an array element,
// `""` at the root), and never again on its result. Only under a policy that
// honours it; the strict default never reads the property at all.
const applyToJSON = (value: unknown, key: string, path: string, policy: Policy): unknown => {
	if (policy.toJSON === "ignore" || value === null || typeof value !== "object") {
		return value;
	}
	if (policy.toJSON === "date" && !(value instanceof Date)) {
		return value;
	}
	const toJSON = readProperty(value, "toJSON", path);
	if (typeof toJSON !== "function") {
		return value;
	}
	try {
		return (toJSON as (key: string) => unknown).call(value, key);
	} catch {
		throw new CanonicalizeFailure(
			JsoncCanonicalizeError.make({
				code: "UnrepresentableValue",
				path,
				detail: "the value's toJSON method threw",
			}),
		);
	}
};

const emit = (value: unknown, path: string, depth: number, policy: Policy): string => {
	if (value === null) {
		return "null";
	}
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "number": {
			if (!Number.isFinite(value)) {
				if (policy.nonFiniteAsNull) {
					return "null";
				}
				throw new CanonicalizeFailure(
					JsoncCanonicalizeError.make({
						code: "NonFiniteNumber",
						path,
						detail: `${String(value)} has no canonical JSON representation`,
					}),
				);
			}
			// RFC 8785 §3.2.2.3 number serialization is ECMAScript's shortest
			// round-trip number-to-string under JSON's grammar — exactly what
			// `JSON.stringify` emits for a finite number.
			return JSON.stringify(value);
		}
		case "string":
			// RFC 8785 requires I-JSON (RFC 7493) input: well-formed Unicode
			// only. `JSON.stringify` would silently emit a `\udxxx` escape for
			// an unpaired surrogate; a fingerprint of malformed text is a lie.
			if (!value.isWellFormed()) {
				throw new CanonicalizeFailure(
					JsoncCanonicalizeError.make({
						code: "LoneSurrogate",
						path,
						detail: "string contains an unpaired surrogate; RFC 8785 requires well-formed Unicode",
					}),
				);
			}
			// RFC 8785 §3.2.2.2 string serialization matches `JSON.stringify`:
			// the two-character escapes, `\u00xx` lowercase-hex escapes for the
			// remaining control characters, everything else literal.
			return JSON.stringify(value);
		case "bigint":
			if (policy.bigintAsNumber) {
				// A bigint's decimal form is a valid JSON number token.
				return value.toString();
			}
			throw new CanonicalizeFailure(
				JsoncCanonicalizeError.make({
					code: "BigIntValue",
					path,
					detail: "bigint values cannot be represented in JSON",
				}),
			);
		case "object":
			break;
		default:
			// undefined, function, symbol.
			throw new CanonicalizeFailure(
				JsoncCanonicalizeError.make({
					code: "UnrepresentableValue",
					path,
					detail: `${typeof value} values have no JSON representation`,
				}),
			);
	}
	if (depth >= MAX_NESTING_DEPTH) {
		throw new CanonicalizeFailure(
			JsoncCanonicalizeError.make({
				code: "NestingDepthExceeded",
				path,
				detail: `nesting exceeds ${MAX_NESTING_DEPTH} levels (a cyclic value also fails here)`,
			}),
		);
	}
	if (Array.isArray(value)) {
		// Indexed iteration, not `Array.prototype.map`: `map` skips holes, so a
		// sparse array would emit `[,]`-shaped non-JSON (or silently collapse a
		// hole away). Reading `value[index]` turns each hole into `undefined`,
		// which fails typed above with the hole's JSON-pointer path — the same
		// policy as an explicit `undefined` member.
		// Under `undefined: "omit"` an undefined element (a hole included) is
		// written `null`, as `JSON.stringify` writes it, so indexes never shift.
		const items: Array<string> = [];
		for (let index = 0; index < value.length; index++) {
			const itemPath = `${path}/${index}`;
			const item = applyToJSON(readProperty(value, index, itemPath), String(index), itemPath, policy);
			items.push(item === undefined && policy.omitUndefined ? "null" : emit(item, itemPath, depth + 1, policy));
		}
		return `[${items.join(",")}]`;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new CanonicalizeFailure(
			JsoncCanonicalizeError.make({
				code: "NonPlainObject",
				path,
				detail: "only arrays and plain objects canonicalize; encode domain values to plain JSON first",
			}),
		);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort(compareCodeUnits);
	const members: Array<string> = [];
	for (const key of keys) {
		const memberPath = `${path}/${escapePointerSegment(key)}`;
		// Member keys are strings too: an unpaired surrogate in a key is the
		// same RFC 8785 I-JSON violation as one in a value.
		if (!key.isWellFormed()) {
			throw new CanonicalizeFailure(
				JsoncCanonicalizeError.make({
					code: "LoneSurrogate",
					path: memberPath,
					detail: "object member key contains an unpaired surrogate; RFC 8785 requires well-formed Unicode",
				}),
			);
		}
		const member = applyToJSON(readProperty(record, key, memberPath), key, memberPath, policy);
		// Under `undefined: "omit"` the member is left out, as `JSON.stringify`
		// leaves it out; the decision is made after `toJSON`, so a `toJSON`
		// returning `undefined` omits its member too.
		if (member === undefined && policy.omitUndefined) {
			continue;
		}
		members.push(`${JSON.stringify(key)}:${emit(member, memberPath, depth + 1, policy)}`);
	}
	return `{${members.join(",")}}`;
};

const canonicalizeWith = (value: unknown, policy: Policy): Result.Result<string, JsoncCanonicalizeError> =>
	Result.try({
		try: () => emit(applyToJSON(value, "", "", policy), "", 0, policy),
		catch: (failure) => {
			// Only the engine's own carrier is a typed failure; anything else is a
			// genuine defect and rethrows out of the Result.
			if (failure instanceof CanonicalizeFailure) {
				return failure.error;
			}
			throw failure;
		},
	});

/**
 * The synchronous SHA-256 implementation {@link JsoncFingerprint.hashResult}
 * and {@link JsoncFingerprint.hashTextResult} hash through, supplied by the
 * consumer because this package imports no `node:*` and assumes no runtime.
 *
 * Node's built-in satisfies it with a one-line wrapper:
 *
 * ```ts
 * import { createHash } from "node:crypto";
 * import type { JsoncDigest } from "@effected/jsonc";
 *
 * const digest: JsoncDigest = (bytes) => createHash("sha256").update(bytes).digest();
 * ```
 *
 * The platform binding is entirely the caller's — the same shape
 * `@effected/tsconfig-json`'s `TsconfigLoaderSyncOptions` uses. The function
 * **must** compute SHA-256 over exactly the bytes it is given: the digest's
 * 32-byte length is checked (a wrong-length return fails typed with the
 * `InvalidDigest` code), but no check can catch a different 32-byte
 * algorithm, and the 64-lowercase-hex output guarantee is only as good as
 * what is passed here.
 *
 * It **may throw** — an unsupported algorithm name, a crypto backend refusing
 * to work in this environment. The throw surfaces as an `InvalidDigest`
 * failure carrying its message in `detail`, never as an escaping exception:
 * these twins exist to be called from synchronous host hooks, and crashing
 * one over a platform-binding mistake would defeat the point.
 *
 * @public
 */
export type JsoncDigest = (bytes: Uint8Array) => Uint8Array;

const encoder = new TextEncoder();

// SHA-256 produces 32 bytes. The `Crypto.Crypto` path cannot return anything
// else; the caller-supplied `JsoncDigest` can, so the sync twins check it
// rather than quietly emitting a digest of the wrong width under a contract
// that promises 64 hex characters.
const SHA256_DIGEST_BYTES = 32;

const digestHexResult = (text: string, digest: JsoncDigest): Result.Result<string, JsoncCanonicalizeError> =>
	// A caller's platform binding can fail two ways, and both must arrive as a
	// `Result`: the digest can THROW (`createHash("sha-256")` — hyphenated —
	// throws `ERR_CRYPTO_UNKNOWN_DIGEST` on Node), and it can return the wrong
	// width. An escaping exception would cross the `Result` contract and crash
	// the synchronous host these twins exist to serve, so the call is wrapped
	// exactly as `TsconfigLoaderSync` wraps the consumer's `readFile`.
	Result.flatMap(
		Result.try({
			try: () => digest(encoder.encode(text)),
			catch: (thrown) =>
				JsoncCanonicalizeError.make({
					code: "InvalidDigest",
					path: "",
					detail: `the supplied digest threw: ${causeMessage(thrown) ?? String(thrown)}`,
				}),
		}),
		(bytes) =>
			bytes.length === SHA256_DIGEST_BYTES
				? Result.succeed(Hex.encode(bytes))
				: Result.fail(
						JsoncCanonicalizeError.make({
							code: "InvalidDigest",
							path: "",
							detail: `the supplied digest returned ${String(bytes.length)} bytes; SHA-256 produces ${SHA256_DIGEST_BYTES}`,
						}),
					),
	);

const digestHex = (text: string): Effect.Effect<string, PlatformError.PlatformError, Crypto.Crypto> =>
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto;
		const digest = yield* crypto.digest("SHA-256", encoder.encode(text));
		return Hex.encode(digest);
	});

// ── Facade ──────────────────────────────────────────────────────────────────

/**
 * Static entry points for canonical JSON serialization (RFC 8785, the JSON
 * Canonicalization Scheme) and SHA-256 content fingerprints. Not instantiable.
 *
 * Canonicalization is pure; the two hashing statics require core's
 * `Crypto.Crypto` service in `R` and own no backend — provide
 * `@effect/platform-node`'s `NodeCrypto.layer` (or any `Crypto` layer, e.g.
 * one built with `Crypto.make` over WebCrypto) at the application edge.
 *
 * @example
 * ```ts
 * import { JsoncFingerprint } from "@effected/jsonc";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   // Key order never matters: both values fingerprint identically.
 *   const a = yield* JsoncFingerprint.hash({ b: 2, a: 1 });
 *   const b = yield* JsoncFingerprint.hash({ a: 1, b: 2 });
 *   return a === b; // true
 * });
 * // Provide a Crypto layer at the edge, e.g. NodeCrypto.layer from
 * // "@effect/platform-node".
 * ```
 *
 * @public
 */
export class JsoncFingerprint {
	private constructor() {}

	/**
	 * Serialize a JSON value to its RFC 8785 canonical text, synchronously,
	 * returning a `Result` instead of an `Effect`: compact output (no
	 * whitespace), object keys sorted lexicographically by UTF-16 code units,
	 * ECMAScript number serialization and `JSON.stringify` string escaping.
	 * Equal JSON values canonicalize to equal strings.
	 *
	 * Unlike {@link Jsonc.stringify} — which follows `JSON.stringify`'s
	 * documented drop/null semantics for nested unrepresentables — every
	 * non-JSON value fails typed here, carrying the JSON-pointer path to fix:
	 * a fingerprint of a silently altered document would be a lie.
	 *
	 * @remarks
	 * {@link JsoncFingerprint.canonicalize} is defined in terms of this
	 * function; the two never diverge. Reach for the `Effect` variant inside
	 * Effect code — it carries the `JsoncFingerprint.canonicalize` tracing
	 * span — and for this one at synchronous boundaries.
	 *
	 * @example
	 * ```ts
	 * import { JsoncFingerprint } from "@effected/jsonc";
	 * import { Result } from "effect";
	 *
	 * const ok = JsoncFingerprint.canonicalizeResult({ b: 2, a: 1 });
	 * if (Result.isSuccess(ok)) {
	 *   console.log(ok.success); // => '{"a":1,"b":2}'
	 * }
	 *
	 * const bad = JsoncFingerprint.canonicalizeResult({ a: { b: undefined } });
	 * if (Result.isFailure(bad)) {
	 *   console.log(bad.failure.code); // => "UnrepresentableValue"
	 *   console.log(bad.failure.path); // => "/a/b"
	 * }
	 * ```
	 *
	 * Pass {@link JsoncCanonicalizeOptions} to accept a `bigint`, an
	 * `undefined`, a non-finite number or a `toJSON`-bearing value instead of
	 * failing; each option states its rule, and none changes the output for
	 * plain JSON input.
	 *
	 * @param value - The plain JSON value (`null`, booleans, finite numbers,
	 *   strings, arrays, plain objects) to serialize.
	 * @param options - Optional {@link JsoncCanonicalizeOptions}; omitted, every
	 *   non-JSON value fails as RFC 8785 requires.
	 * @returns A `Result` succeeding with the canonical JSON text, or failing
	 *   with a {@link JsoncCanonicalizeError}.
	 */
	static canonicalizeResult(
		value: unknown,
		options?: JsoncCanonicalizeOptions,
	): Result.Result<string, JsoncCanonicalizeError> {
		return canonicalizeWith(value, toPolicy(options));
	}

	/**
	 * Serialize a JSON value to its RFC 8785 canonical text. Fails with
	 * {@link JsoncCanonicalizeError} on any non-JSON value (`undefined`,
	 * functions, symbols, `bigint`, non-finite numbers, strings or member keys
	 * with unpaired surrogates, non-plain objects) and
	 * on nesting past the hardening cap (which also intercepts cycles), unless
	 * a {@link JsoncCanonicalizeOptions} rule accepts it.
	 * Defined in terms of {@link JsoncFingerprint.canonicalizeResult} —
	 * synchronous callers can use that variant directly.
	 *
	 * @param value - The plain JSON value to serialize.
	 * @param options - Optional {@link JsoncCanonicalizeOptions}.
	 * @returns An `Effect` that succeeds with the canonical JSON text, or
	 *   fails with a {@link JsoncCanonicalizeError}.
	 */
	static readonly canonicalize = Effect.fn("JsoncFingerprint.canonicalize")(
		(value: unknown, options?: JsoncCanonicalizeOptions) =>
			Effect.fromResult(JsoncFingerprint.canonicalizeResult(value, options)),
	);

	/**
	 * Normalize line endings for hashing: `\r\n` and bare `\r` become `\n`.
	 * Pure and total — exactly the normalization
	 * {@link JsoncFingerprint.hashText} applies when its `normalizeEol` option
	 * is set, exposed so split/inspect flows can share it.
	 *
	 * @param text - The text to normalize.
	 * @returns The text with all line endings as `\n`.
	 */
	static normalizeEol(text: string): string {
		return text.replace(/\r\n?/g, "\n");
	}

	/**
	 * The content fingerprint of a JSON value, computed synchronously through
	 * a caller-supplied digest and returned as a `Result` instead of an
	 * `Effect`: the lowercase-hex SHA-256 of the UTF-8 bytes of the value's
	 * RFC 8785 canonical serialization.
	 *
	 * Byte-for-byte the same answer {@link JsoncFingerprint.hash} gives, for
	 * callers with no fiber to run one in — a bundler plugin's synchronous
	 * hook, a cache `read`/`write` invoked from inside a host's sync
	 * callback. Hashing is the one place the package cannot stay pure on its
	 * own, so the caller binds the platform: pass a {@link JsoncDigest}
	 * wrapping `node:crypto`'s `createHash` (or any SHA-256 implementation),
	 * exactly as a `Crypto` layer is provided at the edge for the `Effect`
	 * variant.
	 *
	 * @example
	 * ```ts
	 * import { createHash } from "node:crypto";
	 * import { JsoncFingerprint } from "@effected/jsonc";
	 * import { Result } from "effect";
	 *
	 * const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
	 *
	 * const fingerprint = JsoncFingerprint.hashResult({ b: 2, a: 1 }, digest);
	 * if (Result.isSuccess(fingerprint)) {
	 *   console.log(fingerprint.success); // 64 lowercase hex characters
	 * }
	 * ```
	 *
	 * @param value - The plain JSON value to fingerprint.
	 * @param digest - The consumer's SHA-256 implementation; see
	 *   {@link JsoncDigest}.
	 * @param options - Optional {@link JsoncCanonicalizeOptions}, applied to the
	 *   canonicalization the digest is taken over.
	 * @returns A `Result` succeeding with the 64-character lowercase-hex
	 *   SHA-256, or failing with a {@link JsoncCanonicalizeError} — the same
	 *   canonicalization failures {@link JsoncFingerprint.canonicalizeResult}
	 *   raises, plus `InvalidDigest` if `digest` threw or returned a
	 *   wrong-width result.
	 */
	static hashResult(
		value: unknown,
		digest: JsoncDigest,
		options?: JsoncCanonicalizeOptions,
	): Result.Result<string, JsoncCanonicalizeError> {
		return Result.flatMap(JsoncFingerprint.canonicalizeResult(value, options), (text) => digestHexResult(text, digest));
	}

	/**
	 * The content fingerprint of a JSON value: the lowercase-hex SHA-256 of
	 * the UTF-8 bytes of its RFC 8785 canonical serialization. Values that
	 * differ only in object key order fingerprint identically; any non-JSON
	 * value fails with the same typed errors as
	 * {@link JsoncFingerprint.canonicalize}.
	 *
	 * Requires core's `Crypto.Crypto` service — provide
	 * `@effect/platform-node`'s `NodeCrypto.layer` (or any `Crypto` layer) at
	 * the application edge. The digest itself can fail with the platform's
	 * `PlatformError`, passed through untranslated.
	 * Synchronous callers with no fiber to run this in reach for
	 * {@link JsoncFingerprint.hashResult} instead, supplying their own
	 * digest; the two agree byte for byte.
	 *
	 * The output format is a guarantee: exactly 64 lowercase hexadecimal
	 * characters, with no `sha256:` (or other) algorithm prefix — the digest
	 * vocabulary `@effected/sbom`'s `Sha256Digest` schema decodes, so
	 * fingerprints flow into attestation subjects downstream without this
	 * package taking any edge on `sbom`.
	 *
	 * @param value - The plain JSON value to fingerprint.
	 * @param options - Optional {@link JsoncCanonicalizeOptions}, applied to the
	 *   canonicalization the digest is taken over.
	 * @returns An `Effect` requiring `Crypto.Crypto` that succeeds with the
	 *   64-character lowercase-hex SHA-256, or fails with a
	 *   {@link JsoncCanonicalizeError} (or the platform's `PlatformError`).
	 */
	static readonly hash = Effect.fn("JsoncFingerprint.hash")(
		(
			value: unknown,
			options?: JsoncCanonicalizeOptions,
		): Effect.Effect<string, JsoncCanonicalizeError | PlatformError.PlatformError, Crypto.Crypto> =>
			Effect.flatMap(Effect.fromResult(JsoncFingerprint.canonicalizeResult(value, options)), digestHex),
	);

	/**
	 * The content fingerprint of raw text, computed synchronously through a
	 * caller-supplied digest and returned as a `Result` instead of an
	 * `Effect`: the lowercase-hex SHA-256 of its UTF-8 bytes, with the same
	 * opt-in line-ending normalization {@link JsoncFingerprint.hashText}
	 * applies.
	 *
	 * Byte-for-byte the same answer `hashText` gives, for callers with no
	 * fiber to run one in. The caller binds the platform by passing a
	 * {@link JsoncDigest}; see {@link JsoncFingerprint.hashResult}.
	 *
	 * @param text - The text content to fingerprint.
	 * @param digest - The consumer's SHA-256 implementation; see
	 *   {@link JsoncDigest}.
	 * @param options - Optional {@link JsoncTextHashOptions}; defaults apply
	 *   for omitted fields.
	 * @returns A `Result` succeeding with the 64-character lowercase-hex
	 *   SHA-256, or failing with a {@link JsoncCanonicalizeError} carrying
	 *   the `InvalidDigest` code if `digest` threw or returned a wrong-width
	 *   result.
	 */
	static hashTextResult(
		text: string,
		digest: JsoncDigest,
		options?: JsoncTextHashOptions,
	): Result.Result<string, JsoncCanonicalizeError> {
		return digestHexResult(options?.normalizeEol === true ? JsoncFingerprint.normalizeEol(text) : text, digest);
	}

	/**
	 * The content fingerprint of raw text: the lowercase-hex SHA-256 of its
	 * UTF-8 bytes, with opt-in line-ending normalization (`\r\n`/`\r` → `\n`)
	 * for file content that must fingerprint identically across checkout
	 * line-ending settings.
	 *
	 * Requires core's `Crypto.Crypto` service — provide
	 * `@effect/platform-node`'s `NodeCrypto.layer` (or any `Crypto` layer) at
	 * the application edge.
	 * Synchronous callers reach for
	 * {@link JsoncFingerprint.hashTextResult} instead, supplying their own
	 * digest; the two agree byte for byte.
	 *
	 * The output format is a guarantee: exactly 64 lowercase hexadecimal
	 * characters, with no `sha256:` (or other) algorithm prefix — the digest
	 * vocabulary `@effected/sbom`'s `Sha256Digest` schema decodes, so
	 * fingerprints flow into attestation subjects downstream without this
	 * package taking any edge on `sbom`.
	 *
	 * @example
	 * ```ts
	 * import { JsoncFingerprint, JsoncTextHashOptions } from "@effected/jsonc";
	 * import { Effect } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 *   const options = JsoncTextHashOptions.make({ normalizeEol: true });
	 *   const a = yield* JsoncFingerprint.hashText("line one\r\nline two", options);
	 *   const b = yield* JsoncFingerprint.hashText("line one\nline two", options);
	 *   return a === b; // true
	 * });
	 * ```
	 *
	 * @param text - The text content to fingerprint.
	 * @param options - Optional {@link JsoncTextHashOptions}; defaults apply
	 *   for omitted fields.
	 * @returns An `Effect` requiring `Crypto.Crypto` that succeeds with the
	 *   64-character lowercase-hex SHA-256, or fails with the platform's
	 *   `PlatformError` if the digest itself fails.
	 */
	static readonly hashText = Effect.fn("JsoncFingerprint.hashText")(
		(text: string, options?: JsoncTextHashOptions): Effect.Effect<string, PlatformError.PlatformError, Crypto.Crypto> =>
			digestHex(options?.normalizeEol === true ? JsoncFingerprint.normalizeEol(text) : text),
	);
}
