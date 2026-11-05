import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CreatedCommit, FileContent, GitCommit } from "../src/GitCommit.js";
import { Repo } from "../src/Repo.js";
import type { Reply } from "./fixtures.js";
import { REPO, defectMessage, harness } from "./harness.js";

const SHA = "c0ffee";
const URL_DOTCOM = `https://github.com/acme/widget/commit/${SHA}`;
const URL_GHES = `https://ghe.example.com/acme/widget/commit/${SHA}`;

const commitReply = (htmlUrl: string): Reply => ({
	status: 201,
	body: { sha: SHA, html_url: htmlUrl, tree: { sha: "t" }, parents: [] },
});

const run = <A, E>(replies: ReadonlyArray<Reply>, use: (commits: GitCommit["Service"]) => Effect.Effect<A, E, Repo>) =>
	Effect.gen(function* () {
		const { script, base } = harness(replies);
		const value = yield* Effect.provide(Effect.flatMap(GitCommit, use), GitCommit.layer.pipe(Layer.provideMerge(base)));
		return { value, script };
	});

const input = { message: "m", tree: "t", parents: ["p"] } as const;

/** The replies `commitFiles` consumes: read ref, read head, create tree, create commit, move ref. */
const commitFilesReplies = (htmlUrl: string): ReadonlyArray<Reply> => [
	{ status: 200, body: { ref: "refs/heads/b", object: { sha: "head", type: "commit" } } },
	{ status: 200, body: { sha: "head", tree: { sha: "headtree" }, parents: [] } },
	{ status: 201, body: { sha: "newtree" } },
	commitReply(htmlUrl),
	{ status: 200, body: {} },
];

const changes = [FileContent.make({ path: "a.md", content: "a" })];

describe("GitCommit commit URLs", () => {
	it.effect("createCommitWithUrl returns the sha and the html_url the reply carried", () =>
		Effect.gen(function* () {
			const { value } = yield* run([commitReply(URL_DOTCOM)], (c) => c.createCommitWithUrl(input));
			assert.instanceOf(value, CreatedCommit);
			assert.strictEqual(value.sha, SHA);
			assert.strictEqual(value.htmlUrl, URL_DOTCOM);
		}),
	);

	it.effect("createCommit still returns the bare sha", () =>
		Effect.gen(function* () {
			const { value } = yield* run([commitReply(URL_DOTCOM)], (c) => c.createCommit(input));
			assert.strictEqual(value, SHA);
		}),
	);

	it.effect("a host other than github.com passes through unchanged", () =>
		Effect.gen(function* () {
			const { value } = yield* run([commitReply(URL_GHES)], (c) => c.createCommitWithUrl(input));
			assert.strictEqual(value.htmlUrl, URL_GHES);
		}),
	);

	it.effect("commitFilesWithUrl returns the created commit's sha and url", () =>
		Effect.gen(function* () {
			const { value, script } = yield* run(commitFilesReplies(URL_GHES), (c) =>
				c.commitFilesWithUrl({ branch: "b", message: "m", changes }),
			);
			assert.strictEqual(value.sha, SHA);
			assert.strictEqual(value.htmlUrl, URL_GHES);
			assert.strictEqual(script.count(), 5);
		}),
	);

	it.effect("commitFiles still returns the bare sha, over the same five calls", () =>
		Effect.gen(function* () {
			const { value, script } = yield* run(commitFilesReplies(URL_DOTCOM), (c) =>
				c.commitFiles({ branch: "b", message: "m", changes }),
			);
			assert.strictEqual(value, SHA);
			assert.strictEqual(script.count(), 5);
			// The ref move targets the created commit, not the head it was built on.
			assert.strictEqual(JSON.parse(script.calls[4]?.body ?? "{}").sha, SHA);
		}),
	);

	it.effect("makeTest carries both members and each dies unstubbed, naming itself", () =>
		Effect.gen(function* () {
			const double = GitCommit.makeTest();
			const withUrl = yield* Effect.exit(double.createCommitWithUrl(input));
			assert.include(defectMessage(withUrl) ?? "", "createCommitWithUrl");
			const filesWithUrl = yield* Effect.exit(double.commitFilesWithUrl({ branch: "b", message: "m", changes }));
			assert.include(defectMessage(filesWithUrl) ?? "", "commitFilesWithUrl");
		}).pipe(Effect.provide(Repo.layer(REPO))),
	);

	it.effect("makeTest answers a stubbed member", () =>
		Effect.gen(function* () {
			const stub = CreatedCommit.make({ sha: "s", htmlUrl: "u" });
			const double = GitCommit.makeTest({ createCommitWithUrl: () => Effect.succeed(stub) });
			assert.strictEqual(yield* double.createCommitWithUrl(input), stub);
		}).pipe(Effect.provide(Repo.layer(REPO))),
	);
});
