import { Data, Effect, Option, Result, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
/**
 * A single path segment: a `string` for object property keys or a `number`
 * for array indices.
 *
 * @public
 */
type JsoncSegment = string | number;
/**
 * An ordered sequence of {@link JsoncSegment} values describing a location
 * within a JSONC document tree.
 *
 * @public
 */
type JsoncPath = ReadonlyArray<JsoncSegment>;
/**
 * Discriminator values for JSONC AST node types: the JSON value types
 * (`string`/`number`/`boolean`/`null`), the structural types
 * (`object`/`array`) and the `property` key-value pair type.
 *
 * @public
 */
export declare const JsoncNodeType: Schema.Literals<readonly ["object", "array", "property", "string", "number", "boolean", "null"]>;
/**
 * The union of all JSONC AST node type string literals.
 *
 * @public
 */
export type JsoncNodeType = typeof JsoncNodeType.Type;
declare const JsoncNode_base: Schema.Class<JsoncNode, Schema.Struct<{
  readonly type: Schema.Literals<readonly ["object", "array", "property", "string", "number", "boolean", "null"]>;
  readonly offset: Schema.Number;
  readonly length: Schema.Number;
  readonly value: Schema.optionalKey<Schema.Unknown>;
  readonly colonOffset: Schema.optionalKey<Schema.Number>;
  readonly children: Schema.optionalKey<Schema.$Array<Schema.suspend<Schema.Schema<JsoncNode>>>>;
}>, {}>;
/**
 * An immutable JSONC AST node produced by `Jsonc.parseTree`.
 *
 * The `parent` field present in Microsoft's `jsonc-parser` is intentionally
 * omitted: circular references would break structural equality, serialization
 * and Schema encode/decode. Child relationships are expressed via `children`,
 * and the recursive type is handled with `Schema.suspend`.
 *
 * - `type` — the `JsoncNodeType` discriminator.
 * - `offset` / `length` — the node's span in the source (tight token-end
 *   discipline: spans never swallow trailing whitespace or comments).
 * - `value` — the decoded JS value for leaf nodes; omitted for structural nodes.
 * - `colonOffset` — for `property` nodes, the offset of the `:` separator.
 * - `children` — child nodes for `object`, `array` and `property` nodes.
 *
 * Construct via `JsoncNode.make(...)`, never `new JsoncNode(...)`.
 *
 * @public
 */
export declare class JsoncNode extends JsoncNode_base {
  /**
   * Find a descendant node by path. String segments navigate object
   * properties; number segments navigate array indices. Returns
   * `Option.none()` when any segment cannot be resolved. Pure.
   *
   * @param path - The path to resolve, relative to this node.
   * @returns The descendant node, or `Option.none()` when `path` cannot be
   *   resolved.
   */
  find(path: JsoncPath): Option.Option<JsoncNode>;
  /**
   * Find the innermost node whose span covers `offset`, or `Option.none()`
   * if the offset is outside this subtree. Pure.
   *
   * @param offset - The zero-based character offset to locate.
   * @returns The innermost covering node, or `Option.none()` when `offset`
   *   falls outside this subtree.
   */
  findAtOffset(offset: number): Option.Option<JsoncNode>;
  /**
   * Return the JSON path to the innermost node covering `offset`, or
   * `Option.none()` if the offset is outside this subtree. The inverse of
   * {@link JsoncNode.find}. Pure.
   *
   * @param offset - The zero-based character offset to locate.
   * @returns The path to the innermost covering node, or `Option.none()`
   *   when `offset` falls outside this subtree.
   */
  pathAt(offset: number): Option.Option<JsoncPath>;
  /**
   * Reconstruct the plain JavaScript value represented by this subtree. Pure
   * and total — never fails, so no `Effect` wrapper.
   *
   * @returns The plain JavaScript value (object, array, string, number,
   *   boolean or `null`) this subtree represents.
   */
  toValue(): unknown;
}
/**
 * The single public parse-error code vocabulary, appearing as the `code` field
 * of {@link JsoncParseErrorDetail}.
 *
 * @public
 */
export declare const JsoncParseErrorCode: Schema.Literals<readonly ["InvalidSymbol", "InvalidNumberFormat", "PropertyNameExpected", "ValueExpected", "ColonExpected", "CommaExpected", "CloseBraceExpected", "CloseBracketExpected", "EndOfFileExpected", "InvalidCommentToken", "UnexpectedEndOfComment", "UnexpectedEndOfString", "UnexpectedEndOfNumber", "InvalidUnicode", "InvalidEscapeCharacter", "InvalidCharacter", "NestingDepthExceeded"]>;
/**
 * The union of all JSONC parse-error code string literals.
 *
 * @public
 */
export type JsoncParseErrorCode = typeof JsoncParseErrorCode.Type;
declare const JsoncParseErrorDetail_base: Schema.Class<JsoncParseErrorDetail, Schema.Struct<{
  readonly code: Schema.Literals<readonly ["InvalidSymbol", "InvalidNumberFormat", "PropertyNameExpected", "ValueExpected", "ColonExpected", "CommaExpected", "CloseBraceExpected", "CloseBracketExpected", "EndOfFileExpected", "InvalidCommentToken", "UnexpectedEndOfComment", "UnexpectedEndOfString", "UnexpectedEndOfNumber", "InvalidUnicode", "InvalidEscapeCharacter", "InvalidCharacter", "NestingDepthExceeded"]>;
  readonly offset: Schema.Number;
  readonly length: Schema.Number;
  readonly line: Schema.Number;
  readonly character: Schema.Number;
}>, {}>;
/**
 * One recovered parse error: its `JsoncParseErrorCode` and its exact
 * position (`offset`/`length`, plus zero-based `line`/`character`). A single
 * {@link JsoncParseError} reports a batch of these.
 *
 * @remarks
 * Structurally a `SourceLocation` from `@effected/source`, so a consumer
 * written over that interface (an LSP server, a CLI printing annotations)
 * reads it directly. It carries no `message`, so it is not a
 * `SourceDiagnostic`: the aggregate {@link JsoncParseError} owns the
 * human-readable text.
 *
 * `line` and `character` come from `@effected/source`'s `LineIndex` under its
 * `"unicode"` rule: a line ends at `\n`, `\r\n`, a bare `\r`, U+2028 LINE
 * SEPARATOR or U+2029 PARAGRAPH SEPARATOR. Counting the two separators is
 * deliberate, for parity with VS Code's `jsonc-parser`, whose scanner this
 * package ports and which treats them as line breaks. An LSP client does not,
 * so after a separator a position here sits one line below where an editor
 * shows it; a consumer needing LSP positions rebuilds them from `offset` with
 * a default `LineIndex`. An offset at the `\n` of a `\r\n` reads as the end of
 * its line.
 *
 * @public
 */
export declare class JsoncParseErrorDetail extends JsoncParseErrorDetail_base {}
declare const JsoncParseError_base: Schema.Class<JsoncParseError, Schema.TaggedStruct<"JsoncParseError", {
  readonly errors: Schema.$Array<typeof JsoncParseErrorDetail>;
  readonly input: Schema.String;
}>, import("effect/Cause").YieldableError>;
/**
 * Error-recovery parse failure: aggregates every {@link JsoncParseErrorDetail}
 * encountered, so a single failure reports the whole batch. Raised by
 * {@link Jsonc.parse}, {@link Jsonc.parseTree} and the decode direction of the
 * schema factories.
 *
 * @remarks
 * The `message` renders each detail's position 1-based
 * (`line + 1:character + 1`) for human readers — a CLI printing this string
 * shows the line/column a person counts in their editor. The structured
 * {@link JsoncParseErrorDetail} `line`/`character` fields stay 0-based (LSP
 * convention); the offset applies to the rendered message only.
 *
 * @public
 */
export declare class JsoncParseError extends JsoncParseError_base {
  get message(): string;
}
declare const JsoncParseOptions_base: Schema.Class<JsoncParseOptions, Schema.Struct<{
  readonly disallowComments: Schema.optionalKey<Schema.Boolean>;
  readonly allowTrailingComma: Schema.optionalKey<Schema.Boolean>;
  readonly allowEmptyContent: Schema.optionalKey<Schema.Boolean>;
}>, {}>;
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
export declare class JsoncParseOptions extends JsoncParseOptions_base {}
/**
 * The public stringify-error code vocabulary, appearing as the `code` field of
 * {@link JsoncStringifyError}:
 *
 * - `CircularReference` — the value contains a reference cycle, so no finite
 *   JSON text exists for it.
 * - `BigIntValue` — the value contains a `bigint` (anywhere, top-level or
 *   nested), which JSON cannot represent.
 * - `TopLevelUnrepresentable` — the top-level value (`undefined`, a function
 *   or a symbol) serializes to no output at all.
 *
 * @public
 */
export declare const JsoncStringifyErrorCode: Schema.Literals<readonly ["CircularReference", "BigIntValue", "TopLevelUnrepresentable"]>;
/**
 * The union of all JSONC stringify-error code string literals.
 *
 * @public
 */
export type JsoncStringifyErrorCode = typeof JsoncStringifyErrorCode.Type;
declare const JsoncStringifyOptions_base: Schema.Class<JsoncStringifyOptions, Schema.Struct<{
  readonly tabSize: Schema.optionalKey<Schema.Number>;
  readonly insertSpaces: Schema.optionalKey<Schema.Boolean>;
}>, {}>;
/**
 * Options controlling stringify behavior. All fields are omissible; the
 * vocabulary matches `JsoncFormattingOptions`.
 *
 * - `tabSize` — the indent width in spaces when `insertSpaces` is `true`.
 *   Defaults to `2`; `0` produces compact single-line output.
 * - `insertSpaces` — indent with spaces (`tabSize` of them) when `true`, or a
 *   single tab character when `false`. Defaults to `true`.
 *
 * @public
 */
export declare class JsoncStringifyOptions extends JsoncStringifyOptions_base {}
declare const JsoncStringifyError_base: Schema.Class<JsoncStringifyError, Schema.TaggedStruct<"JsoncStringifyError", {
  readonly code: Schema.Literals<readonly ["CircularReference", "BigIntValue", "TopLevelUnrepresentable"]>;
  readonly detail: Schema.String;
  readonly value: Schema.Unknown;
}>, import("effect/Cause").YieldableError>;
/**
 * Stringification failure: a `JsoncStringifyErrorCode` naming the
 * failure mode, a human-readable `detail` (the engine's message for thrown
 * cases — on V8 the circular-reference message includes the offending property
 * path), and the offending `value`. Raised by {@link Jsonc.stringify},
 * {@link Jsonc.stringifyResult} and the encode direction of the schema
 * factories.
 *
 * @public
 */
export declare class JsoncStringifyError extends JsoncStringifyError_base {
  get message(): string;
}
/**
 * A domain codec pre-bound to its two directions, returned by
 * {@link Jsonc.bind}: the composed `schema` (what {@link Jsonc.schema}
 * returns) plus `decode` and `encode` functions derived from it once, so
 * callers need no generic `Schema` machinery at the use site.
 *
 * @public
 */
interface JsoncBoundCodec<T, RD = never, RE = never> {
  /** The composed codec decoding a JSONC `string` straight into `T`. */
  readonly schema: Schema.Codec<T, string, RD, RE>;
  /** Decode JSONC text into a validated `T`. */
  readonly decode: (text: string) => Effect.Effect<T, Schema.SchemaError, RD>;
  /** Encode a `T` back to JSON text (default 2-space indent). */
  readonly encode: (value: T) => Effect.Effect<string, Schema.SchemaError, RE>;
}
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
export declare class Jsonc {
  private constructor();
  /**
   * Parse JSONC into a plain JavaScript value, synchronously, returning a
   * `Result` instead of an `Effect`. Same error-recovery semantics as
   * {@link Jsonc.parse}: every parse error is collected and the failure side
   * carries one aggregate {@link JsoncParseError}. Pure — parsing is
   * fundamentally synchronous, so non-Effect consumers (a plain config
   * loader, a build script) can call this directly instead of wrapping
   * `Effect.runSync(Effect.result(Jsonc.parse(text)))`.
   *
   * @remarks
   * {@link Jsonc.parse} is defined in terms of this function; the two never
   * diverge. Reach for the `Effect` variant inside Effect code — it carries
   * the `Jsonc.parse` tracing span — and for this one at synchronous
   * boundaries.
   *
   * @example
   * ```ts
   * import { Jsonc } from "@effected/jsonc";
   * import { Result } from "effect";
   *
   * const ok = Jsonc.parseResult('{ "port": 3000 // dev\n }');
   * if (Result.isSuccess(ok)) {
   *   console.log(ok.success); // => { port: 3000 }
   * }
   *
   * const bad = Jsonc.parseResult("{ bad }");
   * if (Result.isFailure(bad)) {
   *   console.log(bad.failure._tag); // => "JsoncParseError"
   * }
   * ```
   *
   * @param text - The JSONC source to parse.
   * @param options - Optional {@link JsoncParseOptions}; defaults apply for
   *   omitted fields.
   * @returns A `Result` succeeding with the decoded value (`unknown`, never
   *   `any`), or failing with the aggregate {@link JsoncParseError}.
   */
  static parseResult(text: string, options?: JsoncParseOptions): Result.Result<unknown, JsoncParseError>;
  /**
   * Parse JSONC into a plain JavaScript value. Error-recovery parsing:
   * collects every parse error and fails once with the aggregate
   * {@link JsoncParseError}. Returns `unknown`, never `any`. Defined in terms
   * of {@link Jsonc.parseResult} — synchronous callers can use that variant
   * directly.
   *
   * @param text - The JSONC source to parse.
   * @param options - Optional {@link JsoncParseOptions}; defaults apply for
   *   omitted fields.
   * @returns An `Effect` that succeeds with the decoded value, or fails with
   *   the aggregate {@link JsoncParseError}.
   */
  static readonly parse: (text: string, options?: JsoncParseOptions | undefined) => Effect.Effect<unknown, JsoncParseError, never>;
  /**
   * Parse JSONC into an immutable {@link JsoncNode} AST, synchronously,
   * returning a `Result` instead of an `Effect`. `Option.none()` for empty
   * input (with `allowEmptyContent`); the aggregate {@link JsoncParseError}
   * for malformed input. Pure — parsing is fundamentally synchronous, so
   * non-Effect consumers (a plain config loader, a build script) can call
   * this directly instead of wrapping
   * `Effect.runSync(Effect.result(Jsonc.parseTree(text)))`.
   *
   * @remarks
   * {@link Jsonc.parseTree} is defined in terms of this function; the two
   * never diverge. Reach for the `Effect` variant inside Effect code — it
   * carries the `Jsonc.parseTree` tracing span — and for this one at
   * synchronous boundaries.
   *
   * @example
   * ```ts
   * import { Jsonc } from "@effected/jsonc";
   * import { Option, Result } from "effect";
   *
   * const ok = Jsonc.parseTreeResult('{ "port": 3000 // dev\n }');
   * if (Result.isSuccess(ok) && Option.isSome(ok.success)) {
   *   console.log(ok.success.value.type); // => "object"
   * }
   *
   * const bad = Jsonc.parseTreeResult("{ bad }");
   * if (Result.isFailure(bad)) {
   *   console.log(bad.failure._tag); // => "JsoncParseError"
   * }
   * ```
   *
   * @param text - The JSONC source to parse.
   * @param options - Optional {@link JsoncParseOptions}; defaults apply for
   *   omitted fields.
   * @returns A `Result` succeeding with `Option.some(root)` (or
   *   `Option.none()` for empty input), or failing with the aggregate
   *   {@link JsoncParseError}.
   */
  static parseTreeResult(text: string, options?: JsoncParseOptions): Result.Result<Option.Option<JsoncNode>, JsoncParseError>;
  /**
   * Parse JSONC into an immutable {@link JsoncNode} AST. `Option.none()` for
   * empty input (with `allowEmptyContent`); the aggregate
   * {@link JsoncParseError} for malformed input. Defined in terms of
   * {@link Jsonc.parseTreeResult} — synchronous callers can use that variant
   * directly.
   *
   * @param text - The JSONC source to parse.
   * @param options - Optional {@link JsoncParseOptions}; defaults apply for
   *   omitted fields.
   * @returns An `Effect` that succeeds with `Option.some(root)` (or
   *   `Option.none()` for empty input), or fails with the aggregate
   *   {@link JsoncParseError}.
   */
  static readonly parseTree: (text: string, options?: JsoncParseOptions | undefined) => Effect.Effect<Option.Option<JsoncNode>, JsoncParseError, never>;
  /**
   * Stringify a plain JavaScript value as JSON text, synchronously, returning
   * a `Result` instead of an `Effect`. With no options the output is
   * byte-identical to `JSON.stringify(value, null, 2)`.
   *
   * Plain JSON emission: JSONC comments exist only in the document/edit layer
   * (`JsoncNode`, `JsoncEdit`, `JsoncFormatter`), so no comment survives — or
   * can be produced by — value-level stringification.
   *
   * Nested unrepresentable values follow `JSON.stringify`'s documented
   * semantics: `undefined`, functions and symbols are dropped from objects and
   * become `null` in arrays. The typed failure channel covers only the cases
   * where output would be absent or an exception thrown — see
   * `JsoncStringifyErrorCode`. A throwing `toJSON` method or getter is
   * caller code failing and rethrows as a defect, never a typed error.
   *
   * @remarks
   * {@link Jsonc.stringify} is defined in terms of this function; the two
   * never diverge. Reach for the `Effect` variant inside Effect code — it
   * carries the `Jsonc.stringify` tracing span — and for this one at
   * synchronous boundaries.
   *
   * @example
   * ```ts
   * import { Jsonc } from "@effected/jsonc";
   * import { Result } from "effect";
   *
   * const ok = Jsonc.stringifyResult({ port: 3000 });
   * if (Result.isSuccess(ok)) {
   *   console.log(ok.success); // => '{\n  "port": 3000\n}'
   * }
   *
   * const bad = Jsonc.stringifyResult(0n);
   * if (Result.isFailure(bad)) {
   *   console.log(bad.failure.code); // => "BigIntValue"
   * }
   * ```
   *
   * @param value - The plain JavaScript value to stringify.
   * @param options - Optional {@link JsoncStringifyOptions}; defaults apply
   *   for omitted fields.
   * @returns A `Result` succeeding with the JSON text, or failing with a
   *   {@link JsoncStringifyError}.
   */
  static stringifyResult(value: unknown, options?: JsoncStringifyOptions): Result.Result<string, JsoncStringifyError>;
  /**
   * Stringify a plain JavaScript value as JSON text. With no options the
   * output is byte-identical to `JSON.stringify(value, null, 2)`. Fails with
   * {@link JsoncStringifyError} on circular references, `bigint` values and a
   * top-level value with no JSON representation; nested `undefined`, functions
   * and symbols follow `JSON.stringify`'s documented semantics (dropped from
   * objects, `null` in arrays). Comments are a document/edit-layer concern —
   * value-level stringification never emits them. Defined in terms of
   * {@link Jsonc.stringifyResult} — synchronous callers can use that variant
   * directly.
   *
   * @param value - The plain JavaScript value to stringify.
   * @param options - Optional {@link JsoncStringifyOptions}; defaults apply
   *   for omitted fields.
   * @returns An `Effect` that succeeds with the JSON text, or fails with a
   *   {@link JsoncStringifyError}.
   */
  static readonly stringify: (value: unknown, options?: JsoncStringifyOptions | undefined) => Effect.Effect<string, JsoncStringifyError, never>;
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
  static stripComments(text: string, replaceCh?: string): string;
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
  static equals(a: string, b: string): boolean;
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
  static equalsValue(text: string, value: unknown): boolean;
  /**
   * A `Schema<unknown, string>` decoding JSONC with the given `options`
   * (defaults when omitted). Encoding is {@link Jsonc.stringifyResult} with
   * default options (2-space indent, byte-identical to
   * `JSON.stringify(value, null, 2)`), so comments do not survive a
   * round-trip encode; a {@link JsoncStringifyError} on the encode side
   * surfaces as a schema issue.
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
  static fromString(options?: JsoncParseOptions): Schema.Codec<unknown, string>;
  /**
   * The zero-config `Schema<unknown, string>` — `Jsonc.fromString()` with
   * default options, pre-bound so the common case needs no memoization
   * discipline.
   */
  static readonly JsoncFromString: Schema.Codec<unknown, string>;
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
  static schema<T, E, RD = never, RE = never>(target: Schema.Codec<T, E, RD, RE>, options?: JsoncParseOptions): Schema.Codec<T, string, RD, RE>;
  /**
   * Bind a target schema to the JSONC codec once, yielding the composed
   * schema plus pre-derived `decode`/`encode` directions — the
   * {@link Jsonc.schema} composition without the generic `Schema` machinery
   * at every use site. Binds the plain form only: default
   * {@link JsoncParseOptions} on decode, default stringify options on encode.
   *
   * Both directions fail with `Schema.SchemaError`, exactly as
   * `Schema.decodeEffect`/`Schema.encodeEffect` over {@link Jsonc.schema}
   * would; the target's decoding/encoding service requirements flow through.
   *
   * @remarks
   * Schema-producing: each call composes a fresh schema and derives both
   * directions from it. Bind the result to a `const` — that single binding is
   * the point.
   *
   * @example
   * ```ts
   * import { Jsonc } from "@effected/jsonc";
   * import { Effect, Schema } from "effect";
   *
   * const Config = Schema.Struct({ port: Schema.Number });
   * const config = Jsonc.bind(Config);
   *
   * const program = Effect.gen(function* () {
   *   const value = yield* config.decode('{ "port": 3000 // dev\n }');
   *   const text = yield* config.encode(value);
   *   return [value, text] as const;
   * });
   * ```
   *
   * @param target - The domain schema decoded values must satisfy.
   * @returns A {@link JsoncBoundCodec} carrying the composed schema and its
   *   two pre-bound directions.
   */
  static bind<T, E, RD = never, RE = never>(target: Schema.Codec<T, E, RD, RE>): JsoncBoundCodec<T, RD, RE>;
}
declare const JsoncRange_base: Schema.Class<JsoncRange, Schema.Struct<{
  readonly offset: Schema.Number;
  readonly length: Schema.Number;
}>, {}>;
/**
 * A range within a JSONC document, expressed as a zero-based character
 * `offset` and a `length` in UTF-16 code units. Pass to `JsoncFormatter.format`
 * to restrict formatting to a region.
 *
 * @public
 */
export declare class JsoncRange extends JsoncRange_base {}
declare const JsoncFormattingOptions_base: Schema.Class<JsoncFormattingOptions, Schema.Struct<{
  readonly tabSize: Schema.optionalKey<Schema.Number>;
  readonly insertSpaces: Schema.optionalKey<Schema.Boolean>;
  readonly eol: Schema.optionalKey<Schema.String>;
  readonly insertFinalNewline: Schema.optionalKey<Schema.Boolean>;
  readonly keepLines: Schema.optionalKey<Schema.Boolean>;
}>, {}>;
/**
 * Options controlling JSONC formatting. All fields are omissible.
 *
 * - `tabSize` — the indent width in columns when `insertSpaces` is `true`.
 *   Defaults to `2`.
 * - `insertSpaces` — indent with spaces (`tabSize` of them) when `true`, or a
 *   single tab character when `false`. Defaults to `true`.
 * - `eol` — the line-ending string inserted between formatted tokens.
 *   Defaults to `"\n"`.
 * - `insertFinalNewline` — append `eol` at the end of the document if it
 *   doesn't already end with one. Defaults to `false`.
 * - `keepLines` — preserve existing line breaks (including blank lines)
 *   between tokens instead of collapsing each gap to the canonical single
 *   `eol`. Defaults to `false`.
 *
 * @public
 */
export declare class JsoncFormattingOptions extends JsoncFormattingOptions_base {}
/**
 * Formatting options accepted at call sites: either a
 * {@link JsoncFormattingOptions} instance or a plain literal with the same
 * fields (the two are structurally interchangeable — only the option fields
 * are read). A caller can pass `{ insertSpaces: false, tabSize: 2 }` without constructing
 * the class. `JsoncFormattingOptions` remains the canonical decoded form.
 *
 * @public
 */
type JsoncFormattingOptionsLike = JsoncFormattingOptions | {
  readonly tabSize?: number;
  readonly insertSpaces?: boolean;
  readonly eol?: string;
  readonly insertFinalNewline?: boolean;
  readonly keepLines?: boolean;
};
declare const JsoncEdit_base: Schema.Class<JsoncEdit, Schema.Struct<{
  readonly offset: Schema.Number;
  readonly length: Schema.Number;
  readonly content: Schema.String;
}>, {}>;
/**
 * A non-mutating text edit: replace the span `[offset, offset + length)` with
 * `content`. Set `length` to `0` to insert, `content` to `""` to delete.
 *
 * @public
 */
export declare class JsoncEdit extends JsoncEdit_base {
  /**
   * Apply `edits` to `text`, producing a new string. Edits are applied in
   * reverse-offset order so earlier offsets stay valid; the input `edits`
   * array is not mutated. Overlapping edits are a programmer error and throw
   * as a defect — `JsoncFormatter` never produces them.
   *
   * @param text - The source text to edit.
   * @param edits - The edits to apply, in any order.
   * @returns The edited text.
   */
  static applyAll(text: string, edits: ReadonlyArray<JsoncEdit>): string;
}
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
export declare const JsoncCanonicalizeErrorCode: Schema.Literals<readonly ["UnrepresentableValue", "BigIntValue", "NonFiniteNumber", "LoneSurrogate", "NonPlainObject", "NestingDepthExceeded", "InvalidDigest"]>;
/**
 * The union of all canonicalize-error code string literals.
 *
 * @public
 */
export type JsoncCanonicalizeErrorCode = typeof JsoncCanonicalizeErrorCode.Type;
declare const JsoncCanonicalizeError_base: Schema.Class<JsoncCanonicalizeError, Schema.TaggedStruct<"JsoncCanonicalizeError", {
  readonly code: Schema.Literals<readonly ["UnrepresentableValue", "BigIntValue", "NonFiniteNumber", "LoneSurrogate", "NonPlainObject", "NestingDepthExceeded", "InvalidDigest"]>;
  readonly path: Schema.String;
  readonly detail: Schema.String;
}>, import("effect/Cause").YieldableError>;
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
export declare class JsoncCanonicalizeError extends JsoncCanonicalizeError_base {
  get message(): string;
}
declare const JsoncTextHashOptions_base: Schema.Class<JsoncTextHashOptions, Schema.Struct<{
  readonly normalizeEol: Schema.optionalKey<Schema.Boolean>;
}>, {}>;
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
export declare class JsoncTextHashOptions extends JsoncTextHashOptions_base {}
declare const JsoncCanonicalizeOptions_base: Schema.Class<JsoncCanonicalizeOptions, Schema.Struct<{
  readonly bigint: Schema.optionalKey<Schema.Literals<readonly ["fail", "number"]>>;
  readonly undefined: Schema.optionalKey<Schema.Literals<readonly ["fail", "omit"]>>;
  readonly nonFinite: Schema.optionalKey<Schema.Literals<readonly ["fail", "null"]>>;
  readonly toJSON: Schema.optionalKey<Schema.Literals<readonly ["ignore", "date", "all"]>>;
}>, {}>;
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
export declare class JsoncCanonicalizeOptions extends JsoncCanonicalizeOptions_base {}
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
type JsoncDigest = (bytes: Uint8Array) => Uint8Array;
/**
 * Static entry points for canonical JSON serialization (RFC 8785, the JSON
 * Canonicalization Scheme) and SHA-256 content fingerprints. Not instantiable.
 *
 * Canonicalization is pure; the two hashing statics require core's
 * `Digest.Digest` service in `R` and own no backend — provide
 * `Digest.layerWebCrypto` from `effect/crypto` (any runtime with WebCrypto)
 * or a platform family layer such as `@effect/platform-node`'s
 * `NodeCrypto.layerDigest` at the application edge.
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
 * // Provide a Digest layer at the edge, e.g. Digest.layerWebCrypto from
 * // "effect/crypto".
 * ```
 *
 * @public
 */
export declare class JsoncFingerprint {
  private constructor();
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
  static canonicalizeResult(value: unknown, options?: JsoncCanonicalizeOptions): Result.Result<string, JsoncCanonicalizeError>;
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
  static readonly canonicalize: (value: unknown, options?: JsoncCanonicalizeOptions | undefined) => Effect.Effect<string, JsoncCanonicalizeError, never>;
  /**
   * Normalize line endings for hashing: `\r\n` and bare `\r` become `\n`.
   * Pure and total — exactly the normalization
   * {@link JsoncFingerprint.hashText} applies when its `normalizeEol` option
   * is set, exposed so split/inspect flows can share it.
   *
   * @param text - The text to normalize.
   * @returns The text with all line endings as `\n`.
   */
  static normalizeEol(text: string): string;
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
   * exactly as a `Digest` layer is provided at the edge for the `Effect`
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
  static hashResult(value: unknown, digest: JsoncDigest, options?: JsoncCanonicalizeOptions): Result.Result<string, JsoncCanonicalizeError>;
  /**
   * The content fingerprint of a JSON value: the lowercase-hex SHA-256 of
   * the UTF-8 bytes of its RFC 8785 canonical serialization. Values that
   * differ only in object key order fingerprint identically; any non-JSON
   * value fails with the same typed errors as
   * {@link JsoncFingerprint.canonicalize}.
   *
   * Requires core's `Digest.Digest` service — provide
   * `Digest.layerWebCrypto` from `effect/crypto` (or a platform family layer
   * such as `NodeCrypto.layerDigest`) at the application edge. The digest
   * itself cannot fail with a typed error.
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
   * @returns An `Effect` requiring `Digest.Digest` that succeeds with the
   *   64-character lowercase-hex SHA-256, or fails with a
   *   {@link JsoncCanonicalizeError}.
   */
  static readonly hash: (value: unknown, options?: JsoncCanonicalizeOptions | undefined) => Effect.Effect<string, JsoncCanonicalizeError, Digest.Digest>;
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
  static hashTextResult(text: string, digest: JsoncDigest, options?: JsoncTextHashOptions): Result.Result<string, JsoncCanonicalizeError>;
  /**
   * The content fingerprint of raw text: the lowercase-hex SHA-256 of its
   * UTF-8 bytes, with opt-in line-ending normalization (`\r\n`/`\r` → `\n`)
   * for file content that must fingerprint identically across checkout
   * line-ending settings.
   *
   * Requires core's `Digest.Digest` service — provide
   * `Digest.layerWebCrypto` from `effect/crypto` (or a platform family layer
   * such as `NodeCrypto.layerDigest`) at the application edge.
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
   * @returns An `Effect` requiring `Digest.Digest` that succeeds with the
   *   64-character lowercase-hex SHA-256; it has no typed failure.
   */
  static readonly hashText: (text: string, options?: JsoncTextHashOptions | undefined) => Effect.Effect<string, never, Digest.Digest>;
}
/**
 * Formats JSONC text into canonical whitespace, as minimal edits or as a
 * finished string, preserving comments. Pure and total; not instantiable.
 *
 * @example
 * ```ts
 * import { JsoncFormatter } from "@effected/jsonc";
 *
 * const formatted = JsoncFormatter.formatToString('{"a":1,"b":[1,2]} // keep');
 * // => '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n} // keep'
 * ```
 *
 * @public
 */
export declare class JsoncFormatter {
  private constructor();
  /**
   * Compute formatting edits for a JSONC document. Non-mutating — apply the
   * result with `JsoncEdit.applyAll`. Pure and total.
   *
   * @param text - The JSONC source to format.
   * @param range - Optional sub-range; only edits within it are returned.
   * @param options - Optional {@link JsoncFormattingOptions}; absent fields use
   *   defaults (tabSize 2, spaces, `"\n"`, no final newline, reflow).
   * @returns The edits that bring `text` (or `range`) to canonical shape;
   *   apply them with `JsoncEdit.applyAll`.
   */
  static format(text: string, range?: JsoncRange, options?: JsoncFormattingOptions): ReadonlyArray<JsoncEdit>;
  /**
   * Format `text` and apply the resulting edits in one step
   * (`applyAll ∘ format`). Pure and total.
   *
   * @param text - The JSONC source to format.
   * @param range - Optional sub-range; only edits within it are applied.
   * @param options - Optional {@link JsoncFormattingOptions}; see
   *   {@link JsoncFormatter.format} for defaults.
   * @returns The formatted text.
   */
  static formatToString(text: string, range?: JsoncRange, options?: JsoncFormattingOptions): string;
}
declare const JsoncModificationError_base: Schema.Class<JsoncModificationError, Schema.TaggedStruct<"JsoncModificationError", {
  readonly path: Schema.$Array<Schema.Union<readonly [Schema.String, Schema.Number]>>;
  readonly expected: Schema.Literals<readonly ["object", "array"]>;
  readonly depth: Schema.Number;
  readonly offset: Schema.optionalKey<Schema.Number>;
  readonly limit: Schema.optionalKey<Schema.Number>;
}>, import("effect/Cause").YieldableError>;
/**
 * Raised when `JsoncModifier.modify` cannot navigate the requested path: the
 * value at `depth` is not the container kind (`expected`) the next path segment
 * requires.
 *
 * - `path` — the full path that was passed to `JsoncModifier.modify`.
 * - `expected` — the container kind (`"object"` or `"array"`) the segment at
 *   `depth` required.
 * - `depth` — the 1-based index into `path` where navigation failed.
 * - `offset` — reserved for a source-position annotation; currently always
 *   omitted (navigation reports the mismatch structurally, without a text
 *   offset).
 * - `limit` — present only when `createParents` would nest deeper than the
 *   parser's cap: the cap (256 levels), with `depth` the first level past it.
 *
 * @remarks
 * Follows the structure-preserving-errors house rule — the mismatch's
 * discriminating data is carried as typed fields (`path`, `expected`, `depth`,
 * optional `offset`), not collapsed into a `reason: string`. This mirrors
 * `YamlModificationError`'s posture (its fields differ because the underlying
 * failures differ; the cross-package parity convention binds
 * `Edit`/`Range`/`Path`, not this error).
 *
 * @public
 */
export declare class JsoncModificationError extends JsoncModificationError_base {
  get message(): string;
}
/**
 * Options for `JsoncModifier.modify`: formatting controls for generated text,
 * where a new object member goes, and whether missing ancestors are created.
 *
 * @public
 */
interface JsoncModifyOptions {
  /**
   * Formatting applied to inserted/replaced content. `tabSize` and
   * `insertSpaces` decide the indentation unit together: give either and the
   * document is not consulted for it, so `insertSpaces: false` is a tab and
   * otherwise the unit is `tabSize` spaces, two when `tabSize` is left out.
   * Give neither and the unit comes from the document's first indented line,
   * or two spaces when there is none. `eol` is separate, and left out comes
   * from the document's first line break. The column a value starts from always
   * comes from its position in the document. Accepts a `JsoncFormattingOptions`
   * instance or a plain literal (e.g. `{ insertSpaces: false, tabSize: 2 }`) —
   * see {@link JsoncFormattingOptionsLike}.
   */
  readonly formattingOptions?: JsoncFormattingOptionsLike;
  /**
   * Place the new object member directly after this sibling, a key of the
   * object receiving it. Appended as usual when the object has no such key. Has
   * no effect on a replace, a delete, or an array. With
   * {@link JsoncModifyOptions.createParents}, the member being inserted is the
   * outermost created key and the object receiving it is the deepest one that
   * exists, so `["catalogs", "silk", "effect"]` with `insertAfter: "workspaces"`
   * puts `catalogs` directly after `workspaces`.
   *
   * The sibling keeps a comment trailing it on its own line, however the comma
   * falls. A sibling sharing its line with something other than a comment keeps
   * the plain insert shape: the new member opens a line straight after the
   * sibling's value, and whatever followed the value follows the new member.
   * So `{ "a": 1, "b": 2 }` after `a` gives `{ "a": 1,\n  "k": 9, "b": 2 }`.
   */
  readonly insertAfter?: string;
  /**
   * Create missing object ancestors of the target. Off by default, when a
   * missing ancestor fails with {@link JsoncModificationError}. An ancestor that
   * exists with the wrong type still fails and is never overwritten, a numeric
   * segment under a missing ancestor still fails (`expected: "array"`), because
   * arrays are never invented, and so does a missing array element. A delete
   * under a missing ancestor succeeds with no edits. A path that would nest
   * deeper than `Jsonc.parse` accepts (256 levels, counting the existing
   * container plus every created one) fails with {@link JsoncModificationError}
   * carrying `limit` and the first `depth` past it, leaving the text untouched.
   */
  readonly createParents?: boolean;
}
/**
 * Sets, replaces or deletes a value at a path in JSONC text, as byte-minimal
 * edits that leave comments and formatting elsewhere untouched. Not
 * instantiable.
 *
 * @example
 * ```ts
 * import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
 * import { Effect } from "effect";
 *
 * const text = '{\n  // dev port\n  "port": 3000\n}';
 *
 * const program = Effect.gen(function* () {
 *   const edits = yield* JsoncModifier.modify(text, ["port"], 8080);
 *   return JsoncEdit.applyAll(text, edits);
 *   // => '{\n  // dev port\n  "port": 8080\n}'
 * });
 * ```
 *
 * @public
 */
export declare class JsoncModifier {
  private constructor();
  /**
   * Compute the edits that set, replace or delete `value` at `path` in `text`,
   * synchronously. This is the primitive {@link JsoncModifier.modify} is
   * defined in terms of — a synchronous host (a lint-staged task, a config
   * file) can call it without an Effect runtime.
   *
   * Passing `value === undefined` deletes the target property or element
   * (including its surrounding comma). A missing insertion target appends after
   * the last property/element, or after the sibling named by `insertAfter`. Any
   * other value is serialized through {@link Jsonc.stringifyResult}, then placed
   * at its position in the document: a new member lines up with the sibling it
   * follows and leaves that sibling's trailing comment with it, and a member of
   * an empty container sits one unit in from the container's line. Every
   * generated line takes the document's line ending, unless `formattingOptions`
   * says otherwise. An inline container keeps a plain shape: a new member opens
   * its own line at the sibling's value, carrying along whatever followed it.
   *
   * A delete takes the whole line of an entry that had one to itself, and
   * collapses a container left with nothing in it to `{}` or `[]`. It removes
   * the comments inside what it cuts: those between the entry's key and its
   * comma and, for an entry after the first, everything back to the preceding
   * comma, which takes in a comment trailing the previous member and any comment
   * on a line above the entry. Comments outside that range stay.
   *
   * @remarks
   * The error channel carries two failure kinds, kept apart deliberately:
   * {@link JsoncModificationError} when `path` cannot be navigated, and
   * {@link JsoncStringifyError} when `value` has no JSON representation (a
   * circular structure, a `bigint`, or a function or symbol where a value is
   * written). `JsoncStringifyError` carries no `path` — it is the same error
   * `Jsonc.stringify` raises for the same value — so a caller that needs the
   * failing path re-attaches the one it passed.
   *
   * Navigation runs before serialization: a path that cannot be navigated
   * fails with `JsoncModificationError` even when `value` is also
   * unserializable. A delete (`value === undefined`) never serializes.
   *
   * @example
   * ```ts
   * import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
   * import { Result } from "effect";
   *
   * const text = '{ "port": 3000 }';
   * const result = JsoncModifier.modifyResult(text, ["port"], 8080);
   * if (Result.isSuccess(result)) {
   *   console.log(JsoncEdit.applyAll(text, result.success)); // => '{ "port": 8080 }'
   * }
   * ```
   *
   * @param text - The JSONC source to modify.
   * @param path - The location to set, replace or delete; `[]` replaces the
   *   whole document.
   * @param value - The plain JavaScript value to write; `undefined` deletes
   *   the target instead.
   * @param options - Optional {@link JsoncModifyOptions} controlling
   *   formatting of generated content, where a new member goes, and whether
   *   missing ancestors are created.
   * @returns A `Result` succeeding with the edits to apply (via
   *   `JsoncEdit.applyAll`), or failing with {@link JsoncModificationError} or
   *   {@link JsoncStringifyError}.
   */
  static modifyResult(text: string, path: JsoncPath, value: unknown, options?: JsoncModifyOptions): Result.Result<ReadonlyArray<JsoncEdit>, JsoncModificationError | JsoncStringifyError>;
  /**
   * Compute the edits that set, replace or delete `value` at `path` in `text`.
   *
   * Passing `value === undefined` deletes the target property or element
   * (including its surrounding comma). A missing insertion target appends after
   * the last property/element. Fails with {@link JsoncModificationError} on a
   * structural mismatch, and with {@link JsoncStringifyError} when `value` has
   * no JSON representation. Defined in terms of
   * {@link JsoncModifier.modifyResult} — synchronous callers can use that
   * variant directly.
   *
   * @remarks
   * `JsoncStringifyError` carries no `path`; see
   * {@link JsoncModifier.modifyResult} for the failure precedence and why the
   * two errors stay separate.
   *
   * @param text - The JSONC source to modify.
   * @param path - The location to set, replace or delete; `[]` replaces the
   *   whole document.
   * @param value - The plain JavaScript value to write, serialized through
   *   `Jsonc.stringifyResult`; `undefined` deletes the target instead.
   * @param options - Optional {@link JsoncModifyOptions} controlling
   *   formatting of generated content, where a new member goes, and whether
   *   missing ancestors are created.
   * @returns An `Effect` that succeeds with the edits to apply (via
   *   `JsoncEdit.applyAll`), or fails with {@link JsoncModificationError} when
   *   `path` cannot be navigated or {@link JsoncStringifyError} when `value`
   *   cannot be serialized.
   */
  static readonly modify: (text: string, path: JsoncPath, value: unknown, options?: JsoncModifyOptions | undefined) => Effect.Effect<readonly JsoncEdit[], JsoncModificationError | JsoncStringifyError, never>;
}
/**
 * The discriminated union of JSONC visitor events. Every variant carries
 * `offset` and `length`; `ObjectBegin`, `ArrayBegin`, `ObjectProperty` and
 * `LiteralValue` also carry `path` context (the location being entered).
 *
 * - `ObjectBegin` / `ObjectEnd` — an object's opening `{` / closing `}`.
 * - `ObjectProperty` — an object key, ahead of its value; `property` is the
 *   key string.
 * - `ArrayBegin` / `ArrayEnd` — an array's opening `[` / closing `]`.
 * - `LiteralValue` — a scalar value (`string`/`number`/`boolean`/`null`);
 *   `value` is the decoded JS value.
 * - `Separator` — a `,` or `:` token; `character` is which one.
 * - `Comment` — a line or block comment span.
 * - `Error` — a recovered parse error; `code` is its `JsoncParseErrorCode`.
 *
 * @public
 */
export type JsoncVisitorEvent = Data.TaggedEnum<{
  ObjectBegin: {
    readonly offset: number;
    readonly length: number;
    readonly path: JsoncPath;
  };
  ObjectEnd: {
    readonly offset: number;
    readonly length: number;
  };
  ObjectProperty: {
    readonly property: string;
    readonly offset: number;
    readonly length: number;
    readonly path: JsoncPath;
  };
  ArrayBegin: {
    readonly offset: number;
    readonly length: number;
    readonly path: JsoncPath;
  };
  ArrayEnd: {
    readonly offset: number;
    readonly length: number;
  };
  LiteralValue: {
    readonly value: unknown;
    readonly offset: number;
    readonly length: number;
    readonly path: JsoncPath;
  };
  Separator: {
    readonly character: string;
    readonly offset: number;
    readonly length: number;
  };
  Comment: {
    readonly offset: number;
    readonly length: number;
  };
  Error: {
    readonly code: JsoncParseErrorCode;
    readonly offset: number;
    readonly length: number;
  };
}>;
/**
 * Constructors and matchers for the `JsoncVisitorEvent` union (e.g.
 * `JsoncVisitorEvent.ObjectBegin({ offset, length, path })`,
 * `JsoncVisitorEvent.$is("LiteralValue")`).
 *
 * @public
 */
export declare const JsoncVisitorEvent: Data.TaggedEnum.Constructor<{
  readonly _tag: "ArrayBegin";
  readonly offset: number;
  readonly length: number;
  readonly path: JsoncPath;
} | {
  readonly _tag: "ArrayEnd";
  readonly offset: number;
  readonly length: number;
} | {
  readonly _tag: "Comment";
  readonly offset: number;
  readonly length: number;
} | {
  readonly _tag: "Error";
  readonly code: JsoncParseErrorCode;
  readonly offset: number;
  readonly length: number;
} | {
  readonly _tag: "LiteralValue";
  readonly value: unknown;
  readonly offset: number;
  readonly length: number;
  readonly path: JsoncPath;
} | {
  readonly _tag: "ObjectBegin";
  readonly offset: number;
  readonly length: number;
  readonly path: JsoncPath;
} | {
  readonly _tag: "ObjectEnd";
  readonly offset: number;
  readonly length: number;
} | {
  readonly _tag: "ObjectProperty";
  readonly property: string;
  readonly offset: number;
  readonly length: number;
  readonly path: JsoncPath;
} | {
  readonly _tag: "Separator";
  readonly character: string;
  readonly offset: number;
  readonly length: number;
}>;
/**
 * Walks JSONC text as a lazy `Stream` of typed events — objects, properties,
 * values, separators, comments and recovered errors — without building an AST.
 * Not instantiable.
 *
 * @example
 * ```ts
 * import { JsoncVisitor, JsoncVisitorEvent } from "@effected/jsonc";
 * import { Effect, Stream } from "effect";
 *
 * const keys = JsoncVisitor.visit('{ "a": 1, "b": 2 }').pipe(
 *   Stream.filter(JsoncVisitorEvent.$is("ObjectProperty")),
 *   Stream.map((event) => event.property),
 *   Stream.runCollect,
 * );
 * // Effect.runSync(keys) // => ["a", "b"]
 * ```
 *
 * @public
 */
export declare class JsoncVisitor {
  private constructor();
  /**
   * Create a lazy `Stream` of `JsoncVisitorEvent` from JSONC text. Events
   * are produced on demand, so combining with `Stream.take` allows efficient
   * partial scans of large documents.
   *
   * @param text - The JSONC source to visit.
   * @param options - Optional {@link JsoncParseOptions}; only comment handling
   *   is consulted.
   * @returns A lazy `Stream` of `JsoncVisitorEvent`, infallible at the type
   *   level — malformed input surfaces as in-band `Error` events rather than
   *   failing the stream.
   */
  static visit(text: string, options?: JsoncParseOptions): Stream.Stream<JsoncVisitorEvent>;
}
export type { JsoncBoundCodec, JsoncDigest, JsoncFormattingOptionsLike, JsoncModifyOptions, JsoncPath, JsoncSegment };
//# sourceMappingURL=index.d.ts.map