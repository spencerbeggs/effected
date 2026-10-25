import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import type { GitHubGraphQLError } from "./GraphQL.js";
import { GraphQLDocument } from "./GraphQL.js";
import { REMOVED_BY_PINNED_VERSION, REPOSITORY_REST_SETTING_KEYS } from "./internal/repositoryRestSettingKeys.js";
import { unstubbed, unstubbedRead } from "./internal/unstubbed.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * Everything GitHub reports about a repository.
 *
 * @remarks
 * The **generated** response type for `GET /repos/{owner}/{repo}`, not a
 * hand-written projection, so every field GitHub documents is available with
 * its documented type.
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
 * A {@link RepositoryPatch} under construction, where an absent field may be
 * spelled as an explicit `undefined`.
 *
 * @remarks
 * The shape you actually have when you are applying only what a user
 * configured. Octokit's generated params spell an optional field as
 * `has_issues?: boolean`, **not** `has_issues?: boolean | undefined`, so under
 * `exactOptionalPropertyTypes` a `Partial<T>` built from your own settings
 * schema does not assign to `RepositoryPatch` at all. This type does, and
 * {@link repositoryPatch} turns it into one.
 *
 * @public
 */
export type RepositoryPatchDraft = {
	readonly [K in keyof RepositoryPatch]?: RepositoryPatch[K] | undefined;
};

/**
 * A {@link RepositoryPatch} from a draft, dropping every explicitly-`undefined`
 * field.
 *
 * @remarks
 * The supported spelling for "apply only what was configured" — the natural
 * shape for a sync action, without a cast at the call site.
 *
 * Dropping the key rather than sending `undefined` is what the wire needs:
 * `PATCH` treats an absent field as "leave it alone", while an explicit `null`
 * or `undefined` is a value.
 *
 * A key-by-key loop still defeats TypeScript's correlation between two indexed
 * accesses (`draft[key] = source[key]` over a union `key`), which no helper can
 * fix — build the draft as a literal where you can.
 *
 * @example
 * ```ts
 * import { repositoryPatch } from "@effected/github";
 *
 * // `config.has_issues` is `boolean | undefined`; absent fields drop out.
 * const patch = repositoryPatch({
 *   has_issues: config.has_issues,
 *   has_wiki: config.has_wiki,
 *   description: config.description,
 * });
 * ```
 *
 * @param draft - The fields to apply, any of which may be `undefined`.
 * @returns A patch carrying only the fields that were actually set.
 *
 * @public
 */
export const repositoryPatch = (draft: RepositoryPatchDraft): RepositoryPatch => {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(draft)) {
		if (value !== undefined) out[key] = value;
	}
	// The one cast, owned here rather than at every call site: `out` holds a
	// subset of `draft`'s keys with every `undefined` removed, which is exactly
	// what `RepositoryPatch` describes and what TypeScript cannot narrow to
	// through `Object.entries`.
	return out as RepositoryPatch;
};

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
 * Settings written through the GraphQL `updateRepository` mutation, mapped
 * from snake_case keys to camelCase GraphQL input fields.
 *
 * @remarks
 * `applySettings` checks this map **first**, so a key here always goes
 * through GraphQL, even when the REST patch also declares it.
 * `has_sponsorships` and `has_discussions` are GraphQL-only: the
 * `PATCH /repos/{owner}/{repo}` route accepts neither, and `has_discussions`
 * is the treacherous one — the REST **read** returns it, so routing its write
 * to the PATCH looks symmetric, but the PATCH silently ignores unknown body
 * fields and answers 200, so the write would look applied while the
 * repository never changed. `has_pull_requests` is in the REST patch's body
 * too; GraphQL is preferred for it so the three toggles travel together.
 * Setting any of these forces a second round trip to learn the repository's
 * node id.
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
 * Every list uses the **caller's** key names, not the wire names, because the
 * audience for them is a person reading a plan against the config they wrote.
 *
 * @public
 */
export interface AppliedSettings {
	/** Keys sent on the REST patch, after preparation dropped anything GitHub would refuse. */
	readonly rest: ReadonlyArray<string>;
	/** Keys sent through the GraphQL mutation, named as the caller supplied them. */
	readonly graphql: ReadonlyArray<string>;
	/**
	 * Keys neither API accepts, which were **not sent**.
	 *
	 * @remarks
	 * A key that is not a GraphQL-only setting and not in the REST patch's
	 * declared body — a typo such as `has_discussion`, or a setting GitHub has
	 * not described — lands here, as does a key the client's api-version
	 * removed from the patch (`use_squash_pr_title_as_default` under
	 * `2026-03-10` and later; a client pinned to an older version still sends
	 * it). Sending it would be worse than useless: the
	 * REST `PATCH` ignores unknown fields and answers 200, so the key would be
	 * reported applied while the repository never changed. A caller that wants
	 * an unknown key to fail the run checks this list.
	 */
	readonly ignored: ReadonlyArray<string>;
}

/**
 * Read and update a repository's settings and topics, and look up its default
 * branch, node id and owner type.
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
	 * Reads the repository payload and returns `default_branch`.
	 */
	readonly defaultBranch: Effect.Effect<string, GitHubError, Repo>;
	/**
	 * The repository's GraphQL node id.
	 *
	 * @remarks
	 * Needed as `repositoryId` by the `createLinkedBranch` and `createPullRequest`
	 * mutations.
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
	 * routes each key to whichever API can actually set it, and returns an
	 * {@link AppliedSettings} naming the keys that were sent through each and
	 * the keys neither accepts.
	 *
	 * Three settings — `has_sponsorships`, `has_pull_requests` and
	 * `has_discussions` ({@link GRAPHQL_ONLY_SETTINGS}) — are written through
	 * GraphQL's `updateRepository`, which addresses a repository by **node id**;
	 * the first and last are reachable no other way, and GraphQL is preferred
	 * for `has_pull_requests`. So a map touching any of them costs an extra read; a map touching none
	 * does not, which is the common case.
	 *
	 * The map is open by design. GitHub's settings surface is large and moving,
	 * and a closed type here would date the package. A key that is neither
	 * GraphQL-only nor in the REST patch's declared body — the key list is
	 * generated from GitHub's OpenAPI description — is not sent and is reported
	 * in `ignored`, rather than forwarded to a `PATCH` that would ignore it and
	 * answer 200. It does not fail the call, so additive GitHub API growth never
	 * breaks a run; a caller that owns a schema should still validate first.
	 */
	readonly applySettings: (
		settings: Record<string, unknown>,
	) => Effect.Effect<AppliedSettings, GitHubError | GitHubGraphQLError, Repo>;

	/**
	 * The repository's topics, as GitHub stores them.
	 *
	 * @remarks
	 * Reads `GET /repos/{owner}/{repo}/topics`, which answers the whole set in
	 * one object, so there is nothing to paginate. GitHub stores every topic
	 * lowercased, so this is the value to compare a desired set against.
	 */
	readonly topics: Effect.Effect<ReadonlyArray<string>, GitHubError, Repo>;

	/**
	 * Replace the repository's whole topic set, and return the set GitHub stored.
	 *
	 * @remarks
	 * `PUT /repos/{owner}/{repo}/topics` replaces rather than merges, so `names`
	 * is the complete desired set and an empty array clears every topic.
	 *
	 * **The return value is not `names`.** GitHub lowercases every topic it
	 * stores, so a caller that records what it sent — `Effect`, say — sees drift
	 * on the next read, which answers `effect`. Record the returned array, which
	 * is GitHub's own answer to the write, as the applied state.
	 */
	readonly setTopics: (names: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, GitHubError, Repo>;
}

/**
 * Read and update a repository's settings, including settings only GraphQL can
 * write, read and replace its topics, and look up its default branch, node id
 * and owner type.
 *
 * @remarks
 * Provide it with {@link GitHubRepository.layer}, which needs a `GitHubClient`;
 * every member also needs a `Repo` in `R`. `settings`, `defaultBranch`, `nodeId`,
 * `ownerType` and `topics` are `Effect` values, not functions.
 *
 * @example
 * ```ts
 * import { GitHubRepository } from "@effected/github";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const repository = yield* GitHubRepository;
 *   const branch = yield* repository.defaultBranch;
 *   const applied = yield* repository.applySettings({ has_wiki: false, has_discussions: true });
 *   return { branch, applied }; // applied.rest, applied.graphql, applied.ignored
 * });
 * ```
 *
 * @public
 */
export class GitHubRepository extends Context.Service<GitHubRepository, GitHubRepositoryShape>()(
	"@effected/github/GitHubRepository",
) {
	/** The live service, built over a `GitHubClient`. */
	static readonly layer: Layer.Layer<GitHubRepository, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; an unstubbed member dies when run, naming itself. */
	static readonly makeTest = (overrides: Partial<GitHubRepositoryShape> = {}): GitHubRepositoryShape => ({
		settings: overrides.settings ?? unread("settings"),
		updateSettings: overrides.updateSettings ?? (() => dies("updateSettings")),
		defaultBranch: overrides.defaultBranch ?? unread("defaultBranch"),
		nodeId: overrides.nodeId ?? unread("nodeId"),
		ownerType: overrides.ownerType ?? unread("ownerType"),
		applySettings: overrides.applySettings ?? (() => dies("applySettings")),
		topics: overrides.topics ?? unread("topics"),
		setTopics: overrides.setTopics ?? (() => dies("setTopics")),
	});

	/** {@link GitHubRepository.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubRepositoryShape> = {}): Layer.Layer<GitHubRepository> =>
		Layer.succeed(GitHubRepository, GitHubRepository.makeTest(overrides));
}

const dies = unstubbed("GitHubRepository.makeTest");
const unread = unstubbedRead("GitHubRepository.makeTest");

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

	const topics = Effect.fn("GitHubRepository.topics")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });
		const topic = yield* client.request("GET /repos/{owner}/{repo}/topics", { owner, repo });
		return topic.names;
	})();

	return {
		settings,
		topics,
		setTopics: Effect.fn("GitHubRepository.setTopics")(function* (names: ReadonlyArray<string>) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, topics: names.length });
			// GitHub's answer, not `names`: it lowercases what it stores, and the
			// caller's applied-state record has to match the next read.
			const topic = yield* client.request("PUT /repos/{owner}/{repo}/topics", { owner, repo, names: [...names] });
			return topic.names;
		}),
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
			const ignored: Array<string> = [];

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
				// The REST PATCH ignores a field it does not declare and answers 200,
				// so forwarding an unknown key would report it applied while nothing
				// changed. The allowlist is generated from the OpenAPI description;
				// a key a later api-version removed is subtracted only for a client
				// at or past that version, which compare correctly as strings.
				const removedIn = Object.hasOwn(REMOVED_BY_PINNED_VERSION, key) ? REMOVED_BY_PINNED_VERSION[key] : undefined;
				if (!REPOSITORY_REST_SETTING_KEYS.has(key) || (removedIn !== undefined && client.apiVersion >= removedIn)) {
					ignored.push(key);
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
				ignored,
			} satisfies AppliedSettings;
		}),
	};
};
