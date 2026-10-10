import { JwksResolver, Jwt, JwtError } from "@effected/jwt";
import type { Duration } from "effect";
import { Effect, Schema, SchemaTransformation } from "effect";

/** The issuer of every GitHub Actions OIDC token on github.com. */
const ISSUER = "https://token.actions.githubusercontent.com";

/**
 * A numeric id as GitHub's OIDC tokens carry it: a string of decimal digits,
 * decoded to a safe integer. Anything else (an empty string, a sign, a
 * fraction, an exponent, surrounding space) does not decode.
 */
const IdFromString = Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(
	Schema.decodeTo(Schema.Int, SchemaTransformation.numberFromString),
);

/**
 * The claims of a verified GitHub Actions OIDC token.
 *
 * @remarks
 * Field names are camelCase; the token carries them in snake_case
 * (`repository_id`, `job_workflow_ref`, ...), and {@link ActionsOidc.verify}
 * maps between the two. GitHub sends the numeric ids (`repository_id`,
 * `repository_owner_id`, `run_id`, `run_attempt`, `actor_id`) as strings;
 * they decode to numbers here, and a non-numeric one fails verification as
 * `claims`.
 *
 * Claims GitHub adds that are not modelled here are dropped on decode.
 *
 * @public
 */
export class ActionsOidcClaims extends Schema.Class<ActionsOidcClaims>("ActionsOidcClaims")({
	/** The issuer: always {@link ActionsOidc.issuer} once verified. */
	iss: Schema.String,
	/** The subject, e.g. `repo:octo-org/octo-repo:ref:refs/heads/main`. */
	sub: Schema.String,
	/** The audience or audiences the token was minted for. */
	aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
	/** Expiry, in seconds since the epoch. */
	exp: Schema.Number,
	/** Issued at, in seconds since the epoch. */
	iat: Schema.Number,
	/** Not before, in seconds since the epoch. */
	nbf: Schema.optionalKey(Schema.Number),
	/** The token's unique id. */
	jti: Schema.optionalKey(Schema.String),
	/** The repository, `owner/name`. */
	repository: Schema.String,
	/** The repository's numeric id (wire key `repository_id`). */
	repositoryId: IdFromString,
	/** The repository owner's login (wire key `repository_owner`). */
	repositoryOwner: Schema.String,
	/** The repository owner's numeric id (wire key `repository_owner_id`). */
	repositoryOwnerId: IdFromString,
	/** The workflow run's id (wire key `run_id`). */
	runId: IdFromString,
	/** The run attempt, from 1 (wire key `run_attempt`). */
	runAttempt: IdFromString,
	/** The calling workflow's ref, e.g. `octo-org/octo-repo/.github/workflows/ci.yml@refs/heads/main` (wire key `workflow_ref`). */
	workflowRef: Schema.String,
	/** The ref of the workflow file the job runs, which differs from `workflowRef` for a reusable workflow (wire key `job_workflow_ref`). */
	jobWorkflowRef: Schema.String,
	/** The git ref the run is for. */
	ref: Schema.String,
	/** The commit SHA the run is for. */
	sha: Schema.String,
	/** The event that triggered the run, e.g. `push` (wire key `event_name`). */
	eventName: Schema.String,
	/** The login of the user who triggered the run. */
	actor: Schema.String,
	/** That user's numeric id (wire key `actor_id`). */
	actorId: IdFromString,
	/** The deployment environment, when the job names one. */
	environment: Schema.optionalKey(Schema.String),
	/** `github-hosted` or `self-hosted` (wire key `runner_environment`). */
	runnerEnvironment: Schema.String,
}) {}

/** The claims as they arrive in the token: snake_case keys, decoding to {@link ActionsOidcClaims}. */
const ClaimsFromWire = ActionsOidcClaims.pipe(
	Schema.encodeKeys({
		repositoryId: "repository_id",
		repositoryOwner: "repository_owner",
		repositoryOwnerId: "repository_owner_id",
		runId: "run_id",
		runAttempt: "run_attempt",
		workflowRef: "workflow_ref",
		jobWorkflowRef: "job_workflow_ref",
		eventName: "event_name",
		actorId: "actor_id",
		runnerEnvironment: "runner_environment",
	}),
);

/**
 * Options for {@link ActionsOidc.verify}.
 *
 * @public
 */
export interface ActionsOidcVerifyOptions {
	/**
	 * The audience the token must have been minted for: what the workflow
	 * passed to `core.getIDToken(audience)`. Required and non-empty, because
	 * GitHub's one JWKS signs tokens for every relying party; without an
	 * audience check, any workflow's token for any service would verify.
	 */
	readonly audience: string;
	/** Allowed clock skew for `exp`, `nbf` and `iat`; 60 seconds by default. */
	readonly clockTolerance?: Duration.Input | undefined;
}

const verify = Effect.fn("ActionsOidc.verify")(function* (token: string, options: ActionsOidcVerifyOptions) {
	if (options.audience.length === 0) {
		return yield* new JwtError({
			reason: "wrongAudience",
			detail: "no audience was given; an Actions OIDC token is never verified without one",
		});
	}
	return yield* Jwt.verify(token, {
		// The key is always looked up for the Actions issuer, never for the
		// token's own `iss`: the issuer decides which keys are trusted.
		key: JwksResolver.forIssuer(ISSUER),
		claims: ClaimsFromWire,
		issuer: ISSUER,
		audience: options.audience,
		...(options.clockTolerance !== undefined ? { clockTolerance: options.clockTolerance } : {}),
	});
});

const testClaims = (overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> => ({
	iss: ISSUER,
	sub: "repo:octo-org/octo-repo:ref:refs/heads/main",
	aud: "https://github.com/octo-org",
	repository: "octo-org/octo-repo",
	repository_id: "123456789",
	repository_owner: "octo-org",
	repository_owner_id: "987654",
	run_id: "4242424242",
	run_attempt: "1",
	workflow_ref: "octo-org/octo-repo/.github/workflows/ci.yml@refs/heads/main",
	job_workflow_ref: "octo-org/octo-repo/.github/workflows/ci.yml@refs/heads/main",
	ref: "refs/heads/main",
	sha: "0123456789abcdef0123456789abcdef01234567",
	event_name: "push",
	actor: "octocat",
	actor_id: "583231",
	runner_environment: "github-hosted",
	...overrides,
});

/**
 * Verify GitHub Actions OIDC tokens: a workflow proving to your service which
 * repository, workflow and run it is.
 *
 * @remarks
 * {@link ActionsOidc.verify} checks the signature against GitHub's published
 * JWKS (through `@effected/jwt`'s `JwksResolver`, which caches it), then `iss`,
 * `aud`, `exp`, `nbf` and `iat`, then decodes the payload into
 * {@link ActionsOidcClaims}. Every failure is a `JwtError`; route on its
 * `reason` (`wrongAudience`, `expired`, `claims`, ...), never on its message.
 *
 * Authorizing the caller is still yours: a verified token proves who is
 * calling, not that they may. Pin the **immutable ids**, `repositoryId` or
 * `repositoryOwnerId`, together with `jobWorkflowRef` (or `workflowRef`),
 * never the `repository` or `repositoryOwner` name alone: a deleted
 * repository's or account's name can be registered again by someone else,
 * whose workflows then mint tokens carrying the old name.
 *
 * Only the github.com issuer is accepted. A GitHub Enterprise Cloud
 * enterprise's unique issuer (`https://token.actions.githubusercontent.com/<enterprise>`)
 * and a GitHub Enterprise Server issuer (`https://<host>/_services/token`)
 * are refused as `wrongIssuer`.
 *
 * This module does not reach octokit: a service that only verifies tokens
 * links `@effected/jwt` and nothing else from this package.
 *
 * @example
 * ```ts
 * import { JwksResolver } from "@effected/jwt";
 * import { ActionsOidc } from "@effected/github";
 * import { Data, Effect } from "effect";
 *
 * class Forbidden extends Data.TaggedError("Forbidden")<{ readonly repositoryId: number }> {}
 *
 * // Pinned by id, which survives a rename and cannot be re-registered.
 * const ALLOWED_REPOSITORY_ID = 123456789;
 * const ALLOWED_WORKFLOW = "octo-org/octo-repo/.github/workflows/deploy.yml@refs/heads/main";
 *
 * const authorize = (bearer: string) =>
 *   Effect.gen(function* () {
 *     const claims = yield* ActionsOidc.verify(bearer, { audience: "https://my-service.example" });
 *     if (claims.repositoryId !== ALLOWED_REPOSITORY_ID || claims.jobWorkflowRef !== ALLOWED_WORKFLOW) {
 *       return yield* new Forbidden({ repositoryId: claims.repositoryId });
 *     }
 *     return claims;
 *   });
 *
 * // JwksResolver.layer needs an HttpClient and a JwksStore, provided once at the edge.
 * export const program = authorize("eyJ...").pipe(Effect.provide(JwksResolver.layer));
 * ```
 *
 * @public
 */
export const ActionsOidc: {
	/** The Actions OIDC issuer, `https://token.actions.githubusercontent.com`. */
	readonly issuer: "https://token.actions.githubusercontent.com";
	/** Verify a runner-issued OIDC token: signature against GitHub's JWKS, iss, aud, exp/nbf, then typed claims. */
	readonly verify: (
		token: string,
		options: ActionsOidcVerifyOptions,
	) => Effect.Effect<ActionsOidcClaims, JwtError, JwksResolver>;
	/**
	 * A valid claims payload for tests, overridable field by field.
	 *
	 * @remarks
	 * Wire-shaped (snake_case keys, string ids) and complete except for the
	 * time claims `iat` and `exp`, which depend on the clock: a signer stamps
	 * them, as `TestIssuer.sign` from `@effected/jwt/testing` does. `iss` is
	 * {@link ActionsOidc.issuer}; `aud` is a placeholder to override with the
	 * audience under test.
	 */
	readonly testClaims: (overrides?: Readonly<Record<string, unknown>>) => Record<string, unknown>;
} = { issuer: ISSUER, verify, testClaims };
