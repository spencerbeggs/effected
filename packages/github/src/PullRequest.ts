import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { CommitFile } from "./GitHubCommit.js";
import { fileOf } from "./GitHubCommit.js";
import { GitHubError } from "./GitHubError.js";
import type { GitHubGraphQLError } from "./GraphQL.js";
import { GraphQLDocument } from "./GraphQL.js";
import { Repo } from "./Repo.js";
import { PageOptions } from "./Rest.js";

/** How a pull request is merged. @public */
export const MergeMethod = Schema.Literals(["merge", "squash", "rebase"]);

/**
 * A pull request, projected to what callers read.
 *
 * @public
 */
export class PullRequestInfo extends Schema.Class<PullRequestInfo>("PullRequestInfo")({
	/** The number in `#123`. */
	number: Schema.Int,
	/** The GraphQL node id, which the auto-merge mutations need. */
	nodeId: Schema.String,
	/** The web URL. */
	url: Schema.String,
	title: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	/** The source branch name. */
	head: Schema.String,
	/** The sha the source branch pointed at when GitHub answered. */
	headSha: Schema.String,
	/** The target branch name. */
	base: Schema.String,
	/** The sha the target branch pointed at when GitHub answered — the commit the pull request branches from. */
	baseSha: Schema.String,
	draft: Schema.Boolean,
	merged: Schema.Boolean,
	/**
	 * When it merged, if it did.
	 *
	 * @remarks
	 * An `Option`, not an optional field. Whether a pull request has merged is a
	 * fact GitHub always reports, so modelling it as "maybe absent" would be
	 * modelling a gap in our fixtures rather than a gap in the domain.
	 */
	mergedAt: Schema.Option(Schema.DateTimeUtcFromString),
	/** The description, when GitHub sent one. */
	body: Schema.optionalKey(Schema.String),
	/** The merge commit, once there is one. */
	mergeCommitSha: Schema.optionalKey(Schema.String),
}) {}

/** What {@link PullRequestShape.upsert} did. @public */
export interface UpsertedPullRequest {
	readonly pullRequest: PullRequestInfo;
	readonly created: boolean;
}

const AutoMergeResponse = Schema.Struct({});

const EnableAutoMerge = GraphQLDocument.make({
	name: "enablePullRequestAutoMerge",
	document: `mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
    clientMutationId
  }
}`,
	response: AutoMergeResponse,
})<{ readonly pullRequestId: string; readonly mergeMethod: string }>();

const DisableAutoMerge = GraphQLDocument.make({
	name: "disablePullRequestAutoMerge",
	document: `mutation ($pullRequestId: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) { clientMutationId }
}`,
	response: AutoMergeResponse,
})<{ readonly pullRequestId: string }>();

/** GraphQL spells the merge methods in capitals. */
const GRAPHQL_MERGE_METHOD = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

/**
 * Pull requests.
 *
 * @public
 */
export interface PullRequestShape {
	readonly get: (number: number) => Effect.Effect<PullRequestInfo, GitHubError, Repo>;
	readonly list: (options?: {
		readonly head?: string | undefined;
		readonly base?: string | undefined;
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly page?: PageOptions | undefined;
	}) => Effect.Effect<ReadonlyArray<PullRequestInfo>, GitHubError, Repo>;
	/**
	 * The files a pull request changes.
	 *
	 * @remarks
	 * Each entry is a full {@link CommitFile} — path **and** status, plus the
	 * line counts and any pre-rename path — the same projection
	 * `GitHubCommit.changedFiles` returns, because GitHub answers both
	 * endpoints with the same `diff-entry` shape. An earlier version projected
	 * to the path alone, and consumers who needed the status fell back to a raw
	 * route.
	 */
	readonly listFiles: (
		number: number,
		options?: { readonly page?: PageOptions | undefined },
	) => Effect.Effect<ReadonlyArray<CommitFile>, GitHubError, Repo>;
	/**
	 * The pull requests associated with a commit.
	 *
	 * @remarks
	 * Named for the question it answers, because the previous surface had this
	 * method and one consumer never found it — dropping to a raw octokit callback
	 * with the only `noExplicitAny` suppression in the entire survey. It also
	 * paginates now, which the previous one did not.
	 */
	readonly listAssociatedWithCommit: (
		sha: string,
		options?: { readonly page?: PageOptions | undefined },
	) => Effect.Effect<ReadonlyArray<PullRequestInfo>, GitHubError, Repo>;
	readonly create: (input: {
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}) => Effect.Effect<PullRequestInfo, GitHubError, Repo>;
	readonly update: (
		number: number,
		patch: {
			readonly title?: string | undefined;
			readonly body?: string | undefined;
			readonly state?: "open" | "closed" | undefined;
			readonly base?: string | undefined;
		},
	) => Effect.Effect<PullRequestInfo, GitHubError, Repo>;
	/** Update the open pull request for `head`→`base`, or open one. */
	readonly upsert: (input: {
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}) => Effect.Effect<UpsertedPullRequest, GitHubError, Repo>;
	readonly merge: (
		number: number,
		options?: {
			readonly method?: "merge" | "squash" | "rebase" | undefined;
			readonly commitTitle?: string | undefined;
			readonly commitMessage?: string | undefined;
		},
	) => Effect.Effect<string, GitHubError, Repo>;
	readonly addLabels: (number: number, labels: ReadonlyArray<string>) => Effect.Effect<void, GitHubError, Repo>;
	readonly requestReviewers: (
		number: number,
		reviewers: {
			readonly users?: ReadonlyArray<string> | undefined;
			readonly teams?: ReadonlyArray<string> | undefined;
		},
	) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * Turn auto-merge on or off.
	 *
	 * @remarks
	 * An explicit call, not an option on `create`/`update`. The previous surface
	 * fired these mutations from an `Effect.tap` **after** the create succeeded,
	 * so a create that worked could still surface an auto-merge failure as if the
	 * create had failed.
	 */
	readonly setAutoMerge: (
		pullRequest: PullRequestInfo,
		method: "merge" | "squash" | "rebase" | "off",
	) => Effect.Effect<void, GitHubGraphQLError, Repo>;
}

/**
 * Pull requests.
 *
 * @public
 */
export class PullRequest extends Context.Service<PullRequest, PullRequestShape>()("@effected/github/PullRequest") {
	static readonly layer: Layer.Layer<PullRequest, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<PullRequestShape> = {}): PullRequestShape => ({
		get: overrides.get ?? (() => unstubbed("get")),
		list: overrides.list ?? (() => unstubbed("list")),
		listFiles: overrides.listFiles ?? (() => unstubbed("listFiles")),
		listAssociatedWithCommit: overrides.listAssociatedWithCommit ?? (() => unstubbed("listAssociatedWithCommit")),
		create: overrides.create ?? (() => unstubbed("create")),
		update: overrides.update ?? (() => unstubbed("update")),
		upsert: overrides.upsert ?? (() => unstubbed("upsert")),
		merge: overrides.merge ?? (() => unstubbed("merge")),
		addLabels: overrides.addLabels ?? (() => unstubbed("addLabels")),
		requestReviewers: overrides.requestReviewers ?? (() => unstubbed("requestReviewers")),
		setAutoMerge: overrides.setAutoMerge ?? (() => unstubbed("setAutoMerge")),
	});

	/** {@link PullRequest.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<PullRequestShape> = {}): Layer.Layer<PullRequest> =>
		Layer.succeed(PullRequest, PullRequest.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`PullRequest.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

interface RawPull {
	readonly number: number;
	readonly node_id: string;
	readonly html_url: string;
	readonly title: string;
	readonly state: string;
	readonly head: { readonly ref: string; readonly sha: string };
	readonly base: { readonly ref: string; readonly sha: string };
	readonly draft?: boolean | undefined;
	readonly merged?: boolean | undefined;
	readonly merged_at?: string | null | undefined;
	readonly body?: string | null | undefined;
	readonly merge_commit_sha?: string | null | undefined;
}

const project = (raw: RawPull): Effect.Effect<PullRequestInfo, GitHubError> =>
	Effect.try({
		try: () =>
			PullRequestInfo.make({
				number: raw.number,
				nodeId: raw.node_id,
				url: raw.html_url,
				title: raw.title,
				state: raw.state === "closed" ? "closed" : "open",
				head: raw.head.ref,
				headSha: raw.head.sha,
				base: raw.base.ref,
				baseSha: raw.base.sha,
				draft: raw.draft ?? false,
				merged: raw.merged ?? raw.merged_at != null,
				// Constructed rather than decoded: the Type side of
				// `Schema.Option(DateTimeUtcFromString)` is an `Option<DateTime.Utc>`,
				// and GitHub's wire form is a nullable ISO string — two different
				// shapes, so the conversion belongs here rather than in a codec that
				// would have to describe GitHub's encoding as if it were ours.
				mergedAt: raw.merged_at == null ? Option.none() : Option.some(DateTime.makeUnsafe(raw.merged_at)),
				...(raw.body != null ? { body: raw.body } : {}),
				...(raw.merge_commit_sha != null ? { mergeCommitSha: raw.merge_commit_sha } : {}),
			}),
		catch: (error) => GitHubError.decode("PullRequest", "GitHub returned an unexpected pull request", error),
	});

/** `owner:branch` is what GitHub's `head` filter wants for a cross-fork search. */
const qualifyHead = (owner: string, head: string): string => (head.includes(":") ? head : `${owner}:${head}`);

const make = (client: GitHubClient["Service"]): PullRequestShape => {
	const list = Effect.fn("PullRequest.list")(function* (options?: {
		readonly head?: string | undefined;
		readonly base?: string | undefined;
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly page?: PageOptions | undefined;
	}) {
		const { owner, repo } = yield* Repo;
		const raw = yield* client.paginate(
			"GET /repos/{owner}/{repo}/pulls",
			{
				owner,
				repo,
				...(options?.state !== undefined ? { state: options.state } : {}),
				...(options?.head !== undefined ? { head: qualifyHead(owner, options.head) } : {}),
				...(options?.base !== undefined ? { base: options.base } : {}),
			},
			options?.page,
		);
		return yield* Effect.forEach(raw, project);
	});

	const create = Effect.fn("PullRequest.create")(function* (input: {
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, head: input.head, base: input.base });
		const created = yield* client.request("POST /repos/{owner}/{repo}/pulls", {
			owner,
			repo,
			title: input.title,
			head: input.head,
			base: input.base,
			...(input.body !== undefined ? { body: input.body } : {}),
			...(input.draft !== undefined ? { draft: input.draft } : {}),
		});
		return yield* project(created);
	});

	const update = Effect.fn("PullRequest.update")(function* (
		number: number,
		patch: {
			readonly title?: string | undefined;
			readonly body?: string | undefined;
			readonly state?: "open" | "closed" | undefined;
			readonly base?: string | undefined;
		},
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, number });
		const updated = yield* client.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
			owner,
			repo,
			pull_number: number,
			// Conditional spreads, not `...patch`: under exactOptionalPropertyTypes a
			// present-but-undefined key is not the same as an absent one, and octokit's
			// generated parameter types say so.
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.body !== undefined ? { body: patch.body } : {}),
			...(patch.state !== undefined ? { state: patch.state } : {}),
			...(patch.base !== undefined ? { base: patch.base } : {}),
		});
		return yield* project(updated);
	});

	return {
		list,
		create,
		update,

		get: Effect.fn("PullRequest.get")(function* (number: number) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number });
			const raw = yield* client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
				owner,
				repo,
				pull_number: number,
			});
			return yield* project(raw);
		}),

		listFiles: Effect.fn("PullRequest.listFiles")(function* (
			number: number,
			options?: { readonly page?: PageOptions | undefined },
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number });
			const files = yield* client.paginate(
				"GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
				{ owner, repo, pull_number: number },
				options?.page,
			);
			// The same `diff-entry` wire shape the single-commit read answers with,
			// so the same projection turns it into `CommitFile`s.
			return files.map(fileOf);
		}),

		listAssociatedWithCommit: Effect.fn("PullRequest.listAssociatedWithCommit")(function* (
			sha: string,
			options?: { readonly page?: PageOptions | undefined },
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, sha });
			const raw = yield* client.paginate(
				"GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls",
				{ owner, repo, commit_sha: sha },
				options?.page,
			);
			return yield* Effect.forEach(raw, project);
		}),

		upsert: Effect.fn("PullRequest.upsert")(function* (input: {
			readonly title: string;
			readonly head: string;
			readonly base: string;
			readonly body?: string | undefined;
			readonly draft?: boolean | undefined;
		}) {
			const existing = yield* list({
				head: input.head,
				base: input.base,
				state: "open",
				page: PageOptions.make({ perPage: 1, maxPages: 1 }),
			});
			const found = existing[0];
			if (found === undefined) {
				return { pullRequest: yield* create(input), created: true };
			}
			const patch = {
				title: input.title,
				...(input.body !== undefined ? { body: input.body } : {}),
			};
			return { pullRequest: yield* update(found.number, patch), created: false };
		}),

		merge: Effect.fn("PullRequest.merge")(function* (
			number: number,
			options?: {
				readonly method?: "merge" | "squash" | "rebase" | undefined;
				readonly commitTitle?: string | undefined;
				readonly commitMessage?: string | undefined;
			},
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number, method: options?.method ?? "merge" });
			const merged = yield* client.request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge", {
				owner,
				repo,
				pull_number: number,
				...(options?.method !== undefined ? { merge_method: options.method } : {}),
				...(options?.commitTitle !== undefined ? { commit_title: options.commitTitle } : {}),
				...(options?.commitMessage !== undefined ? { commit_message: options.commitMessage } : {}),
			});
			return merged.sha;
		}),

		addLabels: Effect.fn("PullRequest.addLabels")(function* (number: number, labels: ReadonlyArray<string>) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number, labels: labels.length });
			yield* client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
				owner,
				repo,
				issue_number: number,
				labels: [...labels],
			});
		}),

		requestReviewers: Effect.fn("PullRequest.requestReviewers")(function* (
			number: number,
			reviewers: {
				readonly users?: ReadonlyArray<string> | undefined;
				readonly teams?: ReadonlyArray<string> | undefined;
			},
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number });
			yield* client.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
				owner,
				repo,
				pull_number: number,
				...(reviewers.users !== undefined ? { reviewers: [...reviewers.users] } : {}),
				...(reviewers.teams !== undefined ? { team_reviewers: [...reviewers.teams] } : {}),
			});
		}),

		setAutoMerge: Effect.fn("PullRequest.setAutoMerge")(function* (
			pullRequest: PullRequestInfo,
			method: "merge" | "squash" | "rebase" | "off",
		) {
			yield* Effect.annotateCurrentSpan({ number: pullRequest.number, method });
			if (method === "off") {
				yield* client.graphql(DisableAutoMerge, { pullRequestId: pullRequest.nodeId });
				return;
			}
			yield* client.graphql(EnableAutoMerge, {
				pullRequestId: pullRequest.nodeId,
				mergeMethod: GRAPHQL_MERGE_METHOD[method],
			});
		}),
	};
};
