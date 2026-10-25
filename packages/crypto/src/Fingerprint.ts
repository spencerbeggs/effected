import type { PlatformError, Result } from "effect";
import { Crypto, Effect } from "effect";
import * as Hex from "effect/encoding/Hex";
import type { DriftDecision } from "./DriftDecision.js";
import { DriftApply, DriftDetected, DriftUnchanged } from "./DriftDecision.js";
import type { FingerprintError } from "./FingerprintError.js";
import { utf8 } from "./internal/bytes.js";
import { canonicalText } from "./internal/canonical.js";

/**
 * The three fingerprints {@link Fingerprint.decide} compares.
 *
 * @public
 */
export interface FingerprintDecideInput {
	/**
	 * The fingerprint of the value last applied, persisted from the previous
	 * run. Absent (or `undefined`) when the resource was never applied.
	 */
	readonly applied?: string | undefined;
	/** The fingerprint of the value the resource holds now. */
	readonly live: string;
	/** The fingerprint of the value the caller wants it to hold. */
	readonly desired: string;
}

/**
 * Stable fingerprints of JSON-shaped values, and the three-way drift decision
 * built on them.
 *
 * @remarks
 * A fingerprint is the SHA-256 hex digest of a canonical JSON text, so it is
 * stable across process restarts and independent of object identity and key
 * insertion order. The canonicalisation is the contract, and it has three
 * rules:
 *
 * - **Object keys are sorted at every depth**, by UTF-16 code units, so
 *   reordering a config's keys is not drift. Numeric-like keys sort
 *   lexicographically too: `"10"` comes before `"2"`.
 * - **Array order is preserved**, so reordering elements is a real change.
 * - **An `undefined` object member is dropped**, as `JSON.stringify` drops it,
 *   so an absent key and an explicitly undefined key fingerprint alike.
 *
 * Otherwise the text follows `JSON.stringify`: a `Date` fingerprints as its
 * ISO string, and an `undefined` array element is written as `null`. Values
 * with no faithful JSON form are refused with {@link FingerprintError} rather
 * than coerced: a `bigint`, a function, a symbol, a non-finite number, a
 * cycle, and any object that is not a `Date`, an array or a plain object
 * (one whose prototype is `Object.prototype` or `null`). That includes a
 * `Map`, a class instance, and Effect data types such as `Option` or
 * `HashMap`, whatever `toJSON` they carry, because their `toJSON` output is
 * no stable contract: encode a domain value to plain JSON first, for
 * example with its `Schema`.
 *
 * This is deliberately not RFC 8785: `JsoncFingerprint` in `@effected/jsonc`
 * refuses `undefined`, where drift detection must treat it as absent.
 *
 * The digest comes from core `Crypto.digest`, required in `R`, so the same
 * code runs on Node (`NodeCrypto.layer`) and on Cloudflare Workers (a
 * WebCrypto-backed `Crypto` layer).
 *
 * @public
 */
export class Fingerprint {
	private constructor() {}

	/**
	 * The canonical JSON text a fingerprint is computed over, synchronously.
	 *
	 * @remarks
	 * Useful for explaining a drift report: two values fingerprint alike
	 * exactly when their canonical texts are equal. See {@link Fingerprint}
	 * for the rules.
	 *
	 * @example
	 * ```ts
	 * import { Fingerprint } from "@effected/crypto";
	 *
	 * Fingerprint.canonicalizeResult({ b: [2, 1], a: undefined, c: { y: 1, x: 2 } });
	 * // Result.succeed('{"b":[2,1],"c":{"x":2,"y":1}}')
	 * ```
	 *
	 * @param value - A JSON-shaped value.
	 * @returns A `Result` succeeding with the canonical text, or failing with
	 * {@link FingerprintError}.
	 */
	static canonicalizeResult(value: unknown): Result.Result<string, FingerprintError> {
		return canonicalText(value);
	}

	/**
	 * The fingerprint of a JSON-shaped value: the lowercase SHA-256 hex digest
	 * of its canonical JSON text.
	 *
	 * @remarks
	 * Requires core's `Crypto.Crypto` in `R`; a digest failure is core's
	 * `PlatformError`. Built on {@link Fingerprint.canonicalizeResult}, so the
	 * two can never disagree. See {@link Fingerprint} for the canonical rules.
	 *
	 * @example
	 * ```ts
	 * import { Fingerprint } from "@effected/crypto";
	 * import { Effect } from "effect";
	 *
	 * const program = Effect.gen(function* () {
	 *   const a = yield* Fingerprint.of({ name: "main", rules: ["a", "b"] });
	 *   const b = yield* Fingerprint.of({ rules: ["a", "b"], name: "main" });
	 *   return a === b; // true: key order is not drift
	 * });
	 * // provide NodeCrypto.layer, or a WebCrypto-backed Crypto layer
	 * ```
	 *
	 * @param value - A JSON-shaped value.
	 * @returns An `Effect` requiring `Crypto.Crypto` that succeeds with 64
	 * lowercase hex characters.
	 */
	static readonly of: (
		value: unknown,
	) => Effect.Effect<string, FingerprintError | PlatformError.PlatformError, Crypto.Crypto> = Effect.fn(
		"Fingerprint.of",
	)(function* (value: unknown) {
		const text = yield* Effect.fromResult(canonicalText(value));
		const crypto = yield* Crypto.Crypto;
		return Hex.encode(yield* crypto.digest("SHA-256", utf8(text)));
	});

	/**
	 * Decide what to do with a resource from three fingerprints: the one last
	 * applied, the live one, and the desired one.
	 *
	 * @remarks
	 * The rules, in order:
	 *
	 * 1. No `applied` baseline: `Apply`. The resource was never applied by
	 *    this tool, so there is nothing to have drifted from.
	 * 2. `live` differs from `applied`: `Drift`, carrying both. Somebody else
	 *    changed the resource. This holds whether or not `desired` also
	 *    changed: when both moved, the user most wants to be told before
	 *    anything is overwritten, so drift wins over applying. It also holds
	 *    when the out-of-band change happens to equal `desired`; compare
	 *    `live` with `desired` yourself to treat that as converged.
	 * 3. `desired` differs from `applied`: `Apply`.
	 * 4. Otherwise: `Unchanged`.
	 *
	 * After an `Apply`, persist the desired fingerprint as the next run's
	 * `applied`. Pure and synchronous: the fingerprints are already computed.
	 *
	 * @example
	 * ```ts
	 * import { Fingerprint } from "@effected/crypto";
	 *
	 * const decision = Fingerprint.decide({ applied: "aa", live: "bb", desired: "cc" });
	 * // DriftDetected { _tag: "Drift", applied: "aa", live: "bb" }
	 * ```
	 *
	 * @param input - The applied, live and desired fingerprints.
	 * @returns The {@link (DriftDecision:type)}.
	 */
	static decide(input: FingerprintDecideInput): DriftDecision {
		const { applied, live, desired } = input;
		if (applied === undefined) return DriftApply.make({});
		if (live !== applied) return DriftDetected.make({ applied, live });
		if (desired !== applied) return DriftApply.make({});
		return DriftUnchanged.make({});
	}
}
