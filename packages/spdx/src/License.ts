import { Effect, Result, Schema } from "effect";
import { DEPRECATED_LICENSE_IDS, LICENSE_IDS } from "./internal/licenseIds.js";

/**
 * Indicates that a string is not a valid SPDX expression fragment: an
 * unrecognized license or exception identifier, or a malformed
 * `LicenseRef-`/`DocumentRef-` reference.
 *
 * This is the package's single typed error. Both malformed grammar and an
 * unknown identifier fail through it on the `E` channel — never as a defect,
 * per the input-hardening invariant. {@link License.parse} and
 * `LicenseException.parse` raise it, and the recursive expression parser reuses
 * it for the whole grammar.
 *
 * @see {@link https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/ | SPDX License Expressions}
 * @public
 */
export class InvalidSpdxExpressionError extends Schema.TaggedErrorClass<InvalidSpdxExpressionError>()(
	"InvalidSpdxExpressionError",
	{
		/** The raw input string that failed to validate. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid SPDX expression: "${this.input}"`;
	}
}

// A LicenseRef / DocumentRef reference is valid without catalog membership.
// SPDX Appendix IV grammar:
//   license-ref = ["DocumentRef-"idstring":"]"LicenseRef-"idstring
//   idstring    = 1*(ALPHA / DIGIT / "-" / "." )
// The pattern is anchored and lookahead-free so it stays cheap and its inverse
// (a malformed ref) fails to match and surfaces as a typed error, not a throw.
const LICENSE_REF_PATTERN = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;

/**
 * A validated SPDX license identifier: an Effect `Schema.Class` whose `id` is
 * either a member of the SPDX License List or a well-formed
 * `LicenseRef-`/`DocumentRef-` reference. The class doubles as its own schema —
 * there is no `*Schema` suffix.
 *
 * This is the catalog-level model: it validates and resolves an identifier and
 * owns the static catalog and predicates. It is deliberately distinct from, and
 * a coarser altitude than, the expression AST's simple-license leaf: the
 * trailing `+` ("or later") marker is an expression-level operator and does not
 * live here, and a `LicenseRef` is accepted whole as an `id` rather than
 * decomposed. The AST layer consumes these validation statics rather than
 * unifying its leaf with this class.
 *
 * Construction of a resolved identifier goes through {@link License.parse}
 * (Effect) or {@link License.parseResult} (the synchronous `Result` primitive);
 * the inherited `make` remains the field-level struct constructor.
 *
 * @example
 * ```ts
 * import { License } from "@effected/spdx";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const mit = yield* License.parse("MIT");
 *   return [mit.id, mit.deprecated] as const;
 * });
 *
 * console.log(Effect.runSync(program));
 * // => ["MIT", false]
 * ```
 *
 * @see {@link https://spdx.org/licenses/ | SPDX License List}
 * @public
 */
export class License extends Schema.Class<License>("License")({
	/**
	 * The SPDX short identifier (e.g. `"MIT"`) or a `LicenseRef-`/`DocumentRef-`
	 * reference string.
	 */
	id: Schema.String,
	/**
	 * Whether `id` is a deprecated SPDX identifier. Always `false` for a
	 * `LicenseRef`/`DocumentRef` reference.
	 */
	deprecated: Schema.Boolean,
}) {
	// ── Catalog ─────────────────────────────────────────────────────────

	/**
	 * The full SPDX license catalog keyed by identifier, holding resolved
	 * {@link License} domain objects for every active and deprecated id. Built
	 * once from the vendored datasets at module load; references are not
	 * catalog members.
	 */
	static readonly catalog: ReadonlyMap<string, License> = (() => {
		const map = new Map<string, License>();
		for (const id of LICENSE_IDS) map.set(id, License.make({ id, deprecated: false }));
		for (const id of DEPRECATED_LICENSE_IDS) map.set(id, License.make({ id, deprecated: true }));
		return map;
	})();

	/**
	 * Whether `id` is a recognized SPDX license identifier — active or
	 * deprecated. A grammatically valid `LicenseRef`/`DocumentRef` is not a
	 * catalog member and returns `false`.
	 */
	static isKnownId(id: string): boolean {
		return License.catalog.has(id);
	}

	/** Whether `id` is specifically a deprecated SPDX license identifier. */
	static isDeprecatedId(id: string): boolean {
		return DEPRECATED_LICENSE_IDS.has(id);
	}

	/**
	 * Whether `id` matches the `LicenseRef-`/`DocumentRef-` reference grammar.
	 * A reference is valid without catalog membership; this is the grammar
	 * predicate the expression parser consults.
	 */
	static isLicenseRef(id: string): boolean {
		return LICENSE_REF_PATTERN.test(id);
	}

	// ── Construction ────────────────────────────────────────────────────

	/**
	 * Validate a license identifier synchronously, returning a `Result`. The
	 * `id` is accepted when it is a catalog member (active or deprecated) or a
	 * well-formed `LicenseRef`/`DocumentRef` reference; anything else fails with
	 * {@link InvalidSpdxExpressionError}.
	 *
	 * @remarks
	 * {@link License.parse} is defined in terms of this function; the two never
	 * diverge. Reach for the `Effect` variant inside Effect code — it carries
	 * the `License.parse` tracing span — and for this one at synchronous
	 * boundaries.
	 *
	 * @param id - the license identifier to validate
	 * @returns a `Result` succeeding with the resolved {@link License}, or
	 * failing with {@link InvalidSpdxExpressionError}.
	 */
	static parseResult(id: string): Result.Result<License, InvalidSpdxExpressionError> {
		const known = License.catalog.get(id);
		if (known !== undefined) return Result.succeed(known);
		if (LICENSE_REF_PATTERN.test(id)) return Result.succeed(License.make({ id, deprecated: false }));
		return Result.fail(new InvalidSpdxExpressionError({ input: id }));
	}

	/**
	 * Validate a license identifier. Defined in terms of
	 * {@link License.parseResult} — synchronous callers can use that variant
	 * directly.
	 *
	 * @param id - the license identifier to validate
	 * @returns the resolved {@link License}. Fails with
	 * {@link InvalidSpdxExpressionError} when `id` is neither a catalog member
	 * nor a valid reference.
	 */
	static readonly parse = Effect.fn("License.parse")((id: string) => Effect.fromResult(License.parseResult(id)));

	/**
	 * Construct a {@link License} directly from already-typed parts:
	 * `License.of("MIT")`. This is the field-level convenience constructor, a thin
	 * wrapper over the inherited `make` — it does **not** consult the catalog and
	 * does **not** validate that `id` is a known identifier or a well-formed
	 * reference. Reach for {@link License.parse} or {@link License.parseResult}
	 * when the `id` is untrusted and must be validated.
	 *
	 * @param id - the SPDX short identifier or `LicenseRef`/`DocumentRef` reference
	 * @param deprecated - whether `id` is a deprecated identifier; defaults to
	 * `false`
	 * @returns the constructed {@link License}
	 */
	static of(id: string, deprecated = false): License {
		return License.make({ id, deprecated });
	}

	// ── Display ─────────────────────────────────────────────────────────

	/** The identifier string. */
	override toString(): string {
		return this.id;
	}
}
