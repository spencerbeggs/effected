import { Redacted, Result, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";

/**
 * A bearer token — npm's `_authToken`, and the form every modern registry
 * documents first.
 *
 * @public
 */
export interface TokenCredential {
	readonly kind: "token";
	/** The token, verbatim. Never written to argv. */
	readonly token: Redacted.Redacted<string>;
}

/**
 * HTTP basic auth — npm's `_auth`, carried as the **already-encoded** blob.
 *
 * @remarks
 * The credential is base64 of `user:password`, and this type deliberately holds
 * it **encoded rather than as a pair**, because that is what npm itself stores
 * and what registry configuration in the wild already contains. npm assigns the
 * `_auth` value straight to the `Authorization: Basic …` header with no decode
 * step; splitting it back into a pair in order to re-encode it would mean
 * decoding a secret for no purpose, and is lossy in principle for a password
 * containing `:`.
 *
 * {@link basicCredentialFromPairResult} exists for the caller who genuinely
 * holds a pair — but this shape is the primitive, not that one.
 *
 * @public
 */
export interface BasicCredential {
	readonly kind: "basic";
	/** Base64 of `user:password`, exactly as it belongs in an npmrc `_auth`. */
	readonly encoded: Redacted.Redacted<string>;
}

/**
 * A short-lived registry token minted from a CI workload identity — written to
 * npm's `_authToken`, and accepted by `PackagePublish.setupAuth` only.
 *
 * @remarks
 * Some registries accept a workload's OIDC identity token directly, behind a
 * registry-specific prefix (`<prefix><jwt>`), instead of a long-lived token.
 * The value goes out exactly as a bearer token does, so the npmrc key is
 * `_authToken` — but it is a **publish** credential: it is minted per publish
 * target, it expires within minutes, and the audience it was minted for is the
 * registry it may be spent on. It is therefore deliberately **not** a
 * {@link RegistryCredential}: a read site (`RegistryTarget.credential`) that is
 * handed one fails to compile, and `NpmRegistry` refuses one at runtime for a
 * caller that casts past the type.
 *
 * Build one with {@link workloadCredential}. Masking the identity token and
 * the prefixed value in a CI log is the caller's job; on GitHub Actions,
 * `@effected/github-actions`' `ActionsRegistryCredential.workload` mints,
 * masks both and builds this value in one step.
 *
 * @public
 */
export interface WorkloadCredential {
	readonly kind: "workload";
	/** The audience the identity token was minted for. Safe to log; the token is not. */
	readonly audience: string;
	/** The full prefixed value, exactly as it belongs in an npmrc `_authToken`. */
	readonly token: Redacted.Redacted<string>;
}

/**
 * How to authenticate to a registry.
 *
 * @remarks
 * Both npmrc spellings npm supports for a registry, as a closed union so the
 * npmrc key and the HTTP scheme are chosen together. A read probe and a publish
 * that disagreed about the scheme would authenticate differently against the
 * same registry, which is the class of bug this union exists to make
 * unrepresentable.
 *
 * @public
 */
export type RegistryCredential = TokenCredential | BasicCredential;

/**
 * Every credential `PackagePublish.setupAuth` can write into an npmrc.
 *
 * @remarks
 * {@link RegistryCredential} widened by the publish-only
 * {@link WorkloadCredential}. A separate name rather than a wider
 * `RegistryCredential`, so every read site that already types a credential as
 * `RegistryCredential` keeps compiling and keeps refusing a workload
 * credential at compile time.
 *
 * @public
 */
export type PublishCredential = RegistryCredential | WorkloadCredential;

/**
 * A username and password could not be encoded as a {@link BasicCredential}.
 *
 * @remarks
 * `reason` is the routing surface. `"colon-in-username"`: basic auth joins
 * the pair as `user:password` and the server splits it at the first `:`, so a
 * username containing one would authenticate as a different user. The
 * username is runtime data (configuration, a secret store), so refusing it is
 * an expected failure in the typed channel, never a throw.
 *
 * @public
 */
export class BasicCredentialError extends Schema.TaggedError<BasicCredentialError>()("BasicCredentialError", {
	/** Why the pair could not be encoded. */
	reason: Schema.Literals(["colon-in-username"]),
}) {
	override get message(): string {
		return "A basic-auth username cannot contain a colon";
	}
}

/**
 * A {@link BasicCredential} from a username and password, encoding for you.
 *
 * @remarks
 * A convenience over the primitive, for the caller that holds a pair rather
 * than a blob. Prefer carrying the encoded form end to end where the
 * configuration already has one.
 *
 * The password stays `Redacted` on the way in and the result stays `Redacted`
 * on the way out, so the pair is never materialized in a loggable value.
 *
 * Returns a `Result` rather than throwing: inside an `Effect.gen`, a throw
 * from a pure helper escapes as a defect no `catchTag` can see. Bridge it with
 * `Effect.fromResult` when you are already in an Effect.
 *
 * @param username - The user half. A `:` here is not representable in basic
 *   auth and is refused rather than silently corrupting the credential.
 * @param password - The password half. It may contain `:`.
 * @returns The encoded credential, or {@link BasicCredentialError} with
 *   reason `"colon-in-username"`.
 *
 * @example
 * ```ts
 * import { basicCredentialFromPairResult } from "@effected/npm";
 * import { Redacted, Result } from "effect";
 *
 * const result = basicCredentialFromPairResult("ci", Redacted.make("hunter2"));
 * console.log(Result.isSuccess(result));
 * // => true
 * ```
 *
 * @public
 */
export const basicCredentialFromPairResult = (
	username: string,
	password: Redacted.Redacted<string>,
): Result.Result<BasicCredential, BasicCredentialError> =>
	username.includes(":")
		? // The separator is positional and unescapable: a colon in the user half
			// would re-split into a different pair on the server. Refusing beats
			// minting a credential that authenticates as someone else.
			Result.fail(new BasicCredentialError({ reason: "colon-in-username" }))
		: Result.succeed({
				kind: "basic",
				encoded: Redacted.make(Base64.encode(`${username}:${Redacted.value(password)}`)),
			});

/**
 * A {@link WorkloadCredential} from a workload identity token and the
 * registry's prefix.
 *
 * @remarks
 * Pure and total: it concatenates `prefix` and the token inside the library
 * and wraps the result straight back into a `Redacted`, so the caller never
 * holds the plaintext. It validates nothing about the token — the registry is
 * the authority on whether it accepts it.
 *
 * It does **not** mask anything. On a CI runner, register both the identity
 * token and the prefixed value with the log filter before any subprocess
 * runs; on GitHub Actions, `ActionsRegistryCredential.workload` from
 * `@effected/github-actions` does all three steps.
 *
 * @param options - `audience` is the audience the token was minted for;
 *   `prefix` is the registry's token prefix (it may be empty);
 *   `identityToken` is the raw identity token.
 * @returns The publish-only credential.
 *
 * @example
 * ```ts
 * import { workloadCredential } from "@effected/npm";
 * import { Redacted } from "effect";
 *
 * const credential = workloadCredential({
 *   audience: "https://registry.example",
 *   prefix: "example_workload_",
 *   identityToken: Redacted.make("header.payload.signature"),
 * });
 * console.log(String(credential.token));
 * // => <redacted>
 * ```
 *
 * @public
 */
export const workloadCredential = (options: {
	readonly audience: string;
	readonly prefix: string;
	readonly identityToken: Redacted.Redacted<string>;
}): WorkloadCredential => ({
	kind: "workload",
	audience: options.audience,
	token: Redacted.make(`${options.prefix}${Redacted.value(options.identityToken)}`),
});
