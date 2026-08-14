import { IdentityToken, IdentityTokenError } from "@effected/sbom";
import { Effect, Layer } from "effect";
import { OidcTokenIssuer } from "./OidcTokenIssuer.js";

/**
 * The Actions side of `@effected/sbom`'s inverted OIDC contract.
 *
 * @remarks
 * `@effected/sbom` declares `IdentityToken` — one method, one audience,
 * one redacted token — precisely so that signing does not drag the Actions
 * runtime into every consumer that only wants to emit an SBOM. This is the
 * layer that closes the inversion from the other side: it serves that contract
 * from the runner's own OIDC token service ({@link OidcTokenIssuer}), the same
 * arrangement as `@effected/workspaces` implementing `@effected/commands`'
 * `LocalExec`.
 *
 * The audience is forwarded verbatim. `SigstoreSigner` asks its identity
 * contract for the `sigstore` audience itself (`SIGSTORE_OIDC_AUDIENCE` is the
 * signing protocol's requirement, owned there), so nothing here — and nothing
 * in a consumer — needs to spell it.
 *
 * An `OidcTokenError` is rewrapped as `IdentityTokenError` with the
 * original preserved structurally in `cause`, so a refused exchange still says
 * which audience it was minting for **and** why the runner declined —
 * `reason: "unavailable"` almost always means the workflow is missing
 * `permissions: id-token: write`.
 *
 * `@effected/sbom` is an **optional peer** of this package: declare it beside
 * `@effected/github-actions` to use this module or
 * {@link ActionsProvenance}, the only two that resolve it. An action that
 * never attests never installs the supply-chain stack — and importing either
 * module without the declaration fails at the import with module-not-found
 * naming the package.
 *
 * @example
 * ```ts
 * import { ActionsIdentityToken, OidcTokenIssuer } from "@effected/github-actions";
 * import { SigstoreSigner } from "@effected/sbom";
 * import { Layer } from "effect";
 *
 * const signing = SigstoreSigner.layer.pipe(
 *   Layer.provide(ActionsIdentityToken.layer),
 *   Layer.provide(OidcTokenIssuer.layer),
 * );
 * ```
 *
 * @public
 */
export class ActionsIdentityToken {
	private constructor() {}

	/**
	 * `IdentityToken` served by the runner's OIDC token service.
	 *
	 * @remarks
	 * Requires {@link OidcTokenIssuer} rather than composing
	 * `OidcTokenIssuer.layer` in, so an action that already wired the issuer —
	 * every action using `ActionRuntime.layer` has its requirements at hand —
	 * does not construct a second one.
	 */
	static readonly layer: Layer.Layer<IdentityToken, never, OidcTokenIssuer> = Layer.effect(
		IdentityToken,
		Effect.map(OidcTokenIssuer, (issuer) => ({
			token: (audience: string) =>
				issuer.token(audience).pipe(Effect.mapError((cause) => new IdentityTokenError({ audience, cause }))),
		})),
	);
}
