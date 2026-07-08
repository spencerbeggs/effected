/**
 * The `WorkspaceResolver` service contract for resolving pnpm `workspace:`
 * specifiers, plus the shared {@link DependencyResolutionError} both resolver
 * contracts raise.
 *
 * `DependencyResolutionError` is co-located here (rather than in a third file)
 * because both {@link WorkspaceResolver} and `CatalogResolver` reference it in
 * their error channel; `CatalogResolver.ts` imports it type-only, so the
 * dependency edge runs `CatalogResolver → WorkspaceResolver` one way and
 * `noImportCycles` stays satisfied.
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Context, Effect, Layer, Option, Schema } from "effect";

/**
 * Schema-generated base class backing {@link DependencyResolutionError}. Not
 * meant to be referenced directly — named and exported only so API Extractor
 * can resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const DependencyResolutionError_base: Schema.Class<
	DependencyResolutionError,
	Schema.TaggedStruct<
		"DependencyResolutionError",
		{
			readonly specifier: typeof Schema.String;
			readonly cause: Schema.Defect;
		}
	>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<DependencyResolutionError>()("DependencyResolutionError", {
	specifier: Schema.String,
	cause: Schema.Defect(),
});

/**
 * Raised when a `catalog:` or `workspace:` specifier cannot be resolved to a
 * concrete range or version. Both {@link CatalogResolver} and
 * {@link WorkspaceResolver} fail with it.
 *
 * The originating failure is preserved on the structured `cause` field (a
 * `Schema.Defect`, never a stringified message), so callers can branch on it;
 * `specifier` records the specifier string that failed.
 *
 * @public
 */
export class DependencyResolutionError extends DependencyResolutionError_base {
	override get message(): string {
		return `Failed to resolve dependency specifier "${this.specifier}"`;
	}
}

/**
 * Service-key base backing {@link WorkspaceResolver}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const WorkspaceResolver_base: Context.ServiceClass<
	WorkspaceResolver,
	"@effected/npm/WorkspaceResolver",
	{
		readonly versionOf: (packageName: string) => Effect.Effect<Option.Option<string>, DependencyResolutionError>;
	}
> = Context.Service<
	WorkspaceResolver,
	{
		readonly versionOf: (packageName: string) => Effect.Effect<Option.Option<string>, DependencyResolutionError>;
	}
>()("@effected/npm/WorkspaceResolver");

/**
 * Resolves pnpm `workspace:` specifiers. Given a workspace package name,
 * `versionOf` returns its concrete version (without the range modifier) as
 * `Option.some`, or `Option.none()` if it cannot be resolved.
 *
 * The package ships {@link WorkspaceResolver.noop} — a pure no-op layer that
 * resolves nothing — as its default. Real consumers (e.g. `@effected/workspaces`)
 * provide an implementation at the application boundary.
 *
 * @public
 */
export class WorkspaceResolver extends WorkspaceResolver_base {
	/**
	 * No-op default layer: `versionOf` always succeeds with `Option.none()`.
	 * A pure `Layer.succeed`, bound to a const so it memoizes by reference.
	 */
	static readonly noop: Layer.Layer<WorkspaceResolver> = Layer.succeed(WorkspaceResolver, {
		versionOf: () => Effect.succeed(Option.none()),
	});
}
