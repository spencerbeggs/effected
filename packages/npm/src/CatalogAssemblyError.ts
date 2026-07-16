// The typed failure of catalog *assembly* — reading and validating whatever
// declares a workspace's catalogs — relocated here from `@effected/workspaces`
// so the `CatalogResolver` contract can name it in its error channel and every
// consumer can branch on it without `_tag`-sniffing an untyped defect.
//
// It lives in its own module (rather than beside `CatalogResolver`) for the
// same reason `DependencyResolutionError` lives in `WorkspaceResolver.ts`:
// both resolver modules must be able to reference it without creating an
// import cycle (`noImportCycles` is an error here).

import { Schema } from "effect";

/**
 * Raised when a workspace's catalogs cannot be assembled — a `pnpm-workspace.yaml`
 * that is unreadable or not valid YAML, a root `package.json` `workspaces` field
 * whose shape or catalog blocks are malformed in a way pnpm itself rejects
 * (including the default catalog declared twice), or a config dependency whose
 * `pnpmfile.cjs` cannot be loaded or replayed.
 *
 * @remarks
 * A *missing* `pnpm-workspace.yaml`, an *absent* `workspaces` field, or one
 * explicitly `null` is not an error: there is simply nothing to misread, so
 * assembly yields the empty set. The reader is otherwise **hard-fail by design** —
 * a silently-empty catalog read is the "every dependency looks newly added" bug,
 * because catalog output is load-bearing for snapshot diffing.
 *
 * Defined here, next to the {@link CatalogResolver} contract that raises it,
 * rather than in the implementing package (`@effected/workspaces`): folding it
 * into `DependencyResolutionError`'s defect `cause` forced every consumer to
 * `_tag`-sniff `unknown` to tell an assembly failure from a resolution failure.
 *
 * @public
 */
export class CatalogAssemblyError extends Schema.TaggedErrorClass<CatalogAssemblyError>()("CatalogAssemblyError", {
	/**
	 * Which input failed: `manifest` for a file-level or top-level shape problem,
	 * `catalog` for a malformed catalog block or the double-default duplication,
	 * `hooks` for a config-dependency `pnpmfile.cjs` load or replay failure.
	 */
	source: Schema.Literals(["manifest", "catalog", "hooks"]),
	/** The file, the catalog name, or the config dependency name. */
	path: Schema.String,
	/** The originating failure. */
	cause: Schema.Defect(),
}) {
	/** Renders the failing source into a one-line message. */
	override get message(): string {
		return `Failed to assemble catalogs from ${this.source} ${this.path}`;
	}
}
