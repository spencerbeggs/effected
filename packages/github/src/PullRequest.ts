import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { CommitFile } from "./GitHubCommit.js";
import { fileOf } from "./GitHubCommit.js";
import { GitHubError } from "./GitHubError.js";
import { GitHubGraphQLError, GraphQLDocument } from "./GraphQL.js";
import { unstubbed } from "./internal/unstubbed.js";
import { Repo } from "./Repo.js";
import { PageOptions } from "./Rest.js";

/** How a pull request is merged. @public */
export const MergeMethod = Schema.Literals(["merge", "squash", "rebase"]);

/**
 * A pull request, projected to what callers read.
 *
 * @remarks
 * This is the **domain** shape, and the only pull-request type this package
 * exports. It flattens GitHub's nested `head`/`base` objects to
 * `head`/`headSha` and `base`/`baseSha`, and spells the link `url`. If you are
 * writing a test double or a fixture, this is the type you build.
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
	/**
	 * The sha of the commit the merge produced; absent until the pull request
	 * has merged.
	 *
	 * @remarks
	 * Read from GraphQL's `PullRequest.mergeCommit.oid`. The REST pull request
	 * object no longer carries `merge_commit_sha` under the api-version this
	 * package pins, so a merged pull request costs one extra GraphQL round trip
	 * per single read (`get`, `update`, `upsert`), and an open or
	 * closed-unmerged one costs nothing. When the REST response does carry the
	 * field (a client pinned to an older api-version), it is used for a merged
	 * pull request and the GraphQL read is skipped.
	 *
	 * **A list read leaves it absent unless asked.** `list` and
	 * `listAssociatedWithCommit` fill it only when called with
	 * `mergeCommits: true`, at one GraphQL call per 100 merged pull requests.
	 *
	 * It is never the speculative test-merge commit GitHub computes for an open
	 * pull request, so `mergeCommitSha === sha` means "this commit is what the
	 * pull request merged as".
	 */
	mergeCommitSha: Schema.optionalKey(Schema.String),
}) {}

/**
 * What {@link PullRequestShape.upsert} did.
 *
 * @public
 */
export interface UpsertedPullRequest {
	/** The pull request, as created or as updated. */
	readonly pullRequest: PullRequestInfo;
	/** `true` when a new pull request was opened, `false` when an open one was updated. */
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

/**
 * One answer per requested id, **in request order**: a merged pull request
 * carries its merge commit, and a node of another type answers `{}`.
 */
const MergeCommitsResponse = Schema.Struct({
	nodes: Schema.Array(
		Schema.NullOr(
			Schema.Struct({
				mergeCommit: Schema.optionalKey(Schema.NullOr(Schema.Struct({ oid: Schema.String }))),
			}),
		),
	),
});

const MergeCommits = GraphQLDocument.make({
	name: "PullRequestMergeCommits",
	document: `query PullRequestMergeCommits($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest { mergeCommit { oid } }
  }
}`,
	response: MergeCommitsResponse,
})<{ readonly ids: ReadonlyArray<string> }>();

/** GraphQL's `nodes(ids:)` accepts at most this many ids per call. */
const NODES_PER_QUERY = 100;

/** How many `nodes(ids:)` calls a list's merge-commit read keeps in flight. */
const MERGE_COMMIT_CONCURRENCY = 4;

/** GraphQL spells the merge methods in capitals. */
const GRAPHQL_MERGE_METHOD = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

/**
 * Read, list, create, update, merge and label pull requests, and control
 * auto-merge.
 *
 * @public
 */
export interface PullRequestShape {
	/** Read one pull request. Fails `notFound` when it does not exist. */
	readonly get: (number: number) => Effect.Effect<PullRequestInfo, GitHubError | GitHubGraphQLError, Repo>;
	/**
	 * Open, closed or all pull requests, optionally filtered.
	 *
	 * @remarks
	 * `head` accepts **either** the qualified `owner:ref` GitHub's filter wants
	 * or a bare `ref`, which is qualified with the current repo's owner on the
	 * way out. So for a pull request opened **from the current repository**,
	 * feeding this method `PullRequestInfo.head` (the bare branch name)
	 * round-trips correctly; GitHub's own route ignores an unqualified ref.
	 *
	 * **The round trip does not hold for a fork-originated pull request.**
	 * `PullRequestInfo` projects only the ref and drops the source owner, so
	 * qualifying it here prefixes the *current* repo's owner and names a branch
	 * in the wrong account — the filter then matches nothing, silently. When the
	 * head may live in a fork, pass a qualified `owner:ref` built from the source
	 * owner rather than from anything this projection carries.
	 *
	 * **`mergeCommitSha` is absent on every result unless `mergeCommits` is
	 * `true`.** The REST list no longer carries it, and filling it costs one
	 * GraphQL call per 100 merged pull requests in the result, so it is opt-in.
	 * Only with the option can this fail with `GitHubGraphQLError`.
	 */
	readonly list: (options?: {
		readonly head?: string | undefined;
		readonly base?: string | undefined;
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly page?: PageOptions | undefined;
		/** Fill `mergeCommitSha` on merged results from GraphQL. Defaults to `false`. */
		readonly mergeCommits?: boolean | undefined;
	}) => Effect.Effect<ReadonlyArray<PullRequestInfo>, GitHubError | GitHubGraphQLError, Repo>;
	/**
	 * The files a pull request changes.
	 *
	 * @remarks
	 * Each entry is a full {@link CommitFile} — path **and** status, plus the
	 * line counts and any pre-rename path — the same projection
	 * `GitHubCommit.changedFiles` returns, because GitHub answers both
	 * endpoints with the same `diff-entry` shape.
	 */
	readonly listFiles: (
		number: number,
		options?: { readonly page?: PageOptions | undefined },
	) => Effect.Effect<ReadonlyArray<CommitFile>, GitHubError, Repo>;
	/**
	 * The pull requests associated with a commit.
	 *
	 * @remarks
	 * Paginated: pass `page` to bound the walk.
	 *
	 * **`mergeCommitSha` is absent on every result unless `mergeCommits` is
	 * `true`**, at one GraphQL call per 100 merged pull requests — so a caller
	 * matching `sha` against the merge commit passes it. Only with the option
	 * can this fail with `GitHubGraphQLError`.
	 */
	readonly listAssociatedWithCommit: (
		sha: string,
		options?: {
			readonly page?: PageOptions | undefined;
			/** Fill `mergeCommitSha` on merged results from GraphQL. Defaults to `false`. */
			readonly mergeCommits?: boolean | undefined;
		},
	) => Effect.Effect<ReadonlyArray<PullRequestInfo>, GitHubError | GitHubGraphQLError, Repo>;
	/** Open a pull request from `head` into `base`. */
	readonly create: (input: {
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}) => Effect.Effect<PullRequestInfo, GitHubError, Repo>;
	/** Patch a pull request; only the fields given are sent. */
	readonly update: (
		number: number,
		patch: {
			readonly title?: string | undefined;
			readonly body?: string | undefined;
			readonly state?: "open" | "closed" | undefined;
			readonly base?: string | undefined;
		},
	) => Effect.Effect<PullRequestInfo, GitHubError | GitHubGraphQLError, Repo>;
	/**
	 * Update the open pull request for `head`→`base`, or open one.
	 *
	 * @remarks
	 * When a pull request is already open, only `title` and `body` are updated;
	 * `draft` applies only when a new pull request is opened.
	 */
	readonly upsert: (input: {
		readonly title: string;
		readonly head: string;
		readonly base: string;
		readonly body?: string | undefined;
		readonly draft?: boolean | undefined;
	}) => Effect.Effect<UpsertedPullRequest, GitHubError | GitHubGraphQLError, Repo>;
	/** Merge a pull request and return the merge commit sha. `method` defaults to GitHub's choice. */
	readonly merge: (
		number: number,
		options?: {
			readonly method?: "merge" | "squash" | "rebase" | undefined;
			readonly commitTitle?: string | undefined;
			readonly commitMessage?: string | undefined;
		},
	) => Effect.Effect<string, GitHubError, Repo>;
	/** Add labels to a pull request (as an issue), keeping the ones already there. */
	readonly addLabels: (number: number, labels: ReadonlyArray<string>) => Effect.Effect<void, GitHubError, Repo>;
	/** Request reviews from users and/or teams (team slugs). */
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
	 * An explicit call, not an option on `create`/`update`, so a create that
	 * worked is never reported as failed because auto-merge was refused. Pass
	 * `"off"` to disable it.
	 */
	readonly setAutoMerge: (
		pullRequest: PullRequestInfo,
		method: "merge" | "squash" | "rebase" | "off",
	) => Effect.Effect<void, GitHubGraphQLError, Repo>;
}

/**
 * Read, list, create, update, merge and label pull requests, and control
 * auto-merge.
 *
 * @remarks
 * Provide it with {@link PullRequest.layer}, which needs a `GitHubClient`; each
 * method also needs a `Repo` in `R`.
 *
 * @example
 * ```ts
 * import { PullRequest } from "@effected/github";
 * import { Effect } from "effect";
 *
 * const openOrUpdate = Effect.gen(function* () {
 *   const pulls = yield* PullRequest;
 *   const { pullRequest, created } = yield* pulls.upsert({
 *     title: "chore: release",
 *     head: "changeset-release/main",
 *     base: "main",
 *   });
 *   yield* pulls.setAutoMerge(pullRequest, "squash");
 *   return created;
 * });
 * ```
 *
 * @public
 */
export class PullRequest extends Context.Service<PullRequest, PullRequestShape>()("@effected/github/PullRequest") {
	/** The live service, built over a `GitHubClient`. */
	static readonly layer: Layer.Layer<PullRequest, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; an unstubbed member dies when run, naming itself. */
	static readonly makeTest = (overrides: Partial<PullRequestShape> = {}): PullRequestShape => ({
		get: overrides.get ?? (() => dies("get")),
		list: overrides.list ?? (() => dies("list")),
		listFiles: overrides.listFiles ?? (() => dies("listFiles")),
		listAssociatedWithCommit: overrides.listAssociatedWithCommit ?? (() => dies("listAssociatedWithCommit")),
		create: overrides.create ?? (() => dies("create")),
		update: overrides.update ?? (() => dies("update")),
		upsert: overrides.upsert ?? (() => dies("upsert")),
		merge: overrides.merge ?? (() => dies("merge")),
		addLabels: overrides.addLabels ?? (() => dies("addLabels")),
		requestReviewers: overrides.requestReviewers ?? (() => dies("requestReviewers")),
		setAutoMerge: overrides.setAutoMerge ?? (() => dies("setAutoMerge")),
	});

	/** {@link PullRequest.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<PullRequestShape> = {}): Layer.Layer<PullRequest> =>
		Layer.succeed(PullRequest, PullRequest.makeTest(overrides));
}

const dies = unstubbed("PullRequest.makeTest");

/**
 * The raw REST wire shape, as GitHub answers it — **not** the domain type.
 * {@link PullRequestInfo} is what callers read; `project` below is the one
 * conversion between them. Private on purpose: nothing outside this module
 * should hold a value of this shape.
 */
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
		try: () => {
			const merged = raw.merged ?? raw.merged_at != null;
			return PullRequestInfo.make({
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
				merged,
				// Constructed rather than decoded: the Type side of
				// `Schema.Option(DateTimeUtcFromString)` is an `Option<DateTime.Utc>`,
				// and GitHub's wire form is a nullable ISO string — two different
				// shapes, so the conversion belongs here rather than in a codec that
				// would have to describe GitHub's encoding as if it were ours.
				mergedAt: raw.merged_at == null ? Option.none() : Option.some(DateTime.makeUnsafe(raw.merged_at)),
				...(raw.body != null ? { body: raw.body } : {}),
				// Only for a merged pull request: on an open one an older api-version
				// reports the speculative test-merge commit, which is not a merge.
				...(raw.merge_commit_sha != null && merged ? { mergeCommitSha: raw.merge_commit_sha } : {}),
			});
		},
		catch: (error) => GitHubError.decode("PullRequest", "GitHub returned an unexpected pull request", error),
	});

/** `owner:branch` is what GitHub's `head` filter wants for a cross-fork search. */
const qualifyHead = (owner: string, head: string): string => (head.includes(":") ? head : `${owner}:${head}`);

const make = (client: GitHubClient["Service"]): PullRequestShape => {
	/**
	 * Fill `mergeCommitSha` for every merged pull request that lacks it, from
	 * GraphQL, in as few `nodes(ids:)` calls as the batch limit allows.
	 *
	 * @remarks
	 * The REST object stopped carrying `merge_commit_sha`, and the field is an
	 * `optionalKey`, so without this it would decode clean as always-absent —
	 * a silent break for anything matching a commit against it. Nothing is
	 * requested when no pull request in the batch needs it.
	 *
	 * `nodes(ids:)` answers positionally — one entry per id, in order, `null`
	 * for an id that resolves to nothing — so each answer is joined to the id
	 * at its index. An answer of the wrong length cannot be joined that way and
	 * fails as a decode error rather than pairing shas with the wrong pulls.
	 */
	const withMergeCommits = (
		pulls: ReadonlyArray<PullRequestInfo>,
	): Effect.Effect<ReadonlyArray<PullRequestInfo>, GitHubGraphQLError> => {
		const ids = pulls.filter((pull) => pull.merged && pull.mergeCommitSha === undefined).map((pull) => pull.nodeId);
		if (ids.length === 0) return Effect.succeed(pulls);
		const batches: Array<ReadonlyArray<string>> = [];
		for (let i = 0; i < ids.length; i += NODES_PER_QUERY) batches.push(ids.slice(i, i + NODES_PER_QUERY));
		return Effect.forEach(
			batches,
			(batch) =>
				Effect.flatMap(client.graphql(MergeCommits, { ids: batch }), (answer) =>
					answer.nodes.length === batch.length
						? Effect.succeed(batch.map((id, index) => [id, answer.nodes[index]?.mergeCommit?.oid] as const))
						: Effect.fail(
								GitHubGraphQLError.decode(
									MergeCommits.name,
									`nodes(ids:) answered ${answer.nodes.length} entries for ${batch.length} ids`,
								),
							),
				),
			{ concurrency: MERGE_COMMIT_CONCURRENCY },
		).pipe(
			Effect.map((answers) => {
				const oids = new Map<string, string>();
				for (const [id, oid] of answers.flat()) if (oid !== undefined) oids.set(id, oid);
				return pulls.map((pull) => {
					const oid = pull.mergeCommitSha === undefined ? oids.get(pull.nodeId) : undefined;
					return oid === undefined ? pull : PullRequestInfo.make({ ...pull, mergeCommitSha: oid });
				});
			}),
		);
	};

	const withMergeCommit = (pull: PullRequestInfo): Effect.Effect<PullRequestInfo, GitHubGraphQLError> =>
		Effect.map(withMergeCommits([pull]), (pulls) => pulls[0] ?? pull);

	const list = Effect.fn("PullRequest.list")(function* (options?: {
		readonly head?: string | undefined;
		readonly base?: string | undefined;
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly page?: PageOptions | undefined;
		readonly mergeCommits?: boolean | undefined;
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
		const pulls = yield* Effect.forEach(raw, project);
		return options?.mergeCommits === true ? yield* withMergeCommits(pulls) : pulls;
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
		return yield* withMergeCommit(yield* project(updated));
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
			return yield* withMergeCommit(yield* project(raw));
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
			options?: { readonly page?: PageOptions | undefined; readonly mergeCommits?: boolean | undefined },
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, sha });
			const raw = yield* client.paginate(
				"GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls",
				{ owner, repo, commit_sha: sha },
				options?.page,
			);
			const pulls = yield* Effect.forEach(raw, project);
			return options?.mergeCommits === true ? yield* withMergeCommits(pulls) : pulls;
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
