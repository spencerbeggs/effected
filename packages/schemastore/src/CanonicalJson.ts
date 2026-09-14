import { Effect, Result, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";

/**
 * Indicates that a value reachable from the serialization input is not a
 * JSON value: `undefined`, a function, a symbol, a `bigint`, a non-finite
 * number, or an object that is neither an array nor a plain object.
 *
 * Raised by {@link CanonicalJson.serialize}. Unlike `JSON.stringify` — which
 * silently drops `undefined` members and rewrites `NaN`/`Infinity` to
 * `null` — canonical serialization refuses to alter the document, so every
 * non-JSON value is a typed failure carrying the path to fix.
 *
 * @public
 */
export class NonJsonValueError extends Schema.TaggedError<NonJsonValueError>()("NonJsonValueError", {
	/** JSON pointer to the offending value (`""` is the document root). */
	path: Schema.String,
	/** The `typeof`/structural description of the rejected value. */
	found: Schema.String,
}) {
	override get message(): string {
		return `Non-JSON value (${this.found}) at "${this.path}"`;
	}
}

/**
 * Indicates that the serialization input nests deeper than the package's
 * hardening cap (256 levels), which also intercepts cyclic values before
 * they can recurse forever.
 *
 * Raised by {@link CanonicalJson.serialize}.
 *
 * @public
 */
export class JsonDepthExceededError extends Schema.TaggedError<JsonDepthExceededError>()("JsonDepthExceededError", {
	/** JSON pointer to the node where the cap was hit. */
	path: Schema.String,
	/** The nesting cap that was exceeded. */
	maxDepth: Schema.Number,
}) {
	override get message(): string {
		return `JSON nesting exceeds ${this.maxDepth} levels at "${this.path}"`;
	}
}

/**
 * Union of the failures {@link CanonicalJson.serialize} can raise.
 *
 * @public
 */
export type CanonicalJsonError = NonJsonValueError | JsonDepthExceededError;

/**
 * Options for {@link CanonicalJson.serialize}.
 *
 * @public
 */
export interface CanonicalJsonOptions {
	/**
	 * Indentation unit: `"tab"` (the default, matching the repo formatter
	 * convention the extraction source committed its files under) or a
	 * space count — a non-negative integer (`0` emits multi-line output
	 * with no leading indentation). Counts above 10 are honored as given,
	 * deliberately diverging from `JSON.stringify`'s silent clamp to 10.
	 * A negative or fractional count is a wiring mistake and throws (the
	 * serializer alters nothing silently — not even its own options).
	 */
	readonly indent?: "tab" | number;
}

// Internal throw carrier so the single recursive emitter can surface either
// typed error from arbitrary depth without threading Results through the walk.
class SerializeFailure {
	constructor(readonly error: CanonicalJsonError) {}
}

const escapePointerSegment = (segment: string): string => segment.replace(/~/g, "~0").replace(/\//g, "~1");

// A stack guard for content equality, deliberately looser than the
// structural cap: `MAX_NESTING_DEPTH` bounds how deep a walk keeps
// CLASSIFYING, while this only stops the comparison from overflowing the
// stack on hostile (or cyclic) input. Sharing one budget with `DocumentDiff`'s
// structural walk once made a deeply-nested but identical document compare
// as different, because the fallback ran out of frames before the leaves.
const EQUALITY_STACK_GUARD = MAX_NESTING_DEPTH * 8;

// Mirrors `emit`'s own prototype check so a value the serializer would
// reject as "non-plain object" falls through to the `a === b` reference
// check in `contentEqual` instead of being treated as a comparable record —
// otherwise two distinct `Date`s (or any other non-plain object) with the
// same enumerable own keys would report equal under `equals`.
const isPlainRecord = (node: unknown): node is Record<string, unknown> => {
	if (typeof node !== "object" || node === null || Array.isArray(node)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(node);
	return prototype === Object.prototype || prototype === null;
};

// Order-insensitive for object keys, order-sensitive for arrays — key order
// is a serialization detail (a formatter may sort), element order is data.
// Past the stack guard, unequal-by-reference is reported as different,
// which is the conservative direction.
const contentEqual = (a: unknown, b: unknown, depth: number): boolean => {
	if (a === b) {
		return true;
	}
	if (depth >= EQUALITY_STACK_GUARD) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((element, index) => contentEqual(element, b[index], depth + 1));
	}
	if (!isPlainRecord(a) || !isPlainRecord(b)) {
		// Primitives that failed `===` (including NaN, and null vs object).
		return false;
	}
	const aKeys = Object.keys(a);
	if (aKeys.length !== Object.keys(b).length) {
		return false;
	}
	return aKeys.every((key) => Object.hasOwn(b, key) && contentEqual(a[key], b[key], depth + 1));
};

/**
 * Deterministic, canonical JSON text: the package's owned serializer, so a
 * consumer never shells out to an external formatter to produce a stable
 * committed schema file.
 *
 * The canonical form is fully specified: object keys in insertion order
 * (document assembly owns meaningful ordering — keys are never sorted),
 * every array element and object member on its own line, the configured
 * indent (tab by default), `"` string escaping exactly as `JSON.stringify`
 * produces it, LF line endings and a single trailing newline. Equal inputs
 * serialize to equal bytes.
 *
 * Values that are not JSON fail typed rather than being silently rewritten
 * (see {@link NonJsonValueError}); nesting past the hardening cap — which
 * includes cyclic values — fails with {@link JsonDepthExceededError}.
 *
 * @public
 */
export class CanonicalJson {
	private constructor() {}

	/**
	 * Serializes `value` to canonical JSON text. Pure and synchronous — the
	 * primitive form; {@link CanonicalJson.serialize} is the same engine
	 * behind a span.
	 */
	static serializeResult(value: unknown, options?: CanonicalJsonOptions): Result.Result<string, CanonicalJsonError> {
		const unit = options?.indent === undefined || options.indent === "tab" ? "\t" : indentUnit(options.indent);
		try {
			return Result.succeed(`${emit(value, "", 0, unit)}\n`);
		} catch (cause) {
			if (cause instanceof SerializeFailure) {
				return Result.fail(cause.error);
			}
			throw cause;
		}
	}

	/**
	 * Effect form of {@link CanonicalJson.serializeResult}, adding only the
	 * `CanonicalJson.serialize` span. Defined in terms of the `Result`
	 * primitive — synchronous callers can use that variant directly.
	 */
	static readonly serialize = Effect.fn("CanonicalJson.serialize")(
		(value: unknown, options?: CanonicalJsonOptions): Effect.Effect<string, CanonicalJsonError> =>
			Effect.fromResult(CanonicalJson.serializeResult(value, options)),
	);

	/**
	 * Content equality under the serializer's own semantics: two values are
	 * equal when they would parse to the same JSON document — object key
	 * order is a serialization detail and is ignored, array order is data
	 * and is not. `NaN` is never equal to itself (it is not JSON). Total:
	 * a cyclic or hostile-depth value reports `false` rather than
	 * overflowing.
	 *
	 * This is the comparison `SchemaFile`'s write-if-changed and
	 * `DocumentDiff`'s leaf comparison already make, exported so a consumer
	 * writing its own JSON artifact (a catalog entry) can decide "unchanged"
	 * by the same rule instead of re-implementing it.
	 */
	static equals(left: unknown, right: unknown): boolean {
		return contentEqual(left, right, 0);
	}
}

// A numeric indent must be a non-negative integer: `" ".repeat` throws a
// bare RangeError on negatives and silently floors fractions — both are
// wiring mistakes (an option, not document data), so they throw with a
// message naming the contract rather than failing typed or being rewritten.
const indentUnit = (indent: number): string => {
	if (!Number.isInteger(indent) || indent < 0) {
		throw new Error(`indent must be "tab" or a non-negative integer space count, got ${indent}`);
	}
	return " ".repeat(indent);
};

const emit = (value: unknown, path: string, depth: number, unit: string): string => {
	if (value === null) {
		return "null";
	}
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "number": {
			if (!Number.isFinite(value)) {
				throw new SerializeFailure(NonJsonValueError.make({ path, found: String(value) }));
			}
			return JSON.stringify(value);
		}
		case "string":
			return JSON.stringify(value);
		case "object":
			break;
		default:
			throw new SerializeFailure(NonJsonValueError.make({ path, found: typeof value }));
	}
	if (depth >= MAX_NESTING_DEPTH) {
		throw new SerializeFailure(JsonDepthExceededError.make({ path, maxDepth: MAX_NESTING_DEPTH }));
	}
	const indent = unit.repeat(depth + 1);
	const closing = unit.repeat(depth);
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return "[]";
		}
		const items = value.map((item, index) => `${indent}${emit(item, `${path}/${index}`, depth + 1, unit)}`);
		return `[\n${items.join(",\n")}\n${closing}]`;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new SerializeFailure(NonJsonValueError.make({ path, found: "non-plain object" }));
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) {
		return "{}";
	}
	const members = entries.map(
		([key, member]) =>
			`${indent}${JSON.stringify(key)}: ${emit(member, `${path}/${escapePointerSegment(key)}`, depth + 1, unit)}`,
	);
	return `{\n${members.join(",\n")}\n${closing}}`;
};
