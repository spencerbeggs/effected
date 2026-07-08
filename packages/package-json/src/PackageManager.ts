/**
 * The `packageManager` field model: a {@link PackageManager} class parsing
 * `"pnpm@10.33.0+sha512.abc"` into `name` / `version` / `integrity` (a genuine
 * `Option` — absence is computed on by {@link PackageManager.hasIntegrity}),
 * with a {@link PackageManager.FromString} string codec.
 *
 * @packageDocumentation
 */

import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";

/**
 * Schema-generated base class backing {@link PackageManager}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageManager_base: Schema.Class<
	PackageManager,
	Schema.Struct<{
		readonly name: typeof Schema.String;
		readonly version: typeof Schema.String;
		readonly integrity: Schema.Option<typeof Schema.String>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<PackageManager>("PackageManager")({
	/** The package-manager name (e.g. `pnpm`). */
	name: Schema.String,
	/** The version (e.g. `10.33.0`). */
	version: Schema.String,
	/** The optional integrity hash (e.g. `sha512.abc`). */
	integrity: Schema.Option(Schema.String),
});

const PACKAGE_MANAGER_RE = /^([a-z]+)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?)(?:\+(.+))?$/;

/**
 * A structured `packageManager` value with `name`, `version` and an optional
 * `integrity` hash.
 *
 * @public
 */
export class PackageManager extends PackageManager_base {
	/**
	 * Schema transformation between the `"name@version+integrity"` string and a
	 * {@link PackageManager}.
	 */
	static readonly FromString: Schema.Codec<PackageManager, string> = Schema.String.pipe(
		Schema.decodeTo(
			Schema.instanceOf(PackageManager),
			SchemaTransformation.transformOrFail({
				decode: (input: string) => {
					const match = input.match(PACKAGE_MANAGER_RE);
					if (match === null) {
						return Effect.fail(
							new SchemaIssue.InvalidValue(Option.some(input), {
								message: `Invalid packageManager format: "${input}"`,
							}),
						);
					}
					return Effect.succeed(
						PackageManager.make({
							name: match[1],
							version: match[2],
							integrity: match[3] !== undefined ? Option.some(match[3]) : Option.none(),
						}),
					);
				},
				encode: (pm: PackageManager) =>
					Effect.succeed(
						Option.match(pm.integrity, {
							onNone: () => `${pm.name}@${pm.version}`,
							onSome: (integrity) => `${pm.name}@${pm.version}+${integrity}`,
						}),
					),
			}),
		),
	);

	/** Whether an integrity hash is present. */
	get hasIntegrity(): boolean {
		return Option.isSome(this.integrity);
	}
}
