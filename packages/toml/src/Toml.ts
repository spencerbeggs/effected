// The `Toml` facade: value-level parsing, canonical stringification and the
// flagship schema factories, plus the stringify options and the errors the
// entry points raise.
//
// Cycle firewall: the internal engine throws raw carriers (`RawTomlError`
// with a `{ code, message, offset, length }` record, `GuardExceeded` from the
// depth guards); this module materializes `TomlDiagnostic` instances
// (deriving `line`/`character` from `offset`) and constructs the tagged
// TomlParseError / TomlStringifyError. The dependency edge runs facade →
// engine only, so `noImportCycles` stays satisfied.

import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { isRawTomlError } from "./internal/diagnostics.js";
import { isGuardExceeded } from "./internal/limits.js";
import { parseExpressions } from "./internal/parser.js";
import { buildValue } from "./internal/semantic.js";
import { stringifyValue } from "./internal/stringifyValue.js";
import { TomlDiagnostic } from "./TomlDiagnostic.js";

/**
 * Options controlling stringify behavior. The only knob is `newline` —
 * omitted, it resolves to `"\n"`.
 *
 * @remarks
 * Stringify deliberately emits only TOML 1.0.0 spellings — seconds always
 * present in times, no `\e`/`\xHH` escapes, single-line inline tables — even
 * though {@link Toml.parse} accepts the full TOML 1.1.0 grammar. Every 1.0
 * document is valid 1.1, so this conservative-write/liberal-read asymmetry
 * keeps emitted documents readable by 1.0-only consumers.
 *
 * @public
 */
export class TomlStringifyOptions extends Schema.Class<TomlStringifyOptions>("TomlStringifyOptions")({
	newline: Schema.optionalKey(Schema.Literals(["\n", "\r\n"])),
}) {}

/**
 * Parse failure: the {@link TomlDiagnostic} entries describing why the
 * document was rejected (first violation wins, so there is one today; the
 * array shape matches `@effected/yaml`'s aggregate contract). Raised by
 * {@link Toml.parse} and the decode direction of the schema factories.
 *
 * @public
 */
export class TomlParseError extends Schema.TaggedErrorClass<TomlParseError>()("TomlParseError", {
	diagnostics: Schema.Array(TomlDiagnostic),
}) {
	override get message(): string {
		const count = this.diagnostics.length;
		const first = this.diagnostics[0];
		const detail = first === undefined ? "" : `: ${first.code} at ${first.line}:${first.character} ${first.message}`;
		return `TOML parse failed with ${count} error${count === 1 ? "" : "s"}${detail}`;
	}
}

/**
 * Stringification failure: an unsupported value, an out-of-range integer, a
 * circular reference or a tripped depth guard, as one structured
 * {@link TomlDiagnostic} (offset `0` — there is no source text). Raised by
 * {@link Toml.stringify} and the encode direction of the schema factories.
 *
 * @public
 */
export class TomlStringifyError extends Schema.TaggedErrorClass<TomlStringifyError>()("TomlStringifyError", {
	diagnostic: TomlDiagnostic,
}) {
	override get message(): string {
		return `TOML stringify failed: ${this.diagnostic.code} ${this.diagnostic.message}`;
	}
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Run the parser and semantic pass, materializing the engine's raw carriers
 * into the typed error: `RawTomlError` becomes a positioned diagnostic and a
 * `GuardExceeded` depth trip becomes a `NestingDepthExceeded` diagnostic
 * (never an unhandled defect). Anything else is a genuine defect and rethrows.
 */
const parseOrFail = (text: string): Effect.Effect<unknown, TomlParseError> =>
	Effect.try({
		try: () => buildValue(parseExpressions(text)),
		catch: (defect) => {
			if (isRawTomlError(defect)) {
				return new TomlParseError({ diagnostics: [TomlDiagnostic.fromRaw(text, defect.diagnostic)] });
			}
			if (isGuardExceeded(defect)) {
				return new TomlParseError({
					diagnostics: [
						TomlDiagnostic.fromRaw(text, {
							code: "NestingDepthExceeded",
							message: defect.message,
							offset: defect.offset,
							length: 0,
						}),
					],
				});
			}
			throw defect;
		},
	});

const stringifyOrFail = (value: unknown, options?: TomlStringifyOptions): Effect.Effect<string, TomlStringifyError> =>
	Effect.try({
		try: () => stringifyValue(value, options?.newline ?? "\n"),
		catch: (defect) => {
			if (isRawTomlError(defect)) {
				return new TomlStringifyError({ diagnostic: TomlDiagnostic.fromRaw("", defect.diagnostic) });
			}
			if (isGuardExceeded(defect)) {
				return new TomlStringifyError({
					diagnostic: TomlDiagnostic.fromRaw("", {
						code: "NestingDepthExceeded",
						message: defect.message,
						offset: 0,
						length: 0,
					}),
				});
			}
			throw defect;
		},
	});

// ── Bound codec ─────────────────────────────────────────────────────────────

/**
 * A domain codec pre-bound to its two directions, returned by
 * {@link Toml.bind}: the composed `schema` (what {@link Toml.schema} returns)
 * plus `decode` and `encode` functions derived from it once, so callers need
 * no generic `Schema` machinery at the use site.
 *
 * @public
 */
export interface TomlBoundCodec<T, RD = never, RE = never> {
	/** The composed codec decoding a TOML `string` straight into `T`. */
	readonly schema: Schema.Codec<T, string, RD, RE>;
	/** Decode TOML text into a validated `T`. */
	readonly decode: (text: string) => Effect.Effect<T, Schema.SchemaError, RD>;
	/** Encode a `T` back to canonical TOML text. */
	readonly encode: (value: T) => Effect.Effect<string, Schema.SchemaError, RE>;
}

// ── Facade ──────────────────────────────────────────────────────────────────

/**
 * Static entry points for TOML parsing, stringification and the schema
 * factories. Not instantiable.
 *
 * @remarks
 * `parse`, `stringify` and the schema factories carry real typed error
 * channels — including the hardening guards (nesting-depth caps on both
 * sides, circular-reference detection on encode) that keep malformed or
 * adversarial input on the typed channel instead of surfacing as an
 * unhandled defect. `parse` takes no options: TOML 1.1.0 parsing has no
 * knobs.
 *
 * @example
 * ```ts
 * import { Toml } from "@effected/toml";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const value = yield* Toml.parse('name = "Alice"\nage = 30');
 *   return value; // { name: "Alice", age: 30 }
 * });
 * ```
 *
 * @public
 */
export class Toml {
	private constructor() {}

	/**
	 * Parse a TOML 1.1.0 document into a plain JavaScript value: tables and
	 * inline tables become plain objects (`__proto__` lands as an own data
	 * property), arrays become plain arrays, integers become `number` (or
	 * `bigint` past 2^53) and date-times become the four `TomlDateTime`
	 * classes. Fails with {@link TomlParseError} at the first violation;
	 * returns `unknown`, never `any`.
	 *
	 * A nesting-depth bomb (arrays or inline tables past the engine cap) also
	 * fails through {@link TomlParseError} with a `NestingDepthExceeded`
	 * diagnostic, never as an unhandled defect.
	 */
	static readonly parse = Effect.fn("Toml.parse")(function* (text: string) {
		return yield* parseOrFail(text);
	});

	/**
	 * Stringify a plain JavaScript value as a canonical TOML document: within
	 * a table, non-table pairs first, then sub-tables as `[dotted.header]`
	 * sections depth-first, then arrays of tables as `[[dotted.header]]`
	 * sections, a blank line before every header except at document start.
	 * Fails with {@link TomlStringifyError} on unsupported values (TOML has no
	 * null), out-of-int64-range `bigint`s, circular references and
	 * depth-guard trips — all on the typed channel.
	 */
	static readonly stringify = Effect.fn("Toml.stringify")(function* (value: unknown, options?: TomlStringifyOptions) {
		return yield* stringifyOrFail(value, options);
	});

	/**
	 * A `Schema<unknown, string>` decoding a TOML document and encoding values
	 * back to canonical TOML text.
	 *
	 * Schema-producing: each call returns a fresh schema whose derivation
	 * caches are not shared across calls. Bind the result to a `const` on hot
	 * paths; the pre-bound {@link Toml.TomlFromString} covers the common case.
	 */
	static fromString(): Schema.Codec<unknown, string> {
		return Schema.String.pipe(
			Schema.decodeTo(
				Schema.Unknown,
				SchemaTransformation.transformOrFail({
					decode: (input: string) =>
						Toml.parse(input).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(input), { message: error.message })),
						),
					encode: (value: unknown) =>
						stringifyOrFail(value).pipe(
							Effect.mapError((error) => new SchemaIssue.InvalidValue(Option.some(value), { message: error.message })),
						),
				}),
			),
		);
	}

	/**
	 * The zero-config `Schema<unknown, string>` — `Toml.fromString()`
	 * pre-bound so the common case needs no memoization discipline.
	 */
	static readonly TomlFromString: Schema.Codec<unknown, string> = Toml.fromString();

	/**
	 * Compose {@link Toml.fromString} with a target schema, yielding a
	 * `Schema<A, string>` that decodes TOML straight into a validated domain
	 * value. The target's decoding/encoding service requirements flow through.
	 *
	 * Schema-producing: bind the result to a `const` on hot paths (see
	 * {@link Toml.fromString}).
	 */
	static schema<T, E, RD = never, RE = never>(target: Schema.Codec<T, E, RD, RE>): Schema.Codec<T, string, RD, RE> {
		return Toml.TomlFromString.pipe(
			Schema.decodeTo(target as unknown as Schema.Codec<T, unknown, RD, RE>),
		) as unknown as Schema.Codec<T, string, RD, RE>;
	}

	/**
	 * Bind a target schema to the TOML codec once, yielding the composed
	 * schema plus pre-derived `decode`/`encode` directions — the
	 * {@link Toml.schema} composition without the generic `Schema` machinery
	 * at every use site. Binds the plain form only: TOML 1.1.0 parsing on
	 * decode, default stringify options on encode.
	 *
	 * Both directions fail with `Schema.SchemaError`, exactly as
	 * `Schema.decodeEffect`/`Schema.encodeEffect` over {@link Toml.schema}
	 * would; the target's decoding/encoding service requirements flow through.
	 *
	 * @remarks
	 * Schema-producing: each call composes a fresh schema and derives both
	 * directions from it. Bind the result to a `const` — that single binding is
	 * the point.
	 *
	 * @example
	 * ```ts
	 * import { Toml } from "@effected/toml";
	 * import { Effect, Schema } from "effect";
	 *
	 * const Config = Schema.Struct({ name: Schema.String });
	 * const config = Toml.bind(Config);
	 *
	 * const program = Effect.gen(function* () {
	 *   const value = yield* config.decode('name = "Alice"');
	 *   const text = yield* config.encode(value);
	 *   return [value, text] as const;
	 * });
	 * ```
	 *
	 * @param target - The domain schema decoded values must satisfy.
	 * @returns A {@link TomlBoundCodec} carrying the composed schema and its
	 *   two pre-bound directions.
	 */
	static bind<T, E, RD = never, RE = never>(target: Schema.Codec<T, E, RD, RE>): TomlBoundCodec<T, RD, RE> {
		const schema = Toml.schema(target);
		return {
			schema,
			decode: Schema.decodeEffect(schema),
			encode: Schema.encodeEffect(schema),
		};
	}
}
