// The corepack pin triple `<name>@<version>[+<integrity>]` as a first-class
// schema — e.g. `pnpm@11.17.0+sha512.abc…`. Previously the grammar existed only
// as `@effected/package-json`'s `PackageManager.FromString` (bound to the
// `packageManager` field); this module gives the triple itself a reusable home
// beside the dependency vocabulary that already lives here (`IntegrityHash`,
// `DependencySpecifier`).
//
// The one load-bearing grammar rule: the FIRST `+` after the version always
// begins the integrity component. A pin's version NEVER carries semver build
// metadata — `pnpm@11.17.0+sha512.abc` is version `11.17.0` plus integrity
// `sha512.abc`, and a malformed tail after a `+` is a typed failure, never a
// fallback to build-metadata parsing.

import { SemVer } from "@effected/semver";
import { Effect, Exit, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect";
import { IntegrityHash } from "./IntegrityHash.js";

/**
 * Indicates that a string could not be parsed as a corepack package-manager
 * pin (`<name>@<version>[+<integrity>]`).
 *
 * Raised by {@link PackageManagerPin.parse} and
 * {@link PackageManagerPin.parseResult}; the decode direction of
 * {@link PackageManagerPin.FromString} reports the same failure through a
 * generic `Schema` parse error carrying the same message. The offending string
 * is preserved on `input`; `reason` says which component failed.
 *
 * @public
 */
export class InvalidPackageManagerPinError extends Schema.TaggedErrorClass<InvalidPackageManagerPinError>()(
	"InvalidPackageManagerPinError",
	{
		/** The raw input string that failed validation. */
		input: Schema.String,
		/**
		 * Which component of the pin failed: `format` (no `@` separator at all),
		 * `name` (not one of the four supported package managers), `version` (not
		 * an exact SemVer 2.0.0 version — ranges, partial versions and dist-tags
		 * all land here), or `integrity` (the tail after `+` is not a corepack
		 * `<algo>.<hex>` hash).
		 */
		reason: Schema.Literals(["format", "name", "version", "integrity"]),
	},
) {
	override get message(): string {
		return this.reason === "format"
			? `Invalid package-manager pin "${this.input}": expected <name>@<version>[+<integrity>]`
			: this.reason === "name"
				? `Invalid package-manager pin "${this.input}": name must be one of npm, pnpm, yarn, bun`
				: this.reason === "version"
					? `Invalid package-manager pin "${this.input}": version must be an exact SemVer version (ranges, partial versions and dist-tags are not pinnable)`
					: `Invalid package-manager pin "${this.input}": integrity must be a corepack <algo>.<hex> hash`;
	}
}

/**
 * The four package managers a corepack pin can name.
 *
 * @remarks
 * Structurally identical to `@effected/workspaces`' `PackageManagerName` and
 * `@effected/commands`' `Launcher`, and assigns freely to both. It is
 * deliberately a mirror, not an import: either edge would point from this
 * package at a downstream consumer and invert the dependency tiers — the same
 * posture `@effected/github-actions`' `CheckState` takes toward
 * `@effected/github`'s conclusion literals.
 *
 * @public
 */
export const PackageManagerPinName = Schema.Literals(["npm", "pnpm", "yarn", "bun"]);

/**
 * The decoded type of {@link (PackageManagerPinName:variable)}:
 * `"npm" | "pnpm" | "yarn" | "bun"`.
 *
 * @public
 */
export type PackageManagerPinName = typeof PackageManagerPinName.Type;

const isPinName = (value: string): value is PackageManagerPinName =>
	value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";

// A pin's version is an exact SemVer version with NO build metadata: the pin
// grammar cannot express it (the first `+` always begins the integrity), so a
// constructed version carrying build identifiers would encode to a string that
// re-parses differently. Rejecting it at the field keeps decode/encode sound.
const pinVersion = SemVer.pipe(
	Schema.check(
		Schema.makeFilter((version: SemVer) =>
			version.build.length === 0 ? undefined : "Expected a version without build metadata",
		),
	),
);

// A pin only ever carries corepack's `<algo>.<hex>` integrity form (the
// `name@version+sha512.<hex>` tail). Restrict the `IntegrityHash` brand —
// which also admits the SRI and yarn forms — to just the corepack shape, the
// same restriction `@effected/package-json` applies to its `packageManager`
// field.
const corepackIntegrity = IntegrityHash.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			IntegrityHash.isCorepack(value) ? undefined : "Expected a corepack (<algo>.<hex>) integrity hash",
		),
	),
);

/**
 * A corepack package-manager pin: the `<name>@<version>[+<integrity>]` triple
 * (e.g. `pnpm@11.17.0+sha512.abc…`), independent of any `package.json` field.
 *
 * `version` is an exact `@effected/semver` `SemVer` — prerelease versions are
 * pinnable (`pnpm@10.0.0-rc.1` is a valid pin), ranges, partial versions and
 * dist-tags are not, and build metadata is impossible by grammar: the first
 * `+` after the version always begins the integrity component, so
 * `pnpm@11.17.0+sha512.abc` is version `11.17.0` plus integrity `sha512.abc`,
 * never version `11.17.0+sha512.abc`. `integrity`, when present, is an
 * {@link (IntegrityHash:variable)} restricted to the corepack `<algo>.<hex>`
 * form.
 *
 * @example
 * ```ts
 * import { PackageManagerPin } from "@effected/npm";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const pin = yield* PackageManagerPin.parse("pnpm@11.17.0+sha512.deadbeef");
 *   return [pin.name, pin.version.toString(), pin.integrity] as const;
 * });
 *
 * console.log(Effect.runSync(program));
 * // => ["pnpm", "11.17.0", "sha512.deadbeef"]
 * ```
 *
 * @public
 */
export class PackageManagerPin extends Schema.Class<PackageManagerPin>("PackageManagerPin")({
	/** The package-manager name (`npm`, `pnpm`, `yarn` or `bun`). */
	name: PackageManagerPinName,
	/**
	 * The exact pinned version. Never carries build metadata — the pin grammar
	 * cannot express it (see the class remarks), and a version constructed with
	 * build identifiers is rejected at construction.
	 */
	version: pinVersion,
	/**
	 * The optional integrity hash (e.g. `sha512.abc…`): an `IntegrityHash`
	 * restricted to the corepack `<algo>.<hex>` form. Absent when the pin
	 * carries no `+<integrity>` tail — never present-but-`undefined`.
	 */
	integrity: Schema.optionalKey(corepackIntegrity),
}) {
	/**
	 * Schema transformation between the `<name>@<version>[+<integrity>]` string
	 * and a {@link PackageManagerPin}. Decoding parses via
	 * {@link PackageManagerPin.parseResult} (the three surfaces share one
	 * grammar and cannot diverge); encoding prints the canonical pin string.
	 */
	static readonly FromString: Schema.Codec<PackageManagerPin, string> = Schema.String.pipe(
		Schema.decodeTo(
			Schema.instanceOf(PackageManagerPin),
			SchemaTransformation.transformOrFail({
				decode: (input: string) => {
					const parsed = PackageManagerPin.parseResult(input);
					return Result.isSuccess(parsed)
						? Effect.succeed(parsed.success)
						: Effect.fail(new SchemaIssue.InvalidValue(Option.some(input), { message: parsed.failure.message }));
				},
				encode: (pin: PackageManagerPin) => Effect.succeed(pin.toString()),
			}),
		),
	);

	/**
	 * Parse a corepack pin string, synchronously, returning a `Result` instead
	 * of an `Effect`.
	 *
	 * The first `+` after the version always begins the integrity component: a
	 * pin's version never carries semver build metadata, and a malformed tail
	 * after a `+` fails with `reason: "integrity"` rather than falling back to
	 * build-metadata parsing. Prerelease versions are accepted; ranges
	 * (`^9.0.0`), partial versions (`9`, `9.1`) and dist-tags (`latest`,
	 * `berry`) fail with `reason: "version"`.
	 *
	 * @remarks
	 * {@link PackageManagerPin.parse} is defined in terms of this function; the
	 * two never diverge. Reach for the `Effect` variant inside Effect code — it
	 * carries the `PackageManagerPin.parse` tracing span — and for this one at
	 * synchronous boundaries.
	 *
	 * @param input - the pin string to parse
	 * @returns a `Result` succeeding with the parsed {@link PackageManagerPin},
	 * or failing with {@link InvalidPackageManagerPinError} when `input` is not
	 * a valid pin.
	 */
	static parseResult(input: string): Result.Result<PackageManagerPin, InvalidPackageManagerPinError> {
		const at = input.indexOf("@");
		if (at === -1) {
			return Result.fail(new InvalidPackageManagerPinError({ input, reason: "format" }));
		}
		const name = input.slice(0, at);
		if (!isPinName(name)) {
			return Result.fail(new InvalidPackageManagerPinError({ input, reason: "name" }));
		}
		const rest = input.slice(at + 1);
		// The first `+` begins the integrity component, unconditionally — the
		// version part of a pin never carries build metadata.
		const plus = rest.indexOf("+");
		const version = SemVer.parseResult(plus === -1 ? rest : rest.slice(0, plus));
		if (Result.isFailure(version)) {
			return Result.fail(new InvalidPackageManagerPinError({ input, reason: "version" }));
		}
		if (plus === -1) {
			return Result.succeed(PackageManagerPin.make({ name, version: version.success }));
		}
		const integrity = Schema.decodeUnknownExit(corepackIntegrity)(rest.slice(plus + 1));
		if (Exit.isFailure(integrity)) {
			return Result.fail(new InvalidPackageManagerPinError({ input, reason: "integrity" }));
		}
		return Result.succeed(PackageManagerPin.make({ name, version: version.success, integrity: integrity.value }));
	}

	/**
	 * Parse a corepack pin string. Defined in terms of
	 * {@link PackageManagerPin.parseResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @param input - the pin string to parse
	 * @returns the parsed {@link PackageManagerPin}. Fails with
	 * {@link InvalidPackageManagerPinError} when `input` is not a valid pin.
	 */
	static readonly parse = Effect.fn("PackageManagerPin.parse")((input: string) =>
		Effect.fromResult(PackageManagerPin.parseResult(input)),
	);

	/**
	 * The canonical pin string: `<name>@<version>` or
	 * `<name>@<version>+<integrity>`. The encode direction of
	 * {@link PackageManagerPin.FromString} prints exactly this.
	 */
	override toString(): string {
		const base = `${this.name}@${this.version.toString()}`;
		return this.integrity === undefined ? base : `${base}+${this.integrity}`;
	}
}
