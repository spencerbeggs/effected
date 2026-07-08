/**
 * The `CatalogResolver` service contract for resolving pnpm `catalog:`
 * specifiers, plus its no-op default layer.
 *
 * The {@link DependencyResolutionError} it raises lives in `WorkspaceResolver.ts`
 * and is imported type-only here, so the only runtime edge runs
 * `CatalogResolver → WorkspaceResolver` and `noImportCycles` stays satisfied.
 *
 * @packageDocumentation
 */

import { Context, Effect, Layer, Option } from "effect";
import type { DependencyResolutionError } from "./WorkspaceResolver.js";

/**
 * Service-key base backing {@link CatalogResolver}. Not meant to be referenced
 * directly — named and exported only so API Extractor can resolve the heritage
 * clause of the class it backs.
 *
 * @public
 */
export const CatalogResolver_base: Context.ServiceClass<
	CatalogResolver,
	"@effected/npm/CatalogResolver",
	{
		readonly rangeOf: (
			packageName: string,
			catalog: Option.Option<string>,
		) => Effect.Effect<Option.Option<string>, DependencyResolutionError>;
	}
> = Context.Service<
	CatalogResolver,
	{
		readonly rangeOf: (
			packageName: string,
			catalog: Option.Option<string>,
		) => Effect.Effect<Option.Option<string>, DependencyResolutionError>;
	}
>()("@effected/npm/CatalogResolver");

/**
 * Resolves pnpm `catalog:` specifiers. Given a package name and an optional
 * catalog name (`Option.none()` = the default catalog), `rangeOf` returns the
 * configured range as `Option.some`, or `Option.none()` if it cannot be
 * resolved.
 *
 * The package ships {@link CatalogResolver.noop} — a pure no-op layer that
 * resolves nothing — as its default. Real consumers (e.g. `@effected/workspaces`)
 * provide an implementation at the application boundary.
 *
 * @public
 */
export class CatalogResolver extends CatalogResolver_base {
	/**
	 * No-op default layer: `rangeOf` always succeeds with `Option.none()`.
	 * A pure `Layer.succeed`, bound to a const so it memoizes by reference.
	 */
	static readonly noop: Layer.Layer<CatalogResolver> = Layer.succeed(CatalogResolver, {
		rangeOf: () => Effect.succeed(Option.none()),
	});
}
