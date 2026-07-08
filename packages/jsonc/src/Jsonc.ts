// The `Jsonc` facade: parsing, comment stripping, semantic equality and the
// flagship schema factories, plus the parse-error vocabulary they raise.
//
// `Jsonc` is a namespace of statics over the internal parser and the schema
// layer — not itself a schema class. Per the package Effect-wrapping policy,
// `parse`/`parseTree` and schema decoding carry a real `JsoncParseError`
// channel; `stripComments`/`equals`/`equalsValue` are pure total functions.
//
// Cycle firewall: the internal parser returns raw error records
// (`{ code, offset, length }`) and this module maps them into
// `JsoncParseErrorDetail` — deriving `line`/`character` from `offset` — and
// builds the aggregate `JsoncParseError`. The dependency edge runs facade →
// parser only, so `noImportCycles` stays satisfied.

import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import type { ParseFlags, RawParseError } from "./internal/parser.js";
import {
	JSONC_PARSE_ERROR_CODES,
	parseTree as parseTreeInternal,
	parseValue as parseValueInternal,
} from "./internal/parser.js";
import type { SyntaxKind } from "./internal/scanner.js";
import { createScanner } from "./internal/scanner.js";
import { JsoncNode } from "./JsoncNode.js";

/**
 * The single public parse-error code vocabulary, appearing as the `code` field
 * of {@link JsoncParseErrorDetail}.
 *
 * @public
 */
export const JsoncParseErrorCode = Schema.Literals(JSONC_PARSE_ERROR_CODES);

/**
 * The union of all JSONC parse-error code string literals.
 *
 * @public
 */
export type JsoncParseErrorCode = typeof JsoncParseErrorCode.Type;

/**
 * One recovered parse error: its `JsoncParseErrorCode` and its exact
 * position (`offset`/`length`, plus zero-based `line`/`character`). A single
 * {@link JsoncParseError} reports a batch of these.
 *
 * @public
 */
export class JsoncParseErrorDetail extends Schema.Class<JsoncParseErrorDetail>("JsoncParseErrorDetail")({
	code: JsoncParseErrorCode,
	offset: Schema.Number,
	length: Schema.Number,
	line: Schema.Number,
	character: Schema.Number,
}) {}

/**
 * Error-recovery parse failure: aggregates every {@link JsoncParseErrorDetail}
 * encountered, so a single failure reports the whole batch. Raised by
 * {@link Jsonc.parse}, {@link Jsonc.parseTree} and the decode direction of the
 * schema factories.
 *
 * @public
 */
export class JsoncParseError extends Schema.TaggedErrorClass<JsoncParseError>()("JsoncParseError", {
	errors: Schema.Array(JsoncParseErrorDetail),
	input: Schema.String,
}) {
	override get message(): string {
		const count = this.errors.length;
		const summary = this.errors.map((e) => `${e.code} at ${e.line}:${e.character}`).join("; ");
		return `JSONC parse failed with ${count} error${count === 1 ? "" : "s"}: ${summary}`;
	}
}

/**
 * Options controlling parse behavior. All fields are omissible.
 *
 * - `disallowComments` — reject line and block comments as a parse error
 *   instead of the JSONC default of allowing them. Defaults to `false`.
 * - `allowTrailingComma` — accept a trailing comma before a closing `}`/`]`.
 *   Defaults to `true` — the deliberate JSONC-convention default, differing
 *   from Microsoft's parser (which defaults to `false`).
 * - `allowEmptyContent` — treat empty or whitespace/comment-only input as
 *   valid, yielding `Option.none()` from {@link Jsonc.parseTree} instead of a
 *   `ValueExpected` parse error. Defaults to `false`.
 *
 * @public
 */
export class JsoncParseOptions extends Schema.Class<JsoncParseOptions>("JsoncParseOptions")({
	disallowComments: Schema.optionalKey(Schema.Boolean),
	allowTrailingComma: Schema.optionalKey(Schema.Boolean),
	allowEmptyContent: Schema.optionalKey(Schema.Boolean),
}) {}

// ── Internal helpers ────────────────────────────────────────────────────────

const toFlags = (options?: JsoncParseOptions): ParseFlags =>
	options === undefined
		? {}
		: {
				disallowComments: options.disallowComments,
				allowTrailingComma: options.allowTrailingComma,
				allowEmptyContent: options.allowEmptyContent,
			};

const lineChar = (text: string, offset: number): { line: number; character: number } => {
	let line = 0;
	let lineStart = 0;
	const limit = Math.min(offset, text.length);
	for (let i = 0; i < limit; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 0x0a) {
			line++;
			lineStart = i + 1;
		} else if (ch === 0x0d) {
			if (i + 1 < text.length && text.charCodeAt(i + 1) === 0x0a) {
				i++;
			}
			line++;
			lineStart = i + 1;
		} else if (ch === 0x2028 || ch === 0x2029) {
			// LS/PS count as line breaks in the scanner; stay aligned so error
			// positions after them are correct.
			line++;
			lineStart = i + 1;
		}
	}
	return { line, character: offset - lineStart };
};

const toDetails = (text: string, errors: ReadonlyArray<RawParseError>): ReadonlyArray<JsoncParseErrorDetail> =>
	errors.map((e) => {
		const { line, character } = lineChar(text, e.offset);
		return JsoncParseErrorDetail.make({ code: e.code, offset: e.offset, length: e.length, line, character });
	});

const deepEqual = (a: unknown, b: unknown, depth = 0): boolean => {
	if (a === b) return true;
	// Over-deep comparison (reachable via `equalsValue`, whose `value` side is
	// an arbitrary caller-supplied structure): treat as unequal rather than
	// recursing past the cap and overflowing the stack as a defect. Values
	// produced by the parser are already bounded to the same depth.
	if (depth >= MAX_NESTING_DEPTH) return false;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;

	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i], depth + 1)) return false;
		}
		return true;
	}
	if (Array.isArray(b)) return false;

	if (typeof a === "object" && typeof b === "object") {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const aKeys = Object.keys(aObj);
		const bKeys = Object.keys(bObj);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (!Object.hasOwn(bObj, key) || !deepEqual(aObj[key], bObj[key], depth + 1)) return false;
		}
		return true;
	}

	return false;
};

// ── Facade ──────────────────────────────────────────────────────────────────

/**
 * Static entry points for JSONC parsing, editing-adjacent utilities and the
 * schema factories. Not instantiable.
 *
 * @example
 * ```ts
 * import { Jsonc } from "@effected/jsonc";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* Jsonc.parse('{ "port": 3000 // dev\n }');
 *   return value; // { port: 3000 }
 * });
 * ```
 *
 * @public
 */
export class Jsonc {
	private constructor() {}

	/**
	 * Parse JSONC into a plain JavaScript value. Error-recovery parsing:
	 * collects every parse error and fails once with the aggregate
	 * {@link JsoncParseError}. Returns `unknown`, never `any`.
	 *
	 * @param text - The JSONC source to parse.
	 * @param options - Optional {@link JsoncParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns An `Effect` that succeeds with the decoded value, or fails with
	 *   the aggregate {@link JsoncParseError}.
	 */
	static readonly parse = Effect.fn("Jsonc.parse")(function* (text: string, options?: JsoncParseOptions) {
		const { value, errors } = parseValueInternal(text, toFlags(options));
		if (errors.length > 0) {
			return yield* new JsoncParseError({ errors: toDetails(text, errors), input: text });
		}
		return value;
	});

	/**
	 * Parse JSONC into an immutable {@link JsoncNode} AST. `Option.none()` for
	 * empty input (with `allowEmptyContent`); the aggregate
	 * {@link JsoncParseError} for malformed input.
	 *
	 * @param text - The JSONC source to parse.
	 * @param options - Optional {@link JsoncParseOptions}; defaults apply for
	 *   omitted fields.
	 * @returns An `Effect` that succeeds with `Option.some(root)` (or
	 *   `Option.none()` for empty input), or fails with the aggregate
	 *   {@link JsoncParseError}.
	 */
	static readonly parseTree = Effect.fn("Jsonc.parseTree")(function* (text: string, options?: JsoncParseOptions) {
		const { root, errors } = parseTreeInternal(text, toFlags(options));
		if (errors.length > 0) {
			return yield* new JsoncParseError({ errors: toDetails(text, errors), input: text });
		}
		return root !== undefined ? Option.some(root) : Option.none();
	});

	/**
	 * Remove all comments from JSONC, producing valid JSON. Pass a `replaceCh`
	 * (e.g. `" "`) to replace each comment character instead of deleting it,
	 * keeping all offsets stable (line breaks inside block comments are kept).
	 * Pure and total.
	 *
	 * @param text - The JSONC source to strip.
	 * @param replaceCh - Optional single character replacing each stripped
	 *   comment character (offset-preserving); when omitted, comments are
	 *   deleted outright and offsets shift.
	 * @returns The comment-free text.
	 */
	static stripComments(text: string, replaceCh?: string): string {
		const scanner = createScanner(text);
		const parts: string[] = [];
		let lastOffset = 0;
		let kind: SyntaxKind;

		do {
			kind = scanner.scan();
			const offset = scanner.getTokenOffset();
			const length = scanner.getTokenLength();

			if (kind === "LineComment" || kind === "BlockComment") {
				if (lastOffset < offset) {
					parts.push(text.substring(lastOffset, offset));
				}
				if (replaceCh !== undefined) {
					for (let i = 0; i < length; i++) {
						const ch = text.charCodeAt(offset + i);
						parts.push(ch === 0x0a || ch === 0x0d ? text[offset + i] : replaceCh);
					}
				}
				lastOffset = offset + length;
			}
		} while (kind !== "EOF");

		if (lastOffset < text.length) {
			parts.push(text.substring(lastOffset));
		}

		return parts.join("");
	}

	/**
	 * Compare two JSONC strings for semantic equality: comments, whitespace,
	 * formatting and object key order are ignored; array order is significant.
	 * Malformed input is never equal to anything — parse errors on either side
	 * yield `false` rather than comparing recovery-parser artifacts. Pure and
	 * total.
	 *
	 * @param a - The first JSONC source.
	 * @param b - The second JSONC source.
	 * @returns `true` when `a` and `b` decode to structurally equal values.
	 */
	static equals(a: string, b: string): boolean {
		const ra = parseValueInternal(a, {});
		const rb = parseValueInternal(b, {});
		if (ra.errors.length > 0 || rb.errors.length > 0) {
			return false;
		}
		return deepEqual(ra.value, rb.value);
	}

	/**
	 * Compare a JSONC string against an existing JavaScript value with the same
	 * semantics as {@link Jsonc.equals}: malformed `text` yields `false`. Pure
	 * and total.
	 *
	 * @param text - The JSONC source to decode and compare.
	 * @param value - The plain JavaScript value to compare against.
	 * @returns `true` when `text` decodes to a value structurally equal to
	 *   `value`.
	 */
	static equalsValue(text: string, value: unknown): boolean {
		const r = parseValueInternal(text, {});
		if (r.errors.length > 0) {
			return false;
		}
		return deepEqual(r.value, value);
	}

	/**
	 * A `Schema<unknown, string>` decoding JSONC with the given `options`
	 * (defaults when omitted). Encoding is `JSON.stringify` with 2-space indent,
	 * so comments do not survive a round-trip encode.
	 *
	 * @remarks
	 * Schema-producing: each call returns a fresh schema whose derivation caches
	 * are not shared across calls. Bind the result to a `const` on hot paths;
	 * for the default-options case use {@link Jsonc.JsoncFromString}.
	 *
	 * @param options - Optional {@link JsoncParseOptions} controlling the
	 *   decode direction.
	 * @returns A codec decoding JSONC `string` to `unknown`, failing the decode
	 *   direction with the aggregate {@link JsoncParseError} wrapped as a
	 *   schema issue.
	 */
	static fromString(options?: JsoncParseOptions): Schema.Codec<unknown, string> {
		const flags = toFlags(options);
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.Unknown,
				SchemaTransformation.transformOrFail({
					decode: (input: string) => {
						const { value, errors } = parseValueInternal(input, flags);
						if (errors.length > 0) {
							const aggregate = new JsoncParseError({ errors: toDetails(input, errors), input });
							return Effect.fail(new SchemaIssue.InvalidValue(Option.some(input), { message: aggregate.message }));
						}
						return Effect.succeed(value);
					},
					encode: (value: unknown) => Effect.succeed(JSON.stringify(value, null, 2)),
				}),
			),
		);
	}

	/**
	 * The zero-config `Schema<unknown, string>` — `Jsonc.fromString()` with
	 * default options, pre-bound so the common case needs no memoization
	 * discipline.
	 */
	static readonly JsoncFromString: Schema.Codec<unknown, string> = Jsonc.fromString();

	/**
	 * Compose {@link Jsonc.fromString} with a target schema, yielding a
	 * `Schema<A, string>` that decodes JSONC straight into a validated domain
	 * value — the reason an Effect-native JSONC library exists.
	 *
	 * @remarks
	 * Schema-producing: bind the result to a `const` on hot paths (see
	 * {@link Jsonc.fromString}).
	 *
	 * @param target - The domain schema decoded values must satisfy.
	 * @param options - Optional {@link JsoncParseOptions} controlling the JSONC
	 *   decode step.
	 * @returns A codec decoding a JSONC `string` straight into `T`.
	 */
	static schema<T, E>(target: Schema.Codec<T, E>, options?: JsoncParseOptions): Schema.Codec<T, string> {
		// The double-cast is sound: `fromString` decodes to `Schema.Unknown`, whose
		// decoded type is `unknown` — precisely the decode-input any `target` codec
		// accepts. Re-typing `target`'s Encoded from `E` to `unknown` lets the two
		// compose; the resulting codec decodes `string -> T`, which the outer cast
		// restates. The runtime is untouched — only the Encoded type parameter is
		// widened, and `Schema.Unknown` accepts every value at runtime.
		return Jsonc.fromString(options).pipe(
			Schema.decodeTo(target as unknown as Schema.Codec<T, unknown>),
		) as unknown as Schema.Codec<T, string>;
	}
}
