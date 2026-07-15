// The one error catalog assembly raises.
//
// Extracted into its own module (rather than living beside `CatalogSet` in
// `WorkspaceCatalogs.ts`) so that both `WorkspaceCatalogs` and the opt-in
// `ConfigDependencyHooks` seam can import it without an import cycle:
// `WorkspaceCatalogs` imports `ConfigDependencyHooks` to wire it, so
// `ConfigDependencyHooks` cannot import back from `WorkspaceCatalogs`. The class
// is still re-exported from `index.ts`, so no consumer sees the move.

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
