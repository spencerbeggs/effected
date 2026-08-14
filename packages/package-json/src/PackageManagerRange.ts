// The range-tolerant `packageManager` field model: a `PackageManagerRange`
// class parsing `"pnpm@^11.20.0"` (or an exact `"pnpm@11.2.0"`) into
// `name` / `range` / `integrity`, with a `PackageManagerRange.FromString`
// string codec.
//
// The strict `PackageManager` models what corepack provisions — an exact,
// pinnable version. pnpm's own reading of the field is wider: with
// `manage-package-manager-versions` it accepts a semver *range* and resolves
// it itself, and manifests carrying `pnpm@^11.20.0` exist in the wild
// (probe-verified by the silk-update-action consumer, #286). This class models
// that wider field without weakening the strict one: the range text is carried
// **verbatim** (the `Repository` posture — fidelity first, interpretation as
// derived getters), validated only to parse as a semver range, and `isExact`
// reports whether it is in fact an exact pinnable version.
//
// The grammar shares the strict form's one load-bearing rule: the FIRST `+`
// after the `@` begins the integrity component, never semver build metadata.
// A range whose own text would carry `+` build metadata in a comparator
// therefore cannot be expressed in this field — the field's grammar owns `+`.

import { CorepackIntegrityHash } from "@effected/npm";
import { Range, SemVer } from "@effected/semver";
import { Effect, Exit, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";

// The name half of the grammar — identical latitude to `PackageManager`'s
// (any lowercase name); see that class's remarks for the evidence.
const PACKAGE_MANAGER_NAME_RE = /^[a-z]+$/;

const invalid = (input: string, message: string) => Effect.fail(new SchemaIssue.InvalidValue({ message }, input));

/** `Schema.String` refined to parse as a semver range (`Range.parseResult` succeeds). The check is erased from the built type. */
const SemVerRangeString: Schema.String = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			value.length > 0 && Result.isSuccess(Range.parseResult(value))
				? undefined
				: "Expected a semver range (an exact version, a caret/tilde range, a comparator set, ...)",
		),
	),
);

/**
 * A structured `packageManager` value whose version position is a semver
 * **range**, carried verbatim: `name`, `range` and an optional `integrity`
 * hash.
 *
 * @remarks
 * The range-tolerant sibling of {@link PackageManager}. The strict class
 * models the corepack pin — an exact version, which is all corepack itself
 * accepts — and stays strict; this class models the field as pnpm reads it,
 * where a range such as `^11.20.0` is a supported spelling that pnpm resolves
 * to a concrete version. An exact version is a valid range, so every string
 * the strict codec accepts decodes here too; {@link PackageManagerRange.isExact}
 * is how a caller tracks which form the manifest actually carried.
 *
 * The `range` field is the manifest's text **verbatim** — validated to parse
 * as a semver range but never normalized, so encoding is byte-identical to
 * the accepted input and reading a manifest never rewrites the field.
 * Interpretation is a derived getter, following `Repository`'s
 * carry-verbatim posture.
 *
 * The first `+` after the `@` begins the integrity component, exactly as in
 * the strict grammar — the version position of this field never carries
 * semver build metadata.
 *
 * @example
 * ```ts
 * import { PackageManagerRange } from "@effected/package-json";
 * import { Effect, Schema } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const pm = yield* Schema.decodeUnknownEffect(PackageManagerRange.FromString)("pnpm@^11.20.0");
 *   console.log(pm.name, pm.range, pm.isExact); // "pnpm" "^11.20.0" false
 * });
 * ```
 *
 * @public
 */
export class PackageManagerRange extends Schema.Class<PackageManagerRange>("PackageManagerRange")({
	/** The package-manager name (e.g. `pnpm`). Any lowercase name — the same latitude as {@link PackageManager}, for the same evidence. */
	name: Schema.String,
	/**
	 * The version position, verbatim: a semver range (`^11.20.0`,
	 * `>=10 <12`, ...) or an exact version (`11.2.0`). Validated to parse
	 * through `@effected/semver`'s `Range.parseResult`; never normalized, so
	 * the field round-trips byte-identically.
	 */
	range: SemVerRangeString,
	/**
	 * The optional integrity hash (e.g. `sha512.abc`): `@effected/npm`'s
	 * `CorepackIntegrityHash`. Meaningful only alongside an exact range —
	 * an integrity pins one artifact — but carried whenever the manifest
	 * carries it, because fidelity outranks plausibility in a field model.
	 */
	integrity: Schema.Option(CorepackIntegrityHash),
}) {
	/**
	 * Schema transformation between the `"name@range[+integrity]"` string and a
	 * {@link PackageManagerRange}.
	 *
	 * @remarks
	 * Decoding splits on the first `@`, then on the first `+` — which always
	 * begins the integrity, never semver build metadata — and validates each
	 * component: the name against the lowercase grammar, the range through
	 * `@effected/semver`'s `Range.parseResult`, the integrity through
	 * `CorepackIntegrityHash`. Every failure is a typed decode failure naming
	 * the component that failed. Encoding reconstructs the string from the
	 * verbatim parts, so it is byte-identical to any input this codec accepts.
	 */
	static readonly FromString: Schema.Codec<PackageManagerRange, string> = Schema.String.pipe(
		Schema.decodeTo(
			Schema.instanceOf(PackageManagerRange),
			SchemaTransformation.transformOrFail({
				decode: (input: string) => {
					const at = input.indexOf("@");
					if (at === -1) {
						return invalid(input, `Invalid packageManager format: "${input}"`);
					}
					const name = input.slice(0, at);
					if (!PACKAGE_MANAGER_NAME_RE.test(name)) {
						return invalid(input, `Invalid packageManager name: "${name}"`);
					}
					const rest = input.slice(at + 1);
					// The first `+` begins the integrity component, unconditionally —
					// the version position of this field never carries build metadata.
					const plus = rest.indexOf("+");
					const range = plus === -1 ? rest : rest.slice(0, plus);
					// An empty range (`pnpm@`) is a format error, not the `*` node-semver
					// coerces an empty string to — coercion would be a silent edit.
					if (range.length === 0 || Result.isFailure(Range.parseResult(range))) {
						return invalid(input, `Invalid packageManager range: "${range}"`);
					}
					if (plus === -1) {
						return Effect.succeed(PackageManagerRange.make({ name, range, integrity: Option.none() }));
					}
					// Validate the integrity through the corepack-restricted schema so a
					// malformed hash is a typed failure, not the defect `make` would
					// throw on a value the field schema rejects.
					const rawIntegrity = rest.slice(plus + 1);
					const decoded = Schema.decodeUnknownExit(CorepackIntegrityHash)(rawIntegrity);
					if (Exit.isFailure(decoded)) {
						return invalid(input, `Invalid packageManager integrity: "${rawIntegrity}"`);
					}
					return Effect.succeed(PackageManagerRange.make({ name, range, integrity: Option.some(decoded.value) }));
				},
				encode: (pm: PackageManagerRange) =>
					Effect.succeed(
						Option.match(pm.integrity, {
							onNone: () => `${pm.name}@${pm.range}`,
							onSome: (integrity) => `${pm.name}@${pm.range}+${integrity}`,
						}),
					),
			}),
		),
	);

	/**
	 * Whether the range is an exact, pinnable version (`11.2.0`) rather than a
	 * genuine range (`^11.20.0`) — decided by `SemVer.isPinnable` over the
	 * verbatim text, so `=11.2.0` and other range spellings of a single
	 * version report `false`. This is the exactness a consumer tracks when it
	 * must re-emit the same spelling it read.
	 */
	get isExact(): boolean {
		return SemVer.isPinnable(this.range);
	}

	/** Whether an integrity hash is present. */
	get hasIntegrity(): boolean {
		return Option.isSome(this.integrity);
	}
}
