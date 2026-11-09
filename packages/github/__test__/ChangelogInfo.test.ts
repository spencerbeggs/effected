import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import { ChangelogInfo, CommitChangelogInfo, PullRequestChangelogInfo } from "../src/ChangelogInfo.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { Repo } from "../src/Repo.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";
import { REPO, defectMessage, harness } from "./harness.js";

/**
 * Every expected query text and every expected link below was captured by
 * running `@changesets/get-github-info@1.0.1`'s `getCommitInfo` and
 * `getPullRequestInfo` against a stubbed `fetch` that recorded the request
 * body and answered with the same `data` these tests reply with. They are
 * upstream's answers, not ones written to agree with this module.
 */

const COMMIT_FRAGMENT = `fragment CommitFragment on Commit {
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

const PULL_FRAGMENT = `fragment PullFragment on PullRequest {
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

const commitField = (sha: string): string => `    commit__${sha}: object(expression: "${sha}") {
      ... on Commit {
        ...CommitFragment
      }
    }
`;

const pullField = (number: number): string => `    pull__${number}: pullRequest(number: ${number}) {
      ...PullFragment
    }
`;

const HEAD = `query {
  repo__0: repository(
    owner: "acme",
    name: "widget"
  ) {
`;

/** Upstream's single-commit query, as recorded. */
const SINGLE_COMMIT_QUERY = `${HEAD}${commitField("fffffff6")}  }
}
${COMMIT_FRAGMENT}`;

/** Upstream's single-pull query, as recorded. */
const SINGLE_PULL_QUERY = `${HEAD}${pullField(8)}  }
}
${PULL_FRAGMENT}`;

const SHAS = ["aaaaaaa1111111", "bbbbbbb2222222", "ccccccc3333333", "ddddddd4444444", "eeeeeee5555555"] as const;

/** Upstream's batched query for five commits and two pulls in one tick, as recorded. */
const BATCH_QUERY = `${HEAD}${SHAS.map(commitField).join("")}${pullField(42)}${pullField(43)}  }
}
${COMMIT_FRAGMENT}${PULL_FRAGMENT}`;

const GH = "https://github.com";
const GHE = "https://ghe.example";

/** The `data` both upstream and this module were answered with. */
const BATCH_DATA = {
	repo__0: {
		commit__aaaaaaa1111111: {
			commitUrl: `${GHE}/acme/widget/commit/aaaaaaa1111111`,
			associatedPullRequests: { nodes: [] },
			author: { user: { login: "alice", url: `${GHE}/alice` } },
		},
		commit__bbbbbbb2222222: {
			commitUrl: `${GH}/acme/widget/commit/bbbbbbb2222222`,
			associatedPullRequests: {
				nodes: [
					{ number: 9, url: `${GH}/acme/widget/pull/9`, mergedAt: null, author: { login: "open", url: `${GH}/open` } },
					{
						number: 7,
						url: `${GH}/acme/widget/pull/7`,
						mergedAt: "2026-02-01T00:00:00Z",
						author: { login: "late", url: `${GH}/late` },
					},
					{
						number: 5,
						url: `${GH}/acme/widget/pull/5`,
						mergedAt: "2026-01-01T00:00:00Z",
						author: { login: "early", url: `${GH}/early` },
					},
				],
			},
			author: { user: { login: "committer", url: `${GH}/committer` } },
		},
		commit__ccccccc3333333: {
			commitUrl: `${GH}/acme/widget/commit/ccccccc3333333`,
			associatedPullRequests: {
				nodes: [{ number: 3, url: `${GH}/acme/widget/pull/3`, mergedAt: "2026-01-01T00:00:00Z", author: null }],
			},
			author: { user: { login: "fallback", url: `${GH}/fallback` } },
		},
		commit__ddddddd4444444: {
			commitUrl: `${GH}/acme/widget/commit/ddddddd4444444`,
			associatedPullRequests: { nodes: [] },
			author: { user: null },
		},
		commit__eeeeeee5555555: null,
		pull__42: {
			url: `${GH}/acme/widget/pull/42`,
			author: { login: "bob", url: `${GH}/bob` },
			mergeCommit: { commitUrl: `${GH}/acme/widget/commit/abc1234def`, abbreviatedOid: "abc1234" },
		},
		pull__43: { url: `${GH}/acme/widget/pull/43`, author: null, mergeCommit: null },
	},
};

const commitInfo = (fields: {
	user?: string;
	pull?: number;
	links: { commit: string; pull?: string; user?: string };
}): CommitChangelogInfo =>
	CommitChangelogInfo.make({
		user: Option.fromNullishOr(fields.user),
		pull: Option.fromNullishOr(fields.pull),
		links: {
			commit: fields.links.commit,
			pull: Option.fromNullishOr(fields.links.pull),
			user: Option.fromNullishOr(fields.links.user),
		},
	});

const ok = (data: unknown): Reply => ({ status: 200, body: { data } });

/** The live service over the scripted transport, for `REPO`. */
const drive = <A, E>(
	replies: ReadonlyArray<Reply>,
	body: (info: ChangelogInfo["Service"]) => Effect.Effect<A, E, Repo>,
) =>
	Effect.gen(function* () {
		const { script, base } = harness(replies);
		const exit = yield* Effect.exit(
			Effect.flatMap(ChangelogInfo, body).pipe(Effect.provide(Layer.provideMerge(ChangelogInfo.layer, base))),
		);
		return { exit, script, sent: script.calls.map((call) => JSON.parse(call.body ?? "null")) };
	});

const value = <A, E>(exit: Exit.Exit<A, E>): A => {
	if (Exit.isFailure(exit)) assert.fail(`expected success, got ${String(exit.cause)}`);
	return exit.value;
};

const failureOf = <A, E>(exit: Exit.Exit<A, E>): E => {
	if (Exit.isSuccess(exit)) return assert.fail("expected a failure");
	const reason = exit.cause.reasons.find(Cause.isFailReason);
	if (reason === undefined) return assert.fail(`expected a typed failure, got ${String(exit.cause)}`);
	return reason.error;
};

describe("ChangelogInfo: the query", () => {
	it.effect("one commit sends upstream's query, with no variables", () =>
		Effect.gen(function* () {
			const { exit, script, sent } = yield* drive([ok({ repo__0: { commit__fffffff6: null } })], (info) =>
				info.commit("fffffff6"),
			);
			assert.isTrue(Option.isNone(value(exit)));
			assert.strictEqual(script.count(), 1);
			assert.strictEqual(script.calls[0]?.method, "POST");
			assert.strictEqual(script.calls[0]?.url, "https://api.github.com/graphql");
			assert.deepStrictEqual(sent[0], { query: SINGLE_COMMIT_QUERY });
		}),
	);

	it.effect("one pull request sends upstream's query", () =>
		Effect.gen(function* () {
			const { sent } = yield* drive([ok({ repo__0: { pull__8: null } })], (info) => info.pullRequest(8));
			assert.deepStrictEqual(sent[0], { query: SINGLE_PULL_QUERY });
		}),
	);

	it.effect("concurrent lookups go out as upstream's one aliased query", () =>
		Effect.gen(function* () {
			const { exit, script, sent } = yield* drive([ok(BATCH_DATA)], (info) =>
				Effect.all([...SHAS.map((sha) => info.commit(sha)), info.pullRequest(42), info.pullRequest(43)], {
					concurrency: "unbounded",
				}),
			);
			value(exit);
			assert.strictEqual(script.count(), 1);
			assert.deepStrictEqual(sent[0], { query: BATCH_QUERY });
		}),
	);

	it.effect("sequential lookups are separate queries: batching is over concurrent ones", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[ok({ repo__0: { commit__aaaa: null } }), ok({ repo__0: { commit__bbbb: null } })],
				(info) => Effect.andThen(info.commit("aaaa"), info.commit("bbbb")),
			);
			assert.strictEqual(script.count(), 2);
		}),
	);

	it.effect("a sha asked for twice in one batch is one alias", () =>
		Effect.gen(function* () {
			const { exit, sent } = yield* drive([ok({ repo__0: { commit__fffffff6: null } })], (info) =>
				Effect.all([info.commit("fffffff6"), info.commit("fffffff6")], { concurrency: "unbounded" }),
			);
			assert.lengthOf(value(exit), 2);
			assert.deepStrictEqual(sent[0], { query: SINGLE_COMMIT_QUERY });
		}),
	);

	it.effect("more than 50 concurrent lookups split into batches of 50, upstream's maxBatchSize", () =>
		Effect.gen(function* () {
			const shas = Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(7, "0"));
			const { exit, script, sent } = yield* drive([ok({ repo__0: {} })], (info) =>
				Effect.forEach(shas, info.commit, { concurrency: "unbounded" }),
			);
			assert.lengthOf(value(exit), 51);
			assert.strictEqual(script.count(), 2);
			const aliases = (query: string) => [...query.matchAll(/commit__[0-9a-f]+:/g)].length;
			assert.deepStrictEqual(
				sent.map((body) => aliases(body.query)),
				[50, 1],
			);
		}),
	);
});

describe("ChangelogInfo: the answers, against upstream's", () => {
	it.effect("every commit and pull request in a batch answers as upstream does", () =>
		Effect.gen(function* () {
			const { exit } = yield* drive([ok(BATCH_DATA)], (info) =>
				Effect.all(
					[Effect.forEach(SHAS, info.commit, { concurrency: "unbounded" }), info.pullRequest(42), info.pullRequest(43)],
					{ concurrency: "unbounded" },
				),
			);
			const [commits, pull42, pull43] = value(exit);
			assert.deepStrictEqual(commits, [
				// No pull request: the commit author's GitHub user, links on the server GitHub answered with.
				Option.some(
					commitInfo({
						user: "alice",
						links: {
							commit: "[`aaaaaaa`](https://ghe.example/acme/widget/commit/aaaaaaa1111111)",
							user: "[@alice](https://ghe.example/alice)",
						},
					}),
				),
				// Several: the earliest-merged wins over a later merge and over an unmerged one listed first.
				Option.some(
					commitInfo({
						user: "early",
						pull: 5,
						links: {
							commit: "[`bbbbbbb`](https://github.com/acme/widget/commit/bbbbbbb2222222)",
							pull: "[#5](https://github.com/acme/widget/pull/5)",
							user: "[@early](https://github.com/early)",
						},
					}),
				),
				// A pull request whose author is gone credits the commit author.
				Option.some(
					commitInfo({
						user: "fallback",
						pull: 3,
						links: {
							commit: "[`ccccccc`](https://github.com/acme/widget/commit/ccccccc3333333)",
							pull: "[#3](https://github.com/acme/widget/pull/3)",
							user: "[@fallback](https://github.com/fallback)",
						},
					}),
				),
				// No pull request and an author with no GitHub user: the commit link alone.
				Option.some(
					commitInfo({ links: { commit: "[`ddddddd`](https://github.com/acme/widget/commit/ddddddd4444444)" } }),
				),
				// Upstream's `undefined`.
				Option.none(),
			]);
			assert.deepStrictEqual(
				pull42,
				Option.some(
					PullRequestChangelogInfo.make({
						user: Option.some("bob"),
						commit: Option.some("abc1234"),
						links: {
							commit: Option.some("[`abc1234`](https://github.com/acme/widget/commit/abc1234def)"),
							pull: "[#42](https://github.com/acme/widget/pull/42)",
							user: Option.some("[@bob](https://github.com/bob)"),
						},
					}),
				),
			);
			assert.deepStrictEqual(
				pull43,
				Option.some(
					PullRequestChangelogInfo.make({
						user: Option.none(),
						commit: Option.none(),
						links: {
							commit: Option.none(),
							pull: "[#43](https://github.com/acme/widget/pull/43)",
							user: Option.none(),
						},
					}),
				),
			);
		}),
	);

	it.effect("the commit link shows the first 7 characters of the sha asked for, not of the URL", () =>
		Effect.gen(function* () {
			const { exit } = yield* drive(
				[
					ok({
						repo__0: {
							commit__ABCDEF0123: {
								commitUrl: `${GH}/acme/widget/commit/abcdef0123456789`,
								associatedPullRequests: null,
								author: null,
							},
						},
					}),
				],
				(info) => info.commit("ABCDEF0123"),
			);
			assert.deepStrictEqual(
				value(exit),
				Option.some(
					commitInfo({ links: { commit: "[`ABCDEF0`](https://github.com/acme/widget/commit/abcdef0123456789)" } }),
				),
			);
		}),
	);

	it.effect("a sha naming a tree or blob is none: `... on Commit` selects nothing", () =>
		Effect.gen(function* () {
			// Upstream builds "[`deadbee`](undefined)" from the empty object.
			const { exit } = yield* drive([ok({ repo__0: { commit__deadbeef: {} } })], (info) => info.commit("deadbeef"));
			assert.isTrue(Option.isNone(value(exit)));
		}),
	);

	it.effect("a malformed commit answer fails as a decode error, not a silent none", () =>
		Effect.gen(function* () {
			const { exit } = yield* drive([ok({ repo__0: { commit__deadbeef: { commitUrl: 42 } } })], (info) =>
				info.commit("deadbeef"),
			);
			assert.isTrue(Exit.isFailure(exit));
			const error = failureOf(exit);
			assert.strictEqual(error._tag, "GitHubGraphQLError");
			assert.strictEqual(error._tag === "GitHubGraphQLError" ? error.kind : undefined, "decode");
		}),
	);
});

describe("ChangelogInfo: misses and failures", () => {
	const notFound = (path: ReadonlyArray<string>, message: string) => ({ type: "NOT_FOUND", path, message });

	it.effect("a pull request the repository lacks is none, and the batch is re-sent without it", () =>
		Effect.gen(function* () {
			// GitHub's real answer to a missing pull request, recorded live: null data AND a NOT_FOUND
			// error at the alias. Upstream throws for the whole batch.
			const { exit, script, sent } = yield* drive(
				[
					{
						status: 200,
						body: {
							data: { repo__0: { pull__999999: null, commit__fffffff6: null } },
							errors: [
								notFound(["repo__0", "pull__999999"], "Could not resolve to a PullRequest with the number of 999999."),
							],
						},
					},
					ok({ repo__0: { commit__fffffff6: null } }),
				],
				(info) => Effect.all([info.pullRequest(999999), info.commit("fffffff6")], { concurrency: "unbounded" }),
			);
			const [pull, commit] = value(exit);
			assert.isTrue(Option.isNone(pull));
			assert.isTrue(Option.isNone(commit));
			assert.strictEqual(script.count(), 2);
			assert.deepStrictEqual(sent[1], { query: SINGLE_COMMIT_QUERY });
		}),
	);

	it.effect("a batch of only missing pull requests is not re-sent", () =>
		Effect.gen(function* () {
			const { exit, script } = yield* drive(
				[
					{
						status: 200,
						body: {
							data: { repo__0: { pull__8: null } },
							errors: [notFound(["repo__0", "pull__8"], "Could not resolve to a PullRequest with the number of 8.")],
						},
					},
				],
				(info) => info.pullRequest(8),
			);
			assert.isTrue(Option.isNone(value(exit)));
			assert.strictEqual(script.count(), 1);
		}),
	);

	it.effect("a missing repository fails every lookup in the batch with notFound", () =>
		Effect.gen(function* () {
			const { exit, script } = yield* drive(
				[
					{
						status: 200,
						body: {
							data: { repo__0: null },
							errors: [notFound(["repo__0"], "Could not resolve to a Repository with the name 'acme/widget'.")],
						},
					},
				],
				(info) => Effect.all([info.pullRequest(8), info.commit("fffffff6")], { concurrency: "unbounded" }),
			);
			const error = failureOf(exit);
			assert.strictEqual(error._tag, "GitHubGraphQLError");
			if (error._tag === "GitHubGraphQLError") {
				assert.strictEqual(error.kind, "notFound");
				assert.strictEqual(error.operation, "changelogInfo");
				assert.deepStrictEqual(error.errors[0]?.path, ["repo__0"]);
			}
			assert.strictEqual(script.count(), 1);
		}),
	);

	it.effect("an unauthorized token fails the lookup with the client's classification", () =>
		Effect.gen(function* () {
			const { exit } = yield* drive([{ status: 401, body: { message: "Bad credentials" } }], (info) =>
				info.commit("fffffff6"),
			);
			const error = failureOf(exit);
			assert.strictEqual(error._tag === "GitHubGraphQLError" ? error.kind : error._tag, "unauthorized");
		}),
	);

	it.effect("a sha a GraphQL alias cannot carry fails InvalidChangelogRefError and sends nothing", () =>
		Effect.gen(function* () {
			for (const sha of ["HEAD~1", "v1.0.0", "abc", "", "g123456", "a".repeat(65)]) {
				const { exit, script } = yield* drive([ok({})], (info) => info.commit(sha));
				const error = failureOf(exit);
				assert.strictEqual(error._tag, "InvalidChangelogRefError", sha);
				if (error._tag === "InvalidChangelogRefError") {
					assert.strictEqual(error.ref, "commit");
					assert.strictEqual(error.input, sha);
				}
				assert.strictEqual(script.count(), 0, sha);
			}
		}),
	);

	it.effect("a pull request number that is not a positive integer fails InvalidChangelogRefError", () =>
		Effect.gen(function* () {
			for (const number of [0, -1, 1.5, Number.NaN]) {
				const { exit, script } = yield* drive([ok({})], (info) => info.pullRequest(number));
				const error = failureOf(exit);
				assert.strictEqual(error._tag, "InvalidChangelogRefError", String(number));
				assert.strictEqual(error.message, `not a positive pull request number: ${number}`);
				assert.strictEqual(script.count(), 0);
			}
		}),
	);
});

describe("ChangelogInfo on GitHub Enterprise Server", () => {
	it.effect("the query goes to the server's /api/graphql and the links name the server", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([
				ok({
					repo__0: {
						commit__fffffff6: {
							commitUrl: `${GHE}/acme/widget/commit/fffffff6aaaa`,
							associatedPullRequests: {
								nodes: [
									{
										number: 12,
										url: `${GHE}/acme/widget/pull/12`,
										mergedAt: "2026-01-01T00:00:00Z",
										author: { login: "carol", url: `${GHE}/carol` },
									},
								],
							},
							author: { user: { login: "dave", url: `${GHE}/dave` } },
						},
					},
				}),
			]);
			const found = yield* Effect.flatMap(ChangelogInfo, (info) => info.commit("fffffff6")).pipe(
				Effect.provide(
					ChangelogInfo.layer.pipe(
						Layer.provideMerge(
							Layer.mergeAll(
								GitHubClient.layerFromToken({
									token: Redacted.make("ghs_test"),
									fetch: script.fetch,
									retry: RetryPolicy.none,
									baseUrl: "https://ghe.example/api/v3",
								}),
								Repo.layer(REPO),
							),
						),
					),
				),
			);
			assert.strictEqual(script.calls[0]?.url, "https://ghe.example/api/graphql");
			assert.strictEqual(script.calls[0]?.headers.authorization, "token ghs_test");
			assert.deepStrictEqual(
				found,
				Option.some(
					commitInfo({
						user: "carol",
						pull: 12,
						links: {
							commit: "[`fffffff`](https://ghe.example/acme/widget/commit/fffffff6aaaa)",
							pull: "[#12](https://ghe.example/acme/widget/pull/12)",
							user: "[@carol](https://ghe.example/carol)",
						},
					}),
				),
			);
		}),
	);
});

describe("ChangelogInfo.makeTest", () => {
	it.effect("an unstubbed member dies when run, naming itself", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.flatMap(ChangelogInfo, (info) => info.pullRequest(1)).pipe(
					Effect.provide(Layer.merge(ChangelogInfo.layerTest(), Repo.layer(REPO))),
				),
			);
			assert.include(defectMessage(exit) ?? "", "ChangelogInfo.makeTest: pullRequest() was called but not stubbed");
		}),
	);

	it.effect("a stubbed member answers", () =>
		Effect.gen(function* () {
			const found = yield* Effect.flatMap(ChangelogInfo, (info) => info.commit("fffffff6")).pipe(
				Effect.provide(
					Layer.merge(ChangelogInfo.layerTest({ commit: () => Effect.succeed(Option.none()) }), Repo.layer(REPO)),
				),
			);
			assert.isTrue(Option.isNone(found));
		}),
	);
});
