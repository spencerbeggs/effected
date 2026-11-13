// The value schemas the catalog areas share, and the helper that builds an
// entry. Not exported from the `./settings` entry: an entry's `schema` is the
// public surface, these are how the areas spell it.

import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";
import type { PnpmSetting, PnpmSettingKind, PnpmSettingLocation } from "../PnpmSetting.js";

const TRUTHY: ReadonlySet<string> = new Set(["true", "yes", "y", "on"]);
const FALSY: ReadonlySet<string> = new Set(["false", "no", "n", "off"]);

/**
 * A boolean, or a word pnpm 12 coerces to one: `true`/`yes`/`y`/`on` and
 * `false`/`no`/`n`/`off`, trimmed, in any case.
 */
export const Bool = Schema.Union([Schema.Boolean, Schema.String]).pipe(
	Schema.decodeTo(
		Schema.Boolean,
		SchemaTransformation.transformEffect<boolean, boolean | string>({
			decode: (value) => {
				if (typeof value === "boolean") return Effect.succeed(value);
				const word = value.trim().toLowerCase();
				return TRUTHY.has(word)
					? Effect.succeed(true)
					: FALSY.has(word)
						? Effect.succeed(false)
						: Effect.fail(new SchemaIssue.InvalidValue({ message: "Expected a boolean" }, value));
			},
			encode: (value) => Effect.succeed(value),
		}),
	),
);

const UNSIGNED = /^(?:0|[1-9][0-9]*)$/;
const SIGNED = /^-?(?:0|[1-9][0-9]*)$/;

const integer = (pattern: RegExp, minimum: number | undefined, message: string) => {
	const target =
		minimum === undefined
			? Schema.Number.check(Schema.isInt())
			: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum));
	return Schema.Union([Schema.Number, Schema.String]).pipe(
		Schema.decodeTo(
			target,
			SchemaTransformation.transformEffect<number, number | string>({
				decode: (value) => {
					if (typeof value === "number") return Effect.succeed(value);
					const text = value.trim();
					return pattern.test(text) && Number.isSafeInteger(Number(text))
						? Effect.succeed(Number(text))
						: Effect.fail(new SchemaIssue.InvalidValue({ message }, value));
				},
				encode: (value) => Effect.succeed(value),
			}),
		),
	);
};

/** A non-negative integer (pnpm's `u32`/`u64`/`usize`), or its canonical digits. */
export const Unsigned = integer(UNSIGNED, 0, "Expected a non-negative integer");

/** A signed integer (pnpm's `i32`), or its canonical digits. */
export const Integer = integer(SIGNED, undefined, "Expected an integer");

/** A string. */
export const Str = Schema.String;

/** A list of strings. */
export const StringArray = Schema.Array(Schema.String);

/** A mapping of strings to strings. */
export const StringRecord = Schema.Record(Schema.String, Schema.String);

/** Any mapping: the outer shape of a section the catalog does not model further. */
export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A struct that refuses keys it does not declare, whatever decode options the
 * caller passes, as pnpm's `deny_unknown_fields` sections do.
 */
export const closed = <const Fields extends Schema.Struct.Fields>(fields: Fields) => {
	const allowed: ReadonlySet<string> = new Set(Object.keys(fields));
	return UnknownRecord.check(
		Schema.makeFilter((record) => {
			const unknown = Object.keys(record).filter((key) => !allowed.has(key));
			return unknown.length === 0 ? true : `Unknown key${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`;
		}),
	).pipe(Schema.decodeTo(Schema.Struct(fields), SchemaTransformation.passthrough({ strict: false })));
};

/** What an area writes for one entry; `name` comes from its key. */
interface EntryInput<A> {
	readonly schema: Schema.Codec<A, unknown>;
	readonly kind: PnpmSettingKind;
	readonly description: string;
	readonly locations: ReadonlyArray<PnpmSettingLocation>;
	readonly default?: unknown;
	readonly anchor?: string;
}

/** Build one catalog entry. */
export const entry = <A>(name: string, input: EntryInput<A>): PnpmSetting<A> => ({
	name,
	schema: input.schema,
	kind: input.kind,
	description: input.description,
	locations: input.locations,
	default: Object.hasOwn(input, "default") ? Option.some(input.default) : Option.none(),
	anchor: input.anchor ?? "",
});
