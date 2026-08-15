import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import type { GitHubGraphQLError } from "./GraphQL.js";
import { GraphQLDocument } from "./GraphQL.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * Everything GitHub reports about a repository.
 *
 * @remarks
 * The **generated** response type, not a hand-written projection. One surveyed
 * consumer declared a sixteen-field interface for this endpoint and round-tripped
 * those fields back through `PATCH` — and every one of the sixteen already
 * existed, verbatim, in the OpenAPI types the package now leans on. Re-declaring
 * them would have been the same mistake with our name on it.
 *
 * @public
 */
export type RepositorySettings = Rest.Data<"GET /repos/{owner}/{repo}">;

/**
 * The fields `PATCH /repos/{owner}/{repo}` accepts, minus the coordinate.
 *
 * @public
 */
export type RepositoryPatch = Omit<Rest.Params<"PATCH /repos/{owner}/{repo}">, "owner" | "repo">;

/**
 * Whether an account is a user or an organization.
 *
 * @public
 */
export type OwnerType = "User" | "Organization";

/**
 * Fields in the user-facing `security_and_analysis` block that GitHub accepts
 * as `{ status: "enabled" | "disabled" }`.
 *
 * @remarks
 * A caller supplies the bare string; it is wrapped before sending.
 *
 * @public
 */
export const SECURITY_ANALYSIS_STATUS_FIELDS: ReadonlySet<string> = new Set([
	"advanced_security",
	"code_security",
	"secret_scanning",
	"secret_scanning_push_protection",
	"secret_scanning_ai_detection",
	"secret_scanning_non_provider_patterns",
	"secret_scanning_delegated_alert_dismissal",
	"secret_scanning_delegated_bypass",
	"dependabot_security_updates",
]);

/**
 * Settings reachable **only** through the GraphQL `updateRepository` mutation,
 * mapped from snake_case keys to camelCase GraphQL input fields.
 *
 * @remarks
 * GitHub never exposed these on the REST repository endpoint — the
 * `PATCH /repos/{owner}/{repo}` route accepts none of them, and
 * `has_discussions` is the treacherous one: the REST **read** returns it, so
 * routing its write to the PATCH looks symmetric, but the PATCH silently
 * ignores unknown body fields and answers 200 — reported as applied on every
 * run while the repository never changed (effected#358). Setting any of these
 * forces a second round trip to learn the repository's node id.
 *
 * Field names verified against `UpdateRepositoryInput` by live introspection,
 * 2026-08-15.
 *
 * @public
 */
export const GRAPHQL_ONLY_SETTINGS: Readonly<Record<string, string>> = {
	has_sponsorships: "hasSponsorshipsEnabled",
	has_pull_requests: "hasPullRequestsEnabled",
	has_discussions: "hasDiscussionsEnabled",
};

/** `{ status: "enabled" | "disabled" }` — the form GitHub accepts and the type declares. */
const isStatusObject = (raw: unknown): raw is { readonly status: "enabled" | "disabled" } => {
	if (raw === null || typeof raw !== "object") return false;
	const status = (raw as { readonly status?: unknown }).status;
	return status === "enabled" || status === "disabled";
};

/**
 * Translate a user-facing `security_and_analysis` block into the shape
 * `PATCH /repos/{owner}/{repo}` expects.
 *
 * @remarks
 * **Both shapes are accepted.** A bare `"enabled"` / `"disabled"` is wrapped;
 * an already-wrapped `{ status }` — which is what `RepositoryPatch` actually
 * types, since it is GitHub's own parameter type — passes through untouched.
 * Accepting only the bare string would silently drop the block for a caller
 * following the types.
 *
 * Reviewer entries must already carry a numeric `reviewer_id` and
 * `reviewer_type`; resolving those from team slugs is the caller's job — see
 * `Ruleset.teamId`.
 *
 * An **empty** `delegated_bypass_reviewers` array is treated as "no change"
 * rather than "no reviewers". GitHub rejects `{ reviewers: [] }` outright when
 * delegated bypass is enabled, so forwarding it would turn an omission into a
 * failure.
 *
 * @public
 */
export const transformSecurityAndAnalysis = (value: unknown): Record<string, unknown> | undefined => {
	if (value === null || typeof value !== "object") return undefined;

	const input = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	for (const [key, raw] of Object.entries(input)) {
		if (raw === undefined) continue;
		if (SECURITY_ANALYSIS_STATUS_FIELDS.has(key) && (raw === "enabled" || raw === "disabled")) {
			out[key] = { status: raw };
		} else if (SECURITY_ANALYSIS_STATUS_FIELDS.has(key) && isStatusObject(raw)) {
			// Already the shape GitHub wants, which is also the shape
			// `RepositoryPatch` types. Passing it through is not a convenience:
			// without this branch a type-correct caller has the block silently
			// dropped, because the wrapping branch above only matches a bare
			// string. That is data loss on the input the type asks for.
			out[key] = raw;
		} else if (key === "delegated_bypass_reviewers" && Array.isArray(raw) && raw.length > 0) {
			out.secret_scanning_delegated_bypass_options = { reviewers: raw };
		}
	}

	return Object.keys(out).length > 0 ? out : undefined;
};

/** The mutation's answer. Only its shape matters — the id is never read. */
const UpdateRepositoryResponse = Schema.Struct({
	updateRepository: Schema.Struct({
		repository: Schema.Struct({ id: Schema.String }),
	}),
});

/**
 * The `updateRepository` mutation, as an owned document.
 *
 * @remarks
 * Named `UpdateRepository`; {@link GitHubClient.layerFixture} keys its GraphQL
 * fixtures by that name.
 */
const UpdateRepository = GraphQLDocument.make({
	name: "UpdateRepository",
	document: `mutation UpdateRepository($input: UpdateRepositoryInput!) {
	updateRepository(input: $input) {
		repository { id }
	}
}`,
	response: UpdateRepositoryResponse,
})<{ readonly input: Record<string, unknown> }>();

/**
 * Keys GitHub rejects when the strategy that owns them is being turned off.
 *
 * @remarks
 * Sending `merge_commit_title` in the same request that sets
 * `allow_merge_commit: false` is a 422, so the dependent keys go out with the
 * strategy that owns them rather than alone.
 */
const DEPENDENT_MERGE_KEYS = {
	allow_merge_commit: ["merge_commit_title", "merge_commit_message"],
	allow_squash_merge: ["squash_merge_commit_title", "squash_merge_commit_message"],
} as const;

/**
 * Everything both write paths owe the API before a patch is sent.
 *
 * @remarks
 * Shared by `updateSettings` and `applySettings` deliberately: a caller should
 * not get a different `security_and_analysis` shape depending on which one they
 * reached for.
 */
const preparePatch = (patch: RepositoryPatch): RepositoryPatch => {
	const out: Record<string, unknown> = { ...patch };

	const securityAndAnalysis = transformSecurityAndAnalysis(out.security_and_analysis);
	if (securityAndAnalysis === undefined) {
		delete out.security_and_analysis;
	} else {
		out.security_and_analysis = securityAndAnalysis;
	}

	for (const [strategy, dependents] of Object.entries(DEPENDENT_MERGE_KEYS)) {
		if (out[strategy] === false) {
			for (const dependent of dependents) delete out[dependent];
		}
	}

	return out as RepositoryPatch;
};

/**
 * What {@link GitHubRepositoryShape.applySettings} actually sent.
 *
 * @remarks
 * **These are the fields that went out, not the fields you asked for**, and the
 * difference is the point. `applySettings` drops what GitHub would reject —
 * merge keys whose strategy is being disabled, a `security_and_analysis` block
 * that normalises to nothing — so a caller reporting `Object.keys(input)` is
 * describing its own intent while the package decides the content. The two
 * agree right up until a field is dropped, which is exactly the case anyone
 * reading a dry run is trying to check.
 *
 * Both lists use the **caller's** key names, not the wire names, because the
 * audience for them is a person reading a plan against the config they wrote.
 *
 * @public
 */
export interface AppliedSettings {
	/** Keys sent on the REST patch, after preparation dropped anything GitHub would refuse. */
	readonly rest: ReadonlyArray<string>;
	/** Keys sent through the GraphQL mutation, named as the caller supplied them. */
	readonly graphql: ReadonlyArray<string>;
}

/**
 * The repository itself.
 *
 * @public
 */
export interface GitHubRepositoryShape {
	/** The full, faithfully typed repository payload. */
	readonly settings: Effect.Effect<RepositorySettings, GitHubError, Repo>;
	/** Apply a settings patch and return what GitHub then reports. */
	readonly updateSettings: (patch: RepositoryPatch) => Effect.Effect<RepositorySettings, GitHubError, Repo>;
	/**
	 * The default branch's name.
	 *
	 * @remarks
	 * One surveyed consumer spent eight lines of hand-written octokit interface
	 * plus eleven lines of code to read this one string.
	 */
	readonly defaultBranch: Effect.Effect<string, GitHubError, Repo>;
	/**
	 * The repository's GraphQL node id.
	 *
	 * @remarks
	 * Needed as `repositoryId` by the `createLinkedBranch` and `createPullRequest`
	 * mutations, which is why a second consumer cast `repos.get` for it alone.
	 */
	readonly nodeId: Effect.Effect<string, GitHubError, Repo>;

	/**
	 * Whether the repository's owner is a user or an organization.
	 *
	 * @remarks
	 * Gates the settings that only exist on organization-owned repositories:
	 * sending one to a personal repository is rejected, so a caller applying a
	 * shared settings template filters by this first.
	 *
	 * The route is account-scoped (`GET /users/{username}`) but the question is a
	 * repository question — *may I send org-only fields to this repository?* —
	 * so it sources the login from `Repo.owner` rather than taking an argument.
	 * Shaping the API around the route instead of the question would hand every
	 * caller a login to thread for no reason.
	 */
	readonly ownerType: Effect.Effect<OwnerType, GitHubError, Repo>;

	/**
	 * Apply a settings map that may span REST and GraphQL.
	 *
	 * @remarks
	 * `updateSettings` is the thin, faithfully-typed PATCH and returns what
	 * GitHub then reports. This is the **applicator**: it takes an open map,
	 * routes each key to whichever API can actually set it, and returns nothing.
	 *
	 * Two settings — `has_sponsorships` and `has_pull_requests` — have never
	 * existed on the REST endpoint and are only reachable through GraphQL's
	 * `updateRepository`, which addresses a repository by **node id**. So a map
	 * touching either costs an extra read; a map touching neither does not, which
	 * is the common case.
	 *
	 * The map is open by design. GitHub's settings surface is large and moving,
	 * and a closed type here would date the package — but it also means a typo is
	 * forwarded rather than rejected, so a caller that owns a schema should
	 * validate before calling.
	 */
	readonly applySettings: (
		settings: Record<string, unknown>,
	) => Effect.Effect<AppliedSettings, GitHubError | GitHubGraphQLError, Repo>;
}

/**
 * Repository settings and coordinates.
 *
 * @public
 */
export class GitHubRepository extends Context.Service<GitHubRepository, GitHubRepositoryShape>()(
	"@effected/github/GitHubRepository",
) {
	static readonly layer: Layer.Layer<GitHubRepository, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<GitHubRepositoryShape> = {}): GitHubRepositoryShape => ({
		settings: overrides.settings ?? Effect.sync(() => unstubbed("settings")),
		updateSettings: overrides.updateSettings ?? (() => unstubbed("updateSettings")),
		defaultBranch: overrides.defaultBranch ?? Effect.sync(() => unstubbed("defaultBranch")),
		nodeId: overrides.nodeId ?? Effect.sync(() => unstubbed("nodeId")),
		ownerType: overrides.ownerType ?? Effect.sync(() => unstubbed("ownerType")),
		applySettings: overrides.applySettings ?? (() => unstubbed("applySettings")),
	});

	/** {@link GitHubRepository.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubRepositoryShape> = {}): Layer.Layer<GitHubRepository> =>
		Layer.succeed(GitHubRepository, GitHubRepository.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`GitHubRepository.makeTest: ${member} was read but not stubbed — pass an override.`);
};

const make = (client: GitHubClient["Service"]): GitHubRepositoryShape => {
	const settings = Effect.fn("GitHubRepository.settings")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });
		return yield* client.request("GET /repos/{owner}/{repo}", { owner, repo });
	})();

	const ownerType = Effect.fn("GitHubRepository.ownerType")(function* () {
		const { owner } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner });
		const user = yield* client.request("GET /users/{username}", { username: owner });
		return user.type === "Organization" ? "Organization" : "User";
	})();

	return {
		settings,
		updateSettings: Effect.fn("GitHubRepository.updateSettings")(function* (patch: RepositoryPatch) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, fields: Object.keys(patch).length });
			return yield* client.request("PATCH /repos/{owner}/{repo}", { ...preparePatch(patch), owner, repo });
		}),
		defaultBranch: Effect.map(settings, (repository) => repository.default_branch),
		nodeId: Effect.map(settings, (repository) => repository.node_id),
		ownerType,
		applySettings: Effect.fn("GitHubRepository.applySettings")(function* (input: Record<string, unknown>) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo });

			const rest: Record<string, unknown> = {};
			const graphql: Record<string, unknown> = {};
			// The caller's key for each GraphQL field, so the report speaks their
			// vocabulary rather than the wire's.
			const graphqlKeys: Array<string> = [];

			for (const [key, value] of Object.entries(input)) {
				// `Object.hasOwn`, not a bare index: the map is open by design, so a
				// caller key of `toString` or `constructor` would otherwise resolve
				// through the prototype chain to a FUNCTION, and that function would
				// be sent as a GraphQL input field name and reported as applied.
				const graphqlField = Object.hasOwn(GRAPHQL_ONLY_SETTINGS, key) ? GRAPHQL_ONLY_SETTINGS[key] : undefined;
				if (graphqlField !== undefined) {
					graphql[graphqlField] = value;
					graphqlKeys.push(key);
					continue;
				}
				rest[key] = value;
			}

			// Prepared ONCE, and the report is taken from the result: reporting
			// `rest` here would name fields that preparation then drops, which is a
			// dry run that lies in the direction of looking successful.
			const prepared = preparePatch(rest as RepositoryPatch);
			// Gate on the PREPARED body, never the raw keys. Preparation can drop
			// every key it was given — a `security_and_analysis` block whose fields
			// are all unrecognised normalises to nothing — and gating on `rest`
			// then fires a PATCH carrying only `owner` and `repo`, while the report
			// below truthfully says nothing was sent. The report contradicting the
			// wire is the one failure `AppliedSettings` exists to prevent.
			const restKeys = Object.keys(prepared);

			if (restKeys.length > 0) {
				// The map is open by design, so it cannot be narrowed to the route's
				// generated parameter type. The cast is on the BODY, never the route.
				yield* client.request("PATCH /repos/{owner}/{repo}", {
					...prepared,
					owner,
					repo,
				} as Rest.Params<"PATCH /repos/{owner}/{repo}">);
			}

			if (Object.keys(graphql).length > 0) {
				// Only now is the node id worth a round trip.
				const repository = yield* client.request("GET /repos/{owner}/{repo}", { owner, repo });
				yield* client.graphql(UpdateRepository, {
					input: { repositoryId: repository.node_id, ...graphql },
				});
			}

			return {
				rest: restKeys,
				graphql: graphqlKeys,
			} satisfies AppliedSettings;
		}),
	};
};
