import { Effect, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { formatVersion } from "./internal/grammar.js";
import { SemVer } from "./SemVer.js";

/**
 * Indicates that a string is not exactly one operator followed by one
 * complete version.
 *
 * Raised by {@link VersionSpecifier.parse}. Compound ranges, partial
 * versions, wildcards, dist-tags, protocol specifiers and padded input all
 * land here.
 *
 * @public
 */
export class InvalidVersionSpecifierError extends Schema.TaggedError<InvalidVersionSpecifierError>()(
	"InvalidVersionSpecifierError",
	{
		/** The raw input string that failed to parse. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return `Invalid version specifier: "${this.input}"`;
	}
}

/** Operators, longest first, so `>=` is never read as `>` followed by `=1.2.3`. */
const OPERATORS = [">=", "<=", "^", "~", ">", "<", "="] as const;

/**
 * A dependency specifier that is one operator and one complete version:
 * `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`, and so on. Unlike a `Range`, it
 * keeps the operator as written (a caret stays a caret) and refuses anything
 * compound, partial or padded, so a caller can rewrite the version without
 * ever dropping part of a range.
 *
 * @remarks
 * The empty operator and `=` are distinct, so the text round-trips
 * byte-exact. For protocol-aware parsing (`workspace:`, `npm:`, `catalog:`),
 * see `DependencySpecifier` in `@effected/npm`; this class answers the bare
 * version case only.
 *
 * @example
 * ```ts
 * import { SemVer, VersionSpecifier } from "@effected/semver";
 * import { Result } from "effect";
 *
 * const parsed = VersionSpecifier.parseResult("^1.2.3");
 * if (Result.isSuccess(parsed)) {
 *   console.log(parsed.success.withVersion(SemVer.of(2, 0, 0)).toString());
 *   // => "^2.0.0"
 * }
 * ```
 *
 * @public
 */
export class VersionSpecifier extends Schema.Class<VersionSpecifier>("VersionSpecifier")({
	/** The operator as written; `""` means a bare version. */
	operator: Schema.Literals(["", "^", "~", ">=", ">", "<=", "<", "="]),
	/** The one version the operator applies to. */
	version: SemVer,
}) {
	// ── Schema ──────────────────────────────────────────────────────────

	/**
	 * Schema transformation between the specifier string (e.g. `"^1.2.3"`)
	 * and {@link VersionSpecifier}.
	 */
	static readonly FromString: Schema.Codec<VersionSpecifier, string> = Schema.String.pipe(
		Schema.decodeTo(
			VersionSpecifier,
			SchemaTransformation.transformEffect({
				decode: (input: string) => {
					const result = VersionSpecifier.parseResult(input);
					return Result.isSuccess(result)
						? Effect.succeed({
								operator: result.success.operator,
								version: {
									major: result.success.version.major,
									minor: result.success.version.minor,
									patch: result.success.version.patch,
									prerelease: result.success.version.prerelease,
									build: result.success.version.build,
								},
							})
						: Effect.fail(new SchemaIssue.InvalidValue({ message: result.failure.message }, input));
				},
				encode: (parts) => Effect.succeed(`${parts.operator}${formatVersion(parts.version)}`),
			}),
		),
	);

	// ── Construction ────────────────────────────────────────────────────

	/**
	 * Parse a specifier string synchronously, returning a `Result`.
	 *
	 * @remarks
	 * Strips the longest matching operator, then requires the remainder to be
	 * one exact version with no surrounding whitespace. {@link VersionSpecifier.parse}
	 * is defined in terms of this function.
	 *
	 * @param input - the specifier string to parse
	 * @returns a `Result` succeeding with the parsed {@link VersionSpecifier},
	 * or failing with {@link InvalidVersionSpecifierError}.
	 */
	static parseResult(input: string): Result.Result<VersionSpecifier, InvalidVersionSpecifierError> {
		const operator = OPERATORS.find((op) => input.startsWith(op)) ?? "";
		const rest = input.slice(operator.length);
		if (!SemVer.isValid(rest)) {
			return Result.fail(new InvalidVersionSpecifierError({ input }));
		}
		const version = SemVer.parseResult(rest);
		return Result.isSuccess(version)
			? Result.succeed(VersionSpecifier.make({ operator, version: version.success }))
			: Result.fail(new InvalidVersionSpecifierError({ input }));
	}

	/**
	 * Parse a specifier string. Defined in terms of
	 * {@link VersionSpecifier.parseResult}.
	 *
	 * @param input - the specifier string to parse
	 * @returns the parsed {@link VersionSpecifier}. Fails with
	 * {@link InvalidVersionSpecifierError}.
	 */
	static readonly parse = Effect.fn("VersionSpecifier.parse")((input: string) =>
		Effect.fromResult(VersionSpecifier.parseResult(input)),
	);

	// ── Instance ────────────────────────────────────────────────────────

	/** A specifier with the same operator and a different version. */
	withVersion(next: SemVer): VersionSpecifier {
		return VersionSpecifier.make({ operator: this.operator, version: next });
	}

	/** The specifier string: the operator followed by the version. */
	override toString(): string {
		return `${this.operator}${this.version.toString()}`;
	}

	/** @internal */
	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return this.toString();
	}
}
