import { DependencyField, DependencySpecifier } from "@effected/npm";
import { Schema } from "effect";

/**
 * One declared dependency of one workspace importer, as the lockfile records it.
 *
 * @remarks
 * - `name` — the dependency's package name.
 * - `specifier` — the declared range, typed through `@effected/npm`'s
 *   `DependencySpecifier.FromString` codec: the decoded value is a tag-matchable
 *   `ClassifiedSpecifier` (`catalog:` / `workspace:` / range / dist-tag / raw),
 *   while encoding round-trips the **exact original string byte-for-byte** — the
 *   guarantee a before/after lockfile diff relies on.
 * - `version` — the concrete resolved version, **populated by pnpm only**. pnpm
 *   records `{ specifier, version }` per importer dependency; bun and npm record
 *   resolved versions on their package entries instead, so for those formats
 *   `version` is absent and a consumer joins by `name` against
 *   `Lockfile.packages`.
 * - `depType` — which dependency map declared it, spelled with `@effected/npm`'s
 *   kit-wide `DependencyField` vocabulary.
 *
 * @public
 */
export class ImporterDependency extends Schema.Class<ImporterDependency>("ImporterDependency")({
	name: Schema.NonEmptyString,
	specifier: DependencySpecifier.FromString,
	version: Schema.optionalKey(Schema.String),
	depType: DependencyField,
}) {}
