/**
 * Effect service contracts for resolving pnpm `catalog:` and `workspace:`
 * dependency specifiers, their pure no-op default layers, and the shared
 * {@link DependencyResolutionError} they raise.
 *
 * @packageDocumentation
 */

import { Layer } from "effect";
import { CatalogResolver } from "./CatalogResolver.js";
import { WorkspaceResolver } from "./WorkspaceResolver.js";

export { CatalogResolver, CatalogResolver_base } from "./CatalogResolver.js";
export {
	DependencyResolutionError,
	DependencyResolutionError_base,
	WorkspaceResolver,
	WorkspaceResolver_base,
} from "./WorkspaceResolver.js";

/**
 * Composite no-op default layer merging {@link CatalogResolver.noop} and
 * {@link WorkspaceResolver.noop}. Provide it once at the application boundary
 * when a consumer only needs the resolver contracts to type-check while
 * resolving nothing (both `rangeOf` and `versionOf` return `Option.none()`).
 *
 * Bound to a const so it memoizes by reference — never expose it through a
 * getter, which would mint a fresh layer per access and defeat memoization.
 *
 * @public
 */
export const Default: Layer.Layer<CatalogResolver | WorkspaceResolver> = Layer.mergeAll(
	CatalogResolver.noop,
	WorkspaceResolver.noop,
);
