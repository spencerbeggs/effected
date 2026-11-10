import { Context, Effect, Exit, Layer, Option, Request, RequestResolver, Schema } from "effect";
import type { NonEmptyArray } from "effect/Array";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubGraphQLError, GraphQLDocument } from "./GraphQL.js";
import { unstubbed } from "./internal/unstubbed.js";
import { Repo } from "./Repo.js";

/**
 * A changelog lookup was handed a commit sha or pull request number it cannot
 * send.
 *
 * @remarks
 * The batch names each lookup by an alias built from its input
 * (`commit__<sha>`, `pull__<number>`), so the input must be something a
 * GraphQL alias can carry: a hexadecimal sha of 4 to 64 characters, or a
 * positive integer. Nothing is sent when this fails.
 *
 * @public
 */
export class InvalidChangelogRefError extends Schema.TaggedError<InvalidChangelogRefError>()(
	"InvalidChangelogRefError",
	{
		/** Which lookup refused it. */
		ref: Schema.Literals(["commit", "pull"]),
		/** What was handed in, as text. */
		input: Schema.String,
	},
) {
	override get message(): string {
		return this.ref === "commit"
			? `not a hexadecimal commit sha of 4 to 64 characters: ${JSON.stringify(this.input)}`
			: `not a positive pull request number: ${this.input}`;
	}
}

/**
 * What a changelog line says about one commit.
 *
 * @remarks
 * The shape `@changesets/get-github-info`'s `getInfo` returns, with every
 * value that can be missing as an `Option`. The links are markdown, in
 * upstream's exact format: the short sha in a code span linked to the commit
 * URL, `[#42](https://github.com/acme/widget/pull/42)` and
 * `[@octocat](https://github.com/octocat)`. Every URL is the one GitHub answered with, so on
 * GitHub Enterprise Server the links name that server; nothing here builds a
 * URL from a configured host.
 *
 * @public
 */
export class CommitChangelogInfo extends Schema.Class<CommitChangelogInfo>("CommitChangelogInfo")({
	/**
	 * The login to credit: the pull request's author when the commit has one,
	 * otherwise the GitHub user the commit's author maps to.
	 */
	user: Schema.Option(Schema.String),
	/** The pull request the commit landed through: the earliest-merged one, else the first GitHub lists. */
	pull: Schema.Option(Schema.Int),
	/** Markdown links for the line. */
	links: Schema.Struct({
		/** The first 7 characters of the sha asked for, in a code span, linked to the commit URL. */
		commit: Schema.String,
		/** `#` and the number, linked to the pull request URL, when there is a pull request. */
		pull: Schema.Option(Schema.String),
		/** `@` and the login, linked to the user's URL, when there is a user. */
		user: Schema.Option(Schema.String),
	}),
}) {}

/**
 * What a changelog line says about one pull request.
 *
 * @remarks
 * The shape `@changesets/get-github-info`'s `getInfoFromPullRequest` returns,
 * for a changeset that names its pull request (`pr: #42`) instead of leaving
 * it to the commit. Links are in the same format as
 * {@link CommitChangelogInfo}'s, from the URLs GitHub answered with.
 *
 * @public
 */
export class PullRequestChangelogInfo extends Schema.Class<PullRequestChangelogInfo>("PullRequestChangelogInfo")({
	/** The pull request author's login. */
	user: Schema.Option(Schema.String),
	/** The merge commit's abbreviated sha, once the pull request has merged. */
	commit: Schema.Option(Schema.String),
	/** Markdown links for the line. */
	links: Schema.Struct({
		/** The first 7 characters of the abbreviated merge sha, in a code span, linked to the commit URL, once merged. */
		commit: Schema.Option(Schema.String),
		/** `#` and the number, linked to the pull request URL. */
		pull: Schema.String,
		/** `@` and the login, linked to the user's URL, when the author still exists. */
		user: Schema.Option(Schema.String),
	}),
}) {}

/**
 * The commit and pull request facts a changelog line credits.
 *
 * @public
 */
export interface ChangelogInfoShape {
	/**
	 * What to credit for a commit of the surrounding `Repo`.
	 *
	 * @remarks
	 * `Option.none()` when the repository has no such commit (or the sha names
	 * something that is not a commit). Lookups that run concurrently are sent as
	 * one aliased GraphQL query, up to 50 per query: run them with
	 * `Effect.forEach(..., { concurrency: "unbounded" })` to get the batch.
	 */
	readonly commit: (
		sha: string,
	) => Effect.Effect<Option.Option<CommitChangelogInfo>, GitHubGraphQLError | InvalidChangelogRefError, Repo>;
	/**
	 * What to credit for a pull request of the surrounding `Repo`.
	 *
	 * @remarks
	 * `Option.none()` when the repository has no such pull request. Batched with
	 * concurrent {@link ChangelogInfoShape.commit} lookups into the same query.
	 */
	readonly pullRequest: (
		number: number,
	) => Effect.Effect<Option.Option<PullRequestChangelogInfo>, GitHubGraphQLError | InvalidChangelogRefError, Repo>;
}

/**
 * The commit and pull request facts a changelog line credits, batched into
 * one GraphQL query.
 *
 * @remarks
 * The kit's `@changesets/get-github-info`. The token and the server come from
 * the `GitHubClient` the layer is built over, and the repository from `Repo`;
 * nothing is read from the environment. The query is upstream's, alias for
 * alias, so concurrent lookups cost one round trip per 50.
 *
 * Two answers differ from upstream's, both toward the lookup convention: a
 * pull request number the repository does not have is `Option.none()` (GitHub
 * reports it as an error, which upstream throws for the whole batch), and a
 * sha naming a tree or blob is `Option.none()` (upstream builds links to
 * `undefined`). A missing repository still fails, with `kind: "notFound"`.
 *
 * Batching happens within one built service: each `ChangelogInfo.layer`
 * build owns its own resolver, and nothing is cached across batches.
 *
 * @example
 * ```ts
 * import { ChangelogInfo } from "@effected/github";
 * import { Effect, Option } from "effect";
 *
 * const lines = (shas: ReadonlyArray<string>) =>
 *   Effect.gen(function* () {
 *     const info = yield* ChangelogInfo;
 *     const found = yield* Effect.forEach(shas, info.commit, { concurrency: "unbounded" });
 *     return found.flatMap((entry) =>
 *       Option.match(entry, {
 *         onNone: () => [],
 *         onSome: ({ links }) => [`${Option.getOrElse(links.pull, () => links.commit)} Thanks ${Option.getOrElse(links.user, () => "")}`],
 *       }),
 *     );
 *   });
 * ```
 *
 * @public
 */
export class ChangelogInfo extends Context.Service<ChangelogInfo, ChangelogInfoShape>()(
	"@effected/github/ChangelogInfo",
) {
	/** The live service, built over a `GitHubClient`. */
	static readonly layer: Layer.Layer<ChangelogInfo, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; an unstubbed member dies when run, naming itself. */
	static readonly makeTest = (overrides: Partial<ChangelogInfoShape> = {}): ChangelogInfoShape => ({
		commit: overrides.commit ?? (() => dies("commit")),
		pullRequest: overrides.pullRequest ?? (() => dies("pullRequest")),
	});

	/** {@link ChangelogInfo.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<ChangelogInfoShape> = {}): Layer.Layer<ChangelogInfo> =>
		Layer.succeed(ChangelogInfo, ChangelogInfo.makeTest(overrides));
}

const dies = unstubbed("ChangelogInfo.makeTest");

/** Upstream's batch size (its dataloader's `maxBatchSize`). */
const BATCH_SIZE = 50;
/** The one repository alias a batch uses: a batch is always one repository. */
const REPO_ALIAS = "repo__0";
const SHA = /^[0-9a-f]{4,64}$/i;

interface CommitLookup extends Request.Request<Option.Option<CommitChangelogInfo>, GitHubGraphQLError> {
	readonly _tag: "CommitLookup";
	readonly owner: string;
	readonly repo: string;
	readonly sha: string;
}

interface PullLookup extends Request.Request<Option.Option<PullRequestChangelogInfo>, GitHubGraphQLError> {
	readonly _tag: "PullLookup";
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
}

type Lookup = CommitLookup | PullLookup;

const CommitLookup = Request.tagged<CommitLookup>("CommitLookup");
const PullLookup = Request.tagged<PullLookup>("PullLookup");

const aliasOf = (lookup: Lookup): string =>
	lookup._tag === "CommitLookup" ? `commit__${lookup.sha}` : `pull__${lookup.number}`;

const Actor = Schema.Struct({ login: Schema.String, url: Schema.String });

const AssociatedPull = Schema.Struct({
	number: Schema.Int,
	url: Schema.String,
	mergedAt: Schema.NullOr(Schema.String),
	author: Schema.NullOr(Actor),
});

const CommitNode = Schema.Struct({
	commitUrl: Schema.String,
	associatedPullRequests: Schema.NullOr(
		Schema.Struct({ nodes: Schema.NullOr(Schema.Array(Schema.NullOr(AssociatedPull))) }),
	),
	author: Schema.NullOr(Schema.Struct({ user: Schema.NullOr(Actor) })),
});

/** `object(expression:)` answers `{}` when the sha names a tree or blob: `... on Commit` selects nothing. */
const NotACommit = Schema.Record(Schema.String, Schema.Never);

const PullNode = Schema.Struct({
	url: Schema.String,
	author: Schema.NullOr(Actor),
	mergeCommit: Schema.NullOr(Schema.Struct({ commitUrl: Schema.String, abbreviatedOid: Schema.String })),
});

type CommitAnswer = typeof CommitNode.Type | typeof NotACommit.Type | null;
type PullAnswer = typeof PullNode.Type | null;

const COMMIT_FRAGMENT = `\
fragment CommitFragment on Commit {
  commitUrl
  associatedPullRequests(first: 50) {
    nodes {
      number
      url
      mergedAt
      author {
        login
        url
      }
    }
  }
  author {
    user {
      login
      url
    }
  }
}
`;

const PULL_FRAGMENT = `\
fragment PullFragment on PullRequest {
  url
  author {
    login
    url
  }
  mergeCommit {
    commitUrl
    abbreviatedOid
  }
}
`;

/**
 * Upstream's `makeQuery` for one repository, character for character.
 *
 * @remarks
 * Values are inlined, as upstream does, and that is safe only because of what
 * reaches here: owner and name through `JSON.stringify` (a JSON string literal
 * is a GraphQL string literal), a sha that matched {@link SHA} and a positive
 * integer. Aliases are built from the same validated values.
 */
const queryFor = (owner: string, repo: string, lookups: ReadonlyArray<Lookup>): string => {
	let query = `query {\n  ${REPO_ALIAS}: repository(\n    owner: ${JSON.stringify(owner)},\n    name: ${JSON.stringify(repo)}\n  ) {\n`;
	for (const lookup of lookups) {
		query +=
			lookup._tag === "CommitLookup"
				? `    ${aliasOf(lookup)}: object(expression: ${JSON.stringify(lookup.sha)}) {\n      ... on Commit {\n        ...CommitFragment\n      }\n    }\n`
				: `    ${aliasOf(lookup)}: pullRequest(number: ${JSON.stringify(lookup.number)}) {\n      ...PullFragment\n    }\n`;
	}
	query += "  }\n}\n";
	if (lookups.some((lookup) => lookup._tag === "CommitLookup")) query += COMMIT_FRAGMENT;
	if (lookups.some((lookup) => lookup._tag === "PullLookup")) query += PULL_FRAGMENT;
	return query;
};

/** The whole answer: one repository alias holding one field per lookup alias, each decoded on its own. */
const BatchResponse = Schema.Struct({ [REPO_ALIAS]: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)) });

const documentFor = (owner: string, repo: string, lookups: ReadonlyArray<Lookup>) =>
	GraphQLDocument.make({
		name: "changelogInfo",
		document: queryFor(owner, repo, lookups),
		response: BatchResponse,
	})<Record<string, never>>();

const decodeCommit = Schema.decodeUnknownEffect(Schema.NullOr(Schema.Union([CommitNode, NotACommit])));
const decodePull = Schema.decodeUnknownEffect(Schema.NullOr(PullNode));

/**
 * The pull request aliases GitHub reported as not found, when that is all it
 * reported; `undefined` when any entry is something else, such as the
 * repository itself being missing.
 */
const missingPulls = (error: GitHubGraphQLError, lookups: ReadonlyArray<Lookup>): ReadonlySet<string> | undefined => {
	if (error.kind !== "notFound" || error.errors.length === 0) return undefined;
	const pulls = new Set(lookups.filter((lookup) => lookup._tag === "PullLookup").map(aliasOf));
	const missing = new Set<string>();
	for (const entry of error.errors) {
		const [repoStep, fieldStep, ...rest] = entry.path ?? [];
		if (entry.type !== "NOT_FOUND" || repoStep !== REPO_ALIAS || rest.length > 0) return undefined;
		if (typeof fieldStep !== "string" || !pulls.has(fieldStep)) return undefined;
		missing.add(fieldStep);
	}
	return missing;
};

/** Earliest `mergedAt` first, unmerged last, ties in GitHub's order: upstream's sort. */
const byMergedAt = (a: { readonly mergedAt: string | null }, b: { readonly mergedAt: string | null }): number => {
	if (a.mergedAt === null && b.mergedAt === null) return 0;
	if (a.mergedAt === null) return 1;
	if (b.mergedAt === null) return -1;
	return new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime();
};

const isCommit = (answer: typeof CommitNode.Type | typeof NotACommit.Type): answer is typeof CommitNode.Type =>
	"commitUrl" in answer;

const commitInfo = (sha: string, answer: CommitAnswer): Option.Option<CommitChangelogInfo> => {
	if (answer === null || !isCommit(answer)) return Option.none();
	const node = answer;
	const pulls = (node.associatedPullRequests?.nodes ?? []).filter((pull) => pull !== null);
	const pull = Option.fromNullishOr([...pulls].sort(byMergedAt)[0]);
	const author = Option.orElse(
		Option.flatMap(pull, (found) => Option.fromNullishOr(found.author)),
		() => Option.fromNullishOr(node.author?.user),
	);
	return Option.some(
		CommitChangelogInfo.make({
			user: Option.map(author, (actor) => actor.login),
			pull: Option.map(pull, (found) => found.number),
			links: {
				commit: `[\`${sha.slice(0, 7)}\`](${node.commitUrl})`,
				pull: Option.map(pull, (found) => `[#${found.number}](${found.url})`),
				user: Option.map(author, (actor) => `[@${actor.login}](${actor.url})`),
			},
		}),
	);
};

const pullInfo = (number: number, answer: PullAnswer): Option.Option<PullRequestChangelogInfo> => {
	if (answer === null) return Option.none();
	const author = Option.fromNullishOr(answer.author);
	const merge = Option.fromNullishOr(answer.mergeCommit);
	return Option.some(
		PullRequestChangelogInfo.make({
			user: Option.map(author, (actor) => actor.login),
			commit: Option.map(merge, (commit) => commit.abbreviatedOid),
			links: {
				commit: Option.map(merge, (commit) => `[\`${commit.abbreviatedOid.slice(0, 7)}\`](${commit.commitUrl})`),
				pull: `[#${number}](${answer.url})`,
				user: Option.map(author, (actor) => `[@${actor.login}](${actor.url})`),
			},
		}),
	);
};

const make = (client: GitHubClient["Service"]): ChangelogInfoShape => {
	/**
	 * Every alias's answer, `null` for a missing one. A batch whose only errors
	 * are missing pull requests is sent again without them, so each round drops
	 * at least one lookup and the loop ends.
	 */
	const answers = (
		owner: string,
		repo: string,
		lookups: ReadonlyArray<Lookup>,
	): Effect.Effect<ReadonlyMap<string, unknown>, GitHubGraphQLError> =>
		lookups.length === 0
			? Effect.succeed(new Map())
			: client.graphql(documentFor(owner, repo, lookups), {}).pipe(
					Effect.map((data) => new Map<string, unknown>(Object.entries(data[REPO_ALIAS] ?? {}))),
					Effect.catchTag("GitHubGraphQLError", (error) => {
						const missing = missingPulls(error, lookups);
						if (missing === undefined) return Effect.fail(error);
						return Effect.map(
							answers(
								owner,
								repo,
								lookups.filter((lookup) => !missing.has(aliasOf(lookup))),
							),
							(found) => new Map([...found, ...[...missing].map((alias) => [alias, null] as const)]),
						);
					}),
				);

	const resolver = RequestResolver.makeGrouped<Lookup, string>({
		key: ({ request }) => `${request.owner}/${request.repo}`,
		resolver: (entries: NonEmptyArray<Request.Entry<Lookup>>) =>
			Effect.gen(function* () {
				const { owner, repo } = entries[0].request;
				// One alias per distinct lookup: a sha asked for twice is queried once.
				const distinct = [...new Map(entries.map((entry) => [aliasOf(entry.request), entry.request])).values()];
				yield* Effect.annotateCurrentSpan({ owner, repo, lookups: distinct.length });
				const found = yield* answers(owner, repo, distinct);
				const decoded = new Map<string, Option.Option<CommitChangelogInfo> | Option.Option<PullRequestChangelogInfo>>();
				for (const lookup of distinct) {
					const alias = aliasOf(lookup);
					const raw = found.get(alias) ?? null;
					const info =
						lookup._tag === "CommitLookup"
							? yield* Effect.map(decodeCommit(raw), (answer) => commitInfo(lookup.sha, answer))
							: yield* Effect.map(decodePull(raw), (answer) => pullInfo(lookup.number, answer));
					decoded.set(alias, info);
				}
				for (const entry of entries) {
					entry.completeUnsafe(Exit.succeed(decoded.get(aliasOf(entry.request)) ?? Option.none<never>()));
				}
			}).pipe(
				Effect.catchTag("SchemaError", (error) =>
					Effect.fail(GitHubGraphQLError.decode("changelogInfo", "response did not match its schema", error)),
				),
				Effect.withSpan("ChangelogInfo.batch"),
			),
	}).pipe(RequestResolver.batchN(BATCH_SIZE));

	return {
		commit: Effect.fn("ChangelogInfo.commit")(function* (sha: string) {
			if (!SHA.test(sha)) return yield* new InvalidChangelogRefError({ ref: "commit", input: sha });
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, sha });
			return yield* Effect.request(CommitLookup({ owner, repo, sha }), resolver);
		}),
		pullRequest: Effect.fn("ChangelogInfo.pullRequest")(function* (number: number) {
			if (!Number.isSafeInteger(number) || number < 1) {
				return yield* new InvalidChangelogRefError({ ref: "pull", input: String(number) });
			}
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, number });
			return yield* Effect.request(PullLookup({ owner, repo, number }), resolver);
		}),
	};
};
