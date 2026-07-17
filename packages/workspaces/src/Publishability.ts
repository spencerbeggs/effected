// Whether a workspace package is publishable, and where to.
//
// A service rather than a function precisely so it is swappable: standard npm
// semantics are the default, and an organization with its own publish rules
// replaces the layer with `Layer.succeed` instead of forking the package. The
// v3 README made that its headline layer-DI example; it stays true here.

import { Context, Effect, Layer, Schema } from "effect";
import type { WorkspacePackage } from "./WorkspacePackage.js";

/** The public npm registry, used when `publishConfig.registry` says nothing. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

/**
 * A resolved publish destination for a workspace package.
 *
 * @public
 */
export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
	/** The package name being published. */
	name: Schema.NonEmptyString,
	/** The registry URL. */
	registry: Schema.NonEmptyString,
	/** The directory to publish, relative to the package root; `"."` for the root itself. */
	directory: Schema.String,
	/** Scoped-package visibility. */
	access: Schema.Literals(["public", "restricted"]),
	/** Whether to publish with a provenance attestation. */
	provenance: Schema.Boolean.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false)),
		Schema.withConstructorDefault(Effect.succeed(false)),
	),
}) {}

/**
 * The {@link PublishabilityDetector} service shape.
 *
 * @remarks
 * The error channel is deliberately `never`: every consumer of the service —
 * a release planner iterating a whole workspace — treats "does this publish"
 * as a total question, so an overriding layer whose lookup can fail must
 * **degrade or die**. Fold a recoverable failure into a safe answer (usually
 * the empty target list), or `Effect.orDie` it into the defect channel; it
 * cannot widen the channel the contract declares. See
 * {@link PublishabilityDetector} for the adapter an overriding consumer
 * writes.
 *
 * @public
 */
export interface PublishabilityDetectorShape {
	/** The publish targets for a package; empty means it does not publish. */
	readonly detect: (pkg: WorkspacePackage) => Effect.Effect<ReadonlyArray<PublishTarget>>;
}

/**
 * Decides whether a workspace package publishes, and to where.
 *
 * @remarks
 * The default layer implements standard npm semantics: a `private` package with
 * no `publishConfig.access` publishes nowhere; an explicit
 * `publishConfig.access` overrides `private`; anything else publishes to the
 * public registry with defaults.
 *
 * Those are *npm's* semantics, not necessarily yours. Swap the layer:
 *
 * @example
 * ```ts
 * import { PublishabilityDetector, PublishTarget } from "@effected/workspaces";
 * import { Effect, Layer } from "effect";
 *
 * const internalOnly = Layer.succeed(PublishabilityDetector, {
 *   detect: (pkg) =>
 *     Effect.succeed(
 *       pkg.name.startsWith("@acme/")
 *         ? [PublishTarget.make({
 *             name: pkg.name,
 *             registry: "https://npm.acme.internal/",
 *             directory: ".",
 *             access: "restricted",
 *           })]
 *         : [],
 *     ),
 * });
 * ```
 *
 * @example
 * The shape's error channel is `never` — **degrade or die**. An override
 * backed by something fallible (a policy service, a registry probe) folds its
 * failure structurally over `{ readonly message: string }` — matching every
 * `Error`, every Effect schema error class, and anything else carrying a
 * message — and either degrades to a safe answer or dies:
 *
 * ```ts
 * import { PublishabilityDetector, PublishTarget } from "@effected/workspaces";
 * import { Effect, Layer } from "effect";
 *
 * declare const lookupPolicy: (
 *   name: string,
 * ) => Effect.Effect<ReadonlyArray<PublishTarget>, { readonly message: string }>;
 *
 * const fromPolicyService = Layer.succeed(PublishabilityDetector, {
 *   detect: (pkg) =>
 *     lookupPolicy(pkg.name).pipe(
 *       Effect.catch((error) =>
 *         Effect.die(new Error(`publishability policy lookup failed for ${pkg.name}: ${error.message}`)),
 *       ),
 *     ),
 * });
 * ```
 *
 * A lookup failure that should *not* abort the run degrades instead —
 * `Effect.catch(() => Effect.succeed([]))` reads as "unknown means
 * unpublishable" — but pick one deliberately; silently swallowing the failure
 * into a wrong "publishes to npm" answer is the one option the contract
 * forbids.
 *
 * @public
 */
export class PublishabilityDetector extends Context.Service<PublishabilityDetector, PublishabilityDetectorShape>()(
	"@effected/workspaces/PublishabilityDetector",
) {
	/** Standard npm publishing semantics. Pure — no filesystem, no platform services. */
	static readonly layer: Layer.Layer<PublishabilityDetector> = Layer.succeed(PublishabilityDetector, {
		detect: (pkg: WorkspacePackage) =>
			Effect.sync(() => {
				const config = pkg.publishConfig;
				const access = config?.access;

				// Private and silent about access: npm will not publish it.
				if (pkg.private && access === undefined) return [] as ReadonlyArray<PublishTarget>;

				return [
					PublishTarget.make({
						name: pkg.name,
						registry: config?.registry ?? DEFAULT_REGISTRY,
						directory: config?.directory ?? ".",
						access: access ?? "public",
						provenance: false,
					}),
				];
			}),
	});
}
