/**
 * Effect service contracts for resolving pnpm `catalog:` and `workspace:`
 * dependency specifiers: {@link CatalogResolver} and
 * {@link WorkspaceResolver}, their pure no-op default layers, and the shared
 * {@link DependencyResolutionError} they raise. Both contracts are
 * shape-only — this package ships no resolution logic beyond the no-op
 * layers; a consumer at the application boundary (e.g.
 * `@effected/workspaces`) supplies the real implementation.
 *
 * @packageDocumentation
 */

import { Layer } from "effect";
import { CatalogResolver } from "./CatalogResolver.js";
import { WorkspaceResolver } from "./WorkspaceResolver.js";

export { CatalogResolver } from "./CatalogResolver.js";
export {
	DependencyField,
	DependencyKind,
	DependencySection,
} from "./DependencySection.js";
export {
	CatalogSpecifier,
	type ClassifiedSpecifier,
	type DependencyProtocol,
	DependencySpecifier,
	type DependencySpecifierBrand,
	DistTagSpecifier,
	InvalidDependencySpecifierError,
	RangeSpecifier,
	RawSpecifier,
	WorkspaceSpecifier,
	isValidDependencySpecifier,
} from "./DependencySpecifier.js";
export {
	type IntegrityAlgorithm,
	IntegrityHash,
	type IntegrityHashBrand,
	InvalidIntegrityHashError,
	isValidIntegrityHash,
} from "./IntegrityHash.js";
export { DependencyResolutionError, WorkspaceResolver } from "./WorkspaceResolver.js";

/**
 * Composite no-op default layer merging {@link CatalogResolver.noop} and
 * {@link WorkspaceResolver.noop}. Provide it once at the application boundary
 * when a consumer only needs the resolver contracts to type-check while
 * resolving nothing (both `rangeOf` and `versionOf` return `Option.none()`).
 *
 * Bound to a const so it memoizes by reference — never expose it through a
 * getter, which would mint a fresh layer per access and defeat memoization.
 *
 * @example
 * ```ts
 * import { Effect, Option } from "effect";
 * import { CatalogResolver, Default, WorkspaceResolver } from "@effected/npm";
 *
 * const program = Effect.gen(function* () {
 *   const catalog = yield* CatalogResolver;
 *   const workspace = yield* WorkspaceResolver;
 *   return yield* Effect.all([
 *     catalog.rangeOf("effect", Option.none()),
 *     workspace.versionOf("@effected/semver"),
 *   ]);
 * });
 *
 * Effect.runPromise(Effect.provide(program, Default));
 * // => [Option.none(), Option.none()]
 * ```
 *
 * @public
 */
export const Default: Layer.Layer<CatalogResolver | WorkspaceResolver> = Layer.mergeAll(
	CatalogResolver.noop,
	WorkspaceResolver.noop,
);
