import type { WorkloadCredential } from "@effected/npm";
import { workloadCredential } from "@effected/npm";
import { Effect } from "effect";
import type { ActionOutputs } from "./ActionOutputs.js";
import type { OidcTokenError } from "./OidcTokenIssuer.js";
import { OidcTokenIssuer } from "./OidcTokenIssuer.js";
import { Secret } from "./Secret.js";

/**
 * Registry credentials minted from the runner's own workload identity.
 *
 * @remarks
 * The GitHub Actions half of `@effected/npm`'s workload credential. npm owns
 * the credential's shape and the npmrc write and takes no Actions edge, so it
 * cannot mint or mask; this class does both, so a consumer never holds the
 * identity token or the prefixed value as plaintext and never reaches for
 * `Secret.forSigning` to build one.
 *
 * @example
 * ```ts
 * import { ActionsRegistryCredential } from "@effected/github-actions";
 * import { PackagePublish } from "@effected/npm";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const credential = yield* ActionsRegistryCredential.workload({
 *     audience: "https://registry.example",
 *     prefix: "example_workload_",
 *   });
 *   const publish = yield* PackagePublish;
 *   yield* publish.setupAuth({
 *     registry: "https://registry.example/npm",
 *     credential,
 *     npmrcPath: "/home/runner/.npmrc",
 *   });
 * });
 * ```
 *
 * @public
 */
export class ActionsRegistryCredential {
	private constructor() {}

	/**
	 * Mint a workload identity token for `audience`, mask it and its prefixed
	 * form, and return `@effected/npm`'s `WorkloadCredential`.
	 *
	 * @remarks
	 * In order: the runner's {@link OidcTokenIssuer} mints a token for
	 * `audience` (verbatim — it is the registry's own audience, and a token
	 * minted for another is refused); the bare token is masked; npm's
	 * `workloadCredential` prefixes it; the prefixed value is masked too,
	 * because the runner's log filter matches whole registered values and the
	 * prefixed form is a new one. Both masks are emitted before the credential
	 * is returned, so no later step — the npm subprocess included — can print
	 * either value in clear.
	 *
	 * A mint failure stays an {@link OidcTokenError}, distinct from a later
	 * `PublishError` of kind `"auth"` from `setupAuth`, so a caller can tell
	 * "the runner refused an identity token" from "the npmrc could not be
	 * written". On an issuer failure nothing is masked and nothing is built.
	 *
	 * **In a detached worker the masks are a leak**, exactly as for
	 * {@link Secret.mask}: mint in the parent, where the runner parses stdout.
	 *
	 * @param options - `audience` for the identity token; `prefix` is the
	 *   registry's token prefix, an open string because the vocabulary belongs
	 *   to the registry, not to this kit.
	 */
	static readonly workload: (options: {
		readonly audience: string;
		readonly prefix: string;
	}) => Effect.Effect<WorkloadCredential, OidcTokenError, OidcTokenIssuer | ActionOutputs> = Effect.fn(
		"ActionsRegistryCredential.workload",
	)(function* (options: { readonly audience: string; readonly prefix: string }) {
		// The audience is safe to annotate; neither token value ever is.
		yield* Effect.annotateCurrentSpan({ audience: options.audience });
		const issuer = yield* OidcTokenIssuer;
		const identityToken = yield* issuer.token(options.audience);
		yield* Secret.mask(identityToken);
		const credential = workloadCredential({ audience: options.audience, prefix: options.prefix, identityToken });
		yield* Secret.mask(credential.token);
		return credential;
	});
}
