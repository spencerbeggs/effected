import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { formatComparator, parseComparator } from "./internal/grammar.js";
import { SemVer } from "./SemVer.js";

/**
 * Indicates that a string could not be parsed as a single comparator.
 *
 * Raised by {@link Comparator.parse}. The decode direction of
 * {@link Comparator.FromString} reports the same failure through a generic
 * `Schema` parse error instead of this class, carrying the same message.
 *
 * @public
 */
export class InvalidComparatorError extends Schema.TaggedErrorClass<InvalidComparatorError>()(
	"InvalidComparatorError",
	{
		/** The raw input string that failed to parse. */
		input: Schema.String,
		/** The character position where parsing failed, if available. */
		position: Schema.optionalKey(Schema.Number),
	},
) {
	override get message(): string {
		const base = `Invalid comparator: "${this.input}"`;
		return this.position !== undefined ? `${base} at position ${this.position}` : base;
	}
}

/**
 * A single version constraint: a comparison operator applied to a version.
 * Comparator strings accept an optional operator prefix (`=`, `>`, `>=`,
 * `<`, `<=`) followed by a complete version; a missing operator means `=`.
 * Wildcards and range sugar are not allowed — those belong to `Range`.
 *
 * @example
 * ```ts
 * import { Comparator, SemVer } from "@effected/semver";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const comparator = yield* Comparator.parse(">=1.2.3");
 *   const version = yield* SemVer.parse("2.0.0");
 *   return comparator.test(version);
 * });
 *
 * console.log(Effect.runSync(program));
 * // => true
 * ```
 *
 * @public
 */
export class Comparator extends Schema.Class<Comparator>("Comparator")({
	/** The relational operator applied to `version`; a missing prefix in the source string means `=`. */
	operator: Schema.Literals(["=", ">", ">=", "<", "<="]),
	/** The version the operator is applied against. */
	version: SemVer,
}) {
	// ── Schema ──────────────────────────────────────────────────────────

	/**
	 * Schema transformation between the comparator string (e.g. `">=1.2.3"`)
	 * and {@link Comparator}.
	 */
	static readonly FromString: Schema.Codec<Comparator, string> = Schema.String.pipe(
		Schema.decodeTo(
			Comparator,
			SchemaTransformation.transformOrFail({
				decode: (input: string) => {
					const result = parseComparator(input);
					return result.ok
						? Effect.succeed(result.value)
						: Effect.fail(
								new SchemaIssue.InvalidValue(Option.some(input), {
									message: `Invalid comparator: "${result.input}" at position ${result.position}`,
								}),
							);
				},
				encode: (parts) => Effect.succeed(formatComparator(parts)),
			}),
		),
	);

	// ── Construction ────────────────────────────────────────────────────

	/** Parse a comparator string (e.g. `">=1.2.3"`). */
	static readonly parse = Effect.fn("Comparator.parse")(function* (input: string) {
		const result = parseComparator(input);
		if (!result.ok) {
			return yield* new InvalidComparatorError({ input: result.input, position: result.position });
		}
		return Comparator.make({ operator: result.value.operator, version: SemVer.make(result.value.version) });
	});

	// ── Instance ────────────────────────────────────────────────────────

	/** Test whether a version satisfies this comparator. */
	test(version: SemVer): boolean {
		const cmp = version.compare(this.version);
		switch (this.operator) {
			case "=":
				return cmp === 0;
			case ">":
				return cmp > 0;
			case ">=":
				return cmp >= 0;
			case "<":
				return cmp < 0;
			case "<=":
				return cmp <= 0;
		}
	}

	/** The comparator string; the `=` operator is implicit. */
	override toString(): string {
		return formatComparator(this);
	}

	/** @internal */
	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return this.toString();
	}
}
