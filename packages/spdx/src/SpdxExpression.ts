import { Effect, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import type { RawExpression } from "./internal/parser.js";
import { parse as parseRaw } from "./internal/parser.js";
import { InvalidSpdxExpressionError } from "./License.js";

/**
 * A simple-license leaf of an SPDX expression: a license identifier with the
 * trailing `+` ("or later") marker. This is the expression-level license node —
 * distinct from, and a finer altitude than, the catalog `License` class in
 * `./License.js`, which validates and resolves an identifier but does not model
 * the `+` operator.
 *
 * @public
 */
export class LicenseNode extends Schema.TaggedClass<LicenseNode>()("License", {
	/** The SPDX short identifier, e.g. `"MIT"` or `"Apache-2.0"`. */
	id: Schema.String,
	/** Whether the trailing `+` "or later" marker is present. */
	plus: Schema.Boolean,
}) {
	/** The canonical string form: the id, suffixed with `+` when {@link LicenseNode.plus} is set. */
	override toString(): string {
		return this.plus ? `${this.id}+` : this.id;
	}
}

/**
 * A `LicenseRef`/`DocumentRef` reference leaf. The `LicenseRef-`/`DocumentRef-`
 * prefixes and the `:` separator are structural and are not stored; only the
 * bare idstrings are kept, so the node round-trips to canonical form without
 * duplicating the grammar.
 *
 * @public
 */
export class LicenseRefNode extends Schema.TaggedClass<LicenseRefNode>()("LicenseRef", {
	/** The `DocumentRef-` idstring when the reference is document-scoped; absent otherwise. */
	documentRef: Schema.optionalKey(Schema.String),
	/** The `LicenseRef-` idstring. */
	ref: Schema.String,
}) {
	/** The canonical string form, re-attaching the `DocumentRef-…:` prefix when present. */
	override toString(): string {
		const prefix = this.documentRef !== undefined ? `DocumentRef-${this.documentRef}:` : "";
		return `${prefix}LicenseRef-${this.ref}`;
	}
}

/**
 * A `license WITH exception` node. Per the SPDX order of precedence, `WITH`
 * binds only to a simple license (never a reference or a compound expression),
 * so {@link WithExceptionNode.license} is always a {@link LicenseNode}.
 *
 * @public
 */
export class WithExceptionNode extends Schema.TaggedClass<WithExceptionNode>()("WithException", {
	/** The license the exception applies to, which may itself carry the `+` marker. */
	license: LicenseNode,
	/** The SPDX exception short identifier, e.g. `"Bison-exception-2.2"`. */
	exception: Schema.String,
}) {
	/** The canonical string form: the license, then `WITH`, then the exception id. */
	override toString(): string {
		return `${this.license.toString()} WITH ${this.exception}`;
	}
}

/**
 * The conjunction (`AND`) of two sub-expressions. Recursive: its children are
 * any {@link SpdxExpression}, expressed via `Schema.suspend`.
 *
 * @public
 */
export class AndNode extends Schema.TaggedClass<AndNode>()("And", {
	/** The left operand. */
	left: Schema.suspend((): Schema.Codec<SpdxExpression> => SpdxExpressionUnion),
	/** The right operand. */
	right: Schema.suspend((): Schema.Codec<SpdxExpression> => SpdxExpressionUnion),
}) {
	/** The canonical, fully-parenthesized string form `(left AND right)`. */
	override toString(): string {
		return `(${this.left.toString()} AND ${this.right.toString()})`;
	}
}

/**
 * The disjunction (`OR`) of two sub-expressions. Recursive: its children are
 * any {@link SpdxExpression}, expressed via `Schema.suspend`.
 *
 * @public
 */
export class OrNode extends Schema.TaggedClass<OrNode>()("Or", {
	/** The left operand. */
	left: Schema.suspend((): Schema.Codec<SpdxExpression> => SpdxExpressionUnion),
	/** The right operand. */
	right: Schema.suspend((): Schema.Codec<SpdxExpression> => SpdxExpressionUnion),
}) {
	/** The canonical, fully-parenthesized string form `(left OR right)`. */
	override toString(): string {
		return `(${this.left.toString()} OR ${this.right.toString()})`;
	}
}

/**
 * The SPDX license-expression AST: a simple license, a reference, a
 * `WITH`-exception, or an `AND`/`OR` compound. The five variants form a
 * discriminated union on `_tag`.
 *
 * @public
 */
export type SpdxExpression = LicenseNode | LicenseRefNode | WithExceptionNode | AndNode | OrNode;

// The union schema. Declared after the member classes it names, and referenced
// from `AndNode`/`OrNode` only through a `Schema.suspend` thunk, so no member's
// static initializer touches it before it is defined.
const SpdxExpressionUnion = Schema.Union([LicenseNode, LicenseRefNode, WithExceptionNode, AndNode, OrNode]);

// Materialize the parser's raw record tree into the typed AST. Recursive, but
// only over a tree the parser already bounded to MAX_NESTING_DEPTH, so it
// cannot overflow. `.make` validates each node; construction is linear in the
// node count on this Schema class family.
function materialize(raw: RawExpression): SpdxExpression {
	switch (raw.kind) {
		case "license":
			return LicenseNode.make({ id: raw.id, plus: raw.plus });
		case "licenseRef":
			// Conditional spread — never pass an explicit `undefined` for the
			// `optionalKey` documentRef field.
			return LicenseRefNode.make(
				raw.documentRef !== undefined ? { documentRef: raw.documentRef, ref: raw.ref } : { ref: raw.ref },
			);
		case "with":
			return WithExceptionNode.make({
				license: LicenseNode.make({ id: raw.license.id, plus: raw.license.plus }),
				exception: raw.exception,
			});
		case "and":
			return AndNode.make({ left: materialize(raw.left), right: materialize(raw.right) });
		case "or":
			return OrNode.make({ left: materialize(raw.left), right: materialize(raw.right) });
	}
}

/**
 * Validate and parse an SPDX license expression synchronously, returning a
 * `Result`. This is the package's sync primitive: {@link isValidExpression},
 * the Effect {@link SpdxExpression.parse}, and {@link SpdxExpression.FromString}
 * all derive from it, so the four surfaces can never disagree.
 *
 * Every malformation — a bad token, an unbalanced parenthesis, a dangling
 * `AND`/`OR`, an unknown identifier or exception, or nesting past the parser's
 * depth cap — fails with {@link InvalidSpdxExpressionError} on the failure
 * channel; the parser never throws.
 */
function parseResult(input: string): Result.Result<SpdxExpression, InvalidSpdxExpressionError> {
	const raw = parseRaw(input);
	return raw === undefined ? Result.fail(new InvalidSpdxExpressionError({ input })) : Result.succeed(materialize(raw));
}

/**
 * Whether `input` is a syntactically and catalog-valid SPDX license expression.
 * The synchronous, allocation-light predicate for non-Effect callers (lint
 * hooks, config-time checks); it shares its engine with
 * {@link SpdxExpression.parse}, so a `true` here guarantees a successful parse.
 *
 * @example
 * ```ts
 * import { isValidExpression } from "@effected/spdx";
 *
 * console.log(isValidExpression("(MIT OR Apache-2.0)"));
 * // => true
 * console.log(isValidExpression("MIT AND"));
 * // => false
 * ```
 *
 * @param input - the candidate SPDX expression
 * @returns `true` when `input` parses, `false` otherwise
 * @public
 */
export function isValidExpression(input: string): boolean {
	return Result.isSuccess(parseResult(input));
}

const parseEffect = Effect.fn("SpdxExpression.parse")((input: string) => Effect.fromResult(parseResult(input)));

const FromString: Schema.Codec<SpdxExpression, string> = Schema.String.pipe(
	Schema.decodeTo(
		SpdxExpressionUnion,
		SchemaTransformation.transformOrFail({
			decode: (input: string) => {
				const result = parseResult(input);
				return Result.isSuccess(result)
					? Effect.succeed(result.success)
					: Effect.fail(new SchemaIssue.InvalidValue(Option.some(input), { message: result.failure.message }));
			},
			encode: (expression: SpdxExpression) => Effect.succeed(expression.toString()),
		}),
	),
);

/**
 * The SPDX license-expression facade: the AST union schema plus the parse,
 * validate and codec entry points. The `SpdxExpression` name is both the AST
 * type (above) and this value namespace.
 *
 * @public
 */
export const SpdxExpression = {
	/**
	 * The recursive tagged-union `Schema` for the AST.
	 *
	 * @remarks
	 * The `MAX_NESTING_DEPTH` cap guards STRING parsing only (via {@link SpdxExpression.parse}
	 * and {@link SpdxExpression.FromString}); decoding an already-built POJO directly through
	 * this raw `Schema` is not depth-capped.
	 */
	Schema: SpdxExpressionUnion,
	/**
	 * A `Schema.Codec` from a raw expression string to the AST and back. Decoding
	 * runs the hardened parser; encoding emits the canonical, fully-parenthesized
	 * string via each node's `toString`.
	 */
	FromString,
	/**
	 * Parse an SPDX license expression, failing with
	 * {@link InvalidSpdxExpressionError} on any malformed or unknown input.
	 * Derived from {@link SpdxExpression.parseResult} behind the
	 * `SpdxExpression.parse` span, so the Effect and sync forms cannot drift.
	 */
	parse: parseEffect,
	/**
	 * The synchronous `Result`-returning parser — the single source of truth the
	 * Effect {@link SpdxExpression.parse} and {@link isValidExpression} derive
	 * from. Reach for it at synchronous boundaries.
	 */
	parseResult,
} as const;
