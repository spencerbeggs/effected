import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import type { GitHubGraphQLError } from "./GraphQL.js";
import { GraphQLDocument } from "./GraphQL.js";
import { Repo } from "./Repo.js";
import type { PageOptions } from "./Rest.js";

/**
 * An issue, projected to what callers read.
 *
 * @public
 */
export class IssueInfo extends Schema.Class<IssueInfo>("IssueInfo")({
	number: Schema.Int,
	title: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	/** Label names, normalized from GitHub's `string | { name }` union. */
	labels: Schema.Array(Schema.String),
	url: Schema.String,
	/** The GraphQL node id. */
	nodeId: Schema.String,
}) {}

/**
 * An issue a pull request closes.
 *
 * @public
 */
export class LinkedIssue extends Schema.Class<LinkedIssue>("LinkedIssue")({
	number: Schema.Int,
	title: Schema.String,
	state: Schema.String,
	url: Schema.String,
	nodeId: Schema.String,
	/**
	 * Whether a human wrote the link, rather than GitHub inferring it from the
	 * branch or commit messages.
	 *
	 * @remarks
	 * This is the field the whole document exists for. The version this replaces
	 * could not express `userLinkedOnly`, so one consumer re-declared the query
	 * with the field aliased twice to get it — the single largest duplicated
	 * document in the survey.
	 */
	userLinked: Schema.Boolean,
}) {}

const IssueNodes = Schema.Struct({
	id: Schema.String,
	number: Schema.Int,
	title: Schema.String,
	state: Schema.String,
	url: Schema.String,
});

const LinkedIssuesResponse = Schema.Struct({
	repository: Schema.Struct({
		pullRequest: Schema.Struct({
			allLinked: Schema.Struct({ nodes: Schema.Array(IssueNodes) }),
			manuallyLinked: Schema.Struct({ nodes: Schema.Array(IssueNodes) }),
		}),
	}),
});

const LinkedIssuesDocument = GraphQLDocument.make({
	name: "linkedIssues",
	document: `query ($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      allLinked: closingIssuesReferences(first: 50) { nodes { id number title state url } }
      manuallyLinked: closingIssuesReferences(first: 50, userLinkedOnly: true) { nodes { id number title state url } }
    }
  }
}`,
	response: LinkedIssuesResponse,
})<{ readonly owner: string; readonly repo: string; readonly prNumber: number }>();

const CrossReferencedResponse = Schema.Struct({
	repository: Schema.Struct({
		issue: Schema.Struct({
			timelineItems: Schema.Struct({
				nodes: Schema.Array(
					Schema.Struct({
						source: Schema.optionalKey(
							Schema.Struct({
								__typename: Schema.optionalKey(Schema.String),
								number: Schema.optionalKey(Schema.Int),
							}),
						),
					}),
				),
			}),
		}),
	}),
});

const CrossReferencedDocument = GraphQLDocument.make({
	name: "issueCrossReferences",
	document: `query ($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      timelineItems(last: 50, itemTypes: CROSS_REFERENCED_EVENT) {
        nodes {
          __typename
          ... on CrossReferencedEvent { source { __typename ... on PullRequest { number } } }
        }
      }
    }
  }
}`,
	response: CrossReferencedResponse,
})<{ readonly owner: string; readonly repo: string; readonly issueNumber: number }>();

/**
 * Issues.
 *
 * @public
 */
export interface GitHubIssueShape {
	readonly get: (number: number) => Effect.Effect<IssueInfo, GitHubError, Repo>;
	readonly list: (options?: {
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly labels?: ReadonlyArray<string> | undefined;
		readonly page?: PageOptions | undefined;
	}) => Effect.Effect<ReadonlyArray<IssueInfo>, GitHubError, Repo>;
	readonly close: (number: number, reason?: "completed" | "not_planned") => Effect.Effect<void, GitHubError, Repo>;
	/** Post a comment. */
	readonly comment: (number: number, body: string) => Effect.Effect<number, GitHubError, Repo>;
	/** The issues a pull request closes, with `userLinked` telling you who linked them. */
	readonly linkedIssues: (prNumber: number) => Effect.Effect<ReadonlyArray<LinkedIssue>, GitHubGraphQLError, Repo>;
	/**
	 * Has `prNumber` already been cross-referenced on this issue?
	 *
	 * @remarks
	 * The idempotence guard one consumer wrote a bespoke timeline query for,
	 * so that re-running a workflow does not comment twice.
	 */
	readonly isCrossReferencedBy: (
		issueNumber: number,
		prNumber: number,
	) => Effect.Effect<boolean, GitHubGraphQLError, Repo>;
}

/**
 * Issues.
 *
 * @public
 */
export class GitHubIssue extends Context.Service<GitHubIssue, GitHubIssueShape>()("@effected/github/GitHubIssue") {
	static readonly layer: Layer.Layer<GitHubIssue, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<GitHubIssueShape> = {}): GitHubIssueShape => ({
		get: overrides.get ?? (() => unstubbed("get")),
		list: overrides.list ?? (() => unstubbed("list")),
		close: overrides.close ?? (() => unstubbed("close")),
		comment: overrides.comment ?? (() => unstubbed("comment")),
		linkedIssues: overrides.linkedIssues ?? (() => unstubbed("linkedIssues")),
		isCrossReferencedBy: overrides.isCrossReferencedBy ?? (() => unstubbed("isCrossReferencedBy")),
	});

	/** {@link GitHubIssue.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubIssueShape> = {}): Layer.Layer<GitHubIssue> =>
		Layer.succeed(GitHubIssue, GitHubIssue.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`GitHubIssue.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** GitHub sends a label as either a string or an object; callers want the name. */
const labelNames = (labels: ReadonlyArray<string | { name?: string | undefined }>): ReadonlyArray<string> =>
	labels.flatMap((label) => (typeof label === "string" ? [label] : label.name !== undefined ? [label.name] : []));

interface RawIssue {
	readonly number: number;
	readonly title: string;
	readonly state: string;
	readonly labels: ReadonlyArray<string | { name?: string | undefined }>;
	readonly html_url: string;
	readonly node_id: string;
}

const project = (raw: RawIssue): IssueInfo =>
	IssueInfo.make({
		number: raw.number,
		title: raw.title,
		state: raw.state === "closed" ? "closed" : "open",
		labels: labelNames(raw.labels),
		url: raw.html_url,
		nodeId: raw.node_id,
	});

const make = (client: GitHubClient["Service"]): GitHubIssueShape => ({
	get: Effect.fn("GitHubIssue.get")(function* (number: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, number });
		const raw = yield* client.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
			owner,
			repo,
			issue_number: number,
		});
		return project(raw);
	}),

	list: Effect.fn("GitHubIssue.list")(function* (options?: {
		readonly state?: "open" | "closed" | "all" | undefined;
		readonly labels?: ReadonlyArray<string> | undefined;
		readonly page?: PageOptions | undefined;
	}) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });
		const raw = yield* client.paginate(
			"GET /repos/{owner}/{repo}/issues",
			{
				owner,
				repo,
				...(options?.state !== undefined ? { state: options.state } : {}),
				...(options?.labels !== undefined ? { labels: options.labels.join(",") } : {}),
			},
			options?.page,
		);
		return raw.map(project);
	}),

	close: Effect.fn("GitHubIssue.close")(function* (number: number, reason?: "completed" | "not_planned") {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, number });
		yield* client.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
			owner,
			repo,
			issue_number: number,
			state: "closed",
			...(reason !== undefined ? { state_reason: reason } : {}),
		});
	}),

	comment: Effect.fn("GitHubIssue.comment")(function* (number: number, body: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, number });
		const created = yield* client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
			owner,
			repo,
			issue_number: number,
			body,
		});
		return created.id;
	}),

	linkedIssues: Effect.fn("GitHubIssue.linkedIssues")(function* (prNumber: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, prNumber });
		const result = yield* client.graphql(LinkedIssuesDocument, { owner, repo, prNumber });
		const manual = new Set(result.repository.pullRequest.manuallyLinked.nodes.map((node) => node.number));
		return result.repository.pullRequest.allLinked.nodes.map((node) =>
			LinkedIssue.make({
				number: node.number,
				title: node.title,
				state: node.state,
				url: node.url,
				nodeId: node.id,
				userLinked: manual.has(node.number),
			}),
		);
	}),

	isCrossReferencedBy: Effect.fn("GitHubIssue.isCrossReferencedBy")(function* (issueNumber: number, prNumber: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, issueNumber, prNumber });
		const result = yield* client.graphql(CrossReferencedDocument, { owner, repo, issueNumber });
		return result.repository.issue.timelineItems.nodes.some(
			(node) => node.source?.__typename === "PullRequest" && node.source.number === prNumber,
		);
	}),
});
