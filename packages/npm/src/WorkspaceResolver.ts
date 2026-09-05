// The `WorkspaceResolver` service contract for resolving pnpm `workspace:`
// specifiers, plus the shared `DependencyResolutionError` both resolver
// contracts raise.
//
// `DependencyResolutionError` is co-located here (rather than in a third
// file) because both `WorkspaceResolver` and `CatalogResolver` reference it
// in their error channel; `CatalogResolver.ts` imports it type-only, so the
// dependency edge runs `CatalogResolver -> WorkspaceResolver` one way and
// `noImportCycles` stays satisfied.

import { Context, Effect, Layer, Option, Schema } from "effect";

/**
 * Raised when a `catalog:` or `workspace:` specifier cannot be resolved
 * because the resolution mechanism itself failed — not for an ordinary
 * unmatched specifier, which resolves to `Option.none()` instead. Both
 * {@link CatalogResolver} and {@link WorkspaceResolver} fail with it.
 *
 * One case sits outside that "mechanism only" reading and belongs here
 * deliberately: a `workspace:` specifier naming a **known member that declares
 * no `version`**. It is not an unmatched specifier — the member exists — so
 * `Option.none()` would tell the caller "not a workspace member", which is
 * false and sends the resolution down a registry path. It fails here instead,
 * naming the specifier.
 *
 * `cause` preserves the originating failure on a structured `Schema.Defect`
 * field rather than folding it into a string, so callers can branch on the
 * original value (an `Error`, a parsed diagnostic, anything); `specifier`
 * records the specifier string that failed to resolve.
 *
 * @public
 */
export class DependencyResolutionError extends Schema.TaggedError<DependencyResolutionError>()(
	"DependencyResolutionError",
	{
		specifier: Schema.String,
		cause: Schema.Defect(),
	},
) {
	/** Renders `specifier` into a one-line failure message. */
	override get message(): string {
		return `Failed to resolve dependency specifier "${this.specifier}"`;
	}
}

/**
 * Contract for resolving pnpm `workspace:` dependency specifiers to concrete
 * versions.
 *
 * `versionOf` takes a workspace package name and has three outcomes:
 * `Option.some(version)` with the member's concrete version (the range
 * modifier stripped); `Option.none()` when the name is **not** a known
 * workspace member; and a typed {@link DependencyResolutionError} when the
 * name **is** a member but its manifest declares no `version`. That third
 * outcome is why the second cannot absorb it — a version-less member is a
 * member, and answering `none` for it would read downstream as "resolve this
 * from the registry instead".
 *
 * This is a contract-only service: {@link WorkspaceResolver.noop} is the
 * sole implementation this package ships, and it resolves nothing. Real
 * consumers (e.g. `@effected/workspaces`) provide a working implementation
 * at the application boundary.
 *
 * @example
 * ```ts
 * import { Effect } from "effect";
 * import { WorkspaceResolver } from "@effected/npm";
 *
 * const program = Effect.gen(function* () {
 *   const resolver = yield* WorkspaceResolver;
 *   return yield* resolver.versionOf("@effected/semver");
 * });
 *
 * Effect.runPromise(Effect.provide(program, WorkspaceResolver.noop));
 * // => Option.none()
 * ```
 *
 * @public
 */
export class WorkspaceResolver extends Context.Service<
	WorkspaceResolver,
	{
		readonly versionOf: (packageName: string) => Effect.Effect<Option.Option<string>, DependencyResolutionError>;
	}
>()("@effected/npm/WorkspaceResolver") {
	/**
	 * No-op default: `versionOf` always succeeds with `Option.none()`, never
	 * consulting an actual workspace. A pure `Layer.succeed`, bound to a
	 * const so it memoizes by reference.
	 */
	static readonly noop: Layer.Layer<WorkspaceResolver> = Layer.succeed(WorkspaceResolver, {
		versionOf: () => Effect.succeed(Option.none()),
	});
}
