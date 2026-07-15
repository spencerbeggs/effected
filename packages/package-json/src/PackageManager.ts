// The `packageManager` field model: a `PackageManager` class parsing
// `"pnpm@10.33.0+sha512.abc"` into `name` / `version` / `integrity` (a genuine
// `Option` — absence is computed on by `PackageManager.hasIntegrity`), with a
// `PackageManager.FromString` string codec. The integrity half types against
// `@effected/npm`'s `IntegrityHash` brand (the corepack `<algo>.<hex>` form).

import { IntegrityHash } from "@effected/npm";
import { Effect, Exit, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";

const PACKAGE_MANAGER_RE = /^([a-z]+)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?)(?:\+(.+))?$/;

/**
 * A structured `packageManager` value with `name`, `version` and an optional
 * `integrity` hash.
 *
 * @public
 */
export class PackageManager extends Schema.Class<PackageManager>("PackageManager")({
	/** The package-manager name (e.g. `pnpm`). */
	name: Schema.String,
	/** The version (e.g. `10.33.0`). */
	version: Schema.String,
	/** The optional integrity hash (e.g. `sha512.abc`), an `@effected/npm` `IntegrityHash`. */
	integrity: Schema.Option(IntegrityHash),
}) {
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
					const rawIntegrity = match[3];
					if (rawIntegrity === undefined) {
						return Effect.succeed(PackageManager.make({ name: match[1], version: match[2], integrity: Option.none() }));
					}
					// Validate the integrity through the brand so a malformed hash is a typed
					// failure, not the defect `make` would throw on an unbranded value.
					const decoded = Schema.decodeUnknownExit(IntegrityHash)(rawIntegrity);
					if (Exit.isFailure(decoded)) {
						return Effect.fail(
							new SchemaIssue.InvalidValue(Option.some(input), {
								message: `Invalid packageManager integrity: "${rawIntegrity}"`,
							}),
						);
					}
					return Effect.succeed(
						PackageManager.make({ name: match[1], version: match[2], integrity: Option.some(decoded.value) }),
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
