import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Path, Redacted } from "effect";
import { GitHubContext } from "../../src/ActionEnvironment.js";
import type { CheckoutOptions } from "../../src/Checkout.js";
import { CheckoutPathError, CheckoutUnsafePullRequestError } from "../../src/Checkout.js";
import { lower } from "../../src/internal/checkout/settings.js";

const SHA = "1234567890123456789012345678901234567890";
const HEAD = "1111111111111111111111111111111111111111";

const github = (over: Partial<ConstructorParameters<typeof GitHubContext>[0]> = {}) =>
	GitHubContext.make({
		repository: "own/repo",
		repositoryOwner: "own",
		ref: "refs/heads/main",
		refName: "main",
		headRef: Option.none(),
		sha: SHA,
		workflow: "w",
		job: "j",
		runId: 1,
		runAttempt: 1,
		eventName: "push",
		actor: "a",
		serverUrl: "https://github.com",
		apiUrl: "https://api.github.com",
		graphqlUrl: "https://api.github.com/graphql",
		workspace: "/work",
		...over,
	});

const auth = { _tag: "Token", token: Redacted.make("t") } as const;

const lowered = (options: Partial<CheckoutOptions>, ctx = github(), payload: unknown = {}) =>
	lower({ auth, ...options } as CheckoutOptions, { github: ctx, workspace: "/work", payload }).pipe(
		Effect.provide(Path.layer),
	);

const refPair = async (ref: CheckoutOptions["ref"], repository?: CheckoutOptions["repository"]) => {
	const s = await Effect.runPromise(lowered({ ...(ref ? { ref } : {}), ...(repository ? { repository } : {}) }));
	return [s.ref, s.commit];
};

describe("lower ref mapping", () => {
	it("Event is GITHUB_REF and GITHUB_SHA", async () => {
		assert.deepStrictEqual(await refPair({ _tag: "Event" }), ["refs/heads/main", SHA]);
	});

	it("Event prefixes an unqualified ref when a commit is present", async () => {
		const s = await Effect.runPromise(lowered({ ref: { _tag: "Event" } }, github({ ref: "main" })));
		assert.deepStrictEqual([s.ref, s.commit], ["refs/heads/main", SHA]);
		const bare = await Effect.runPromise(lowered({ ref: { _tag: "Event" } }, github({ ref: "main", sha: "" })));
		assert.deepStrictEqual([bare.ref, bare.commit], ["main", ""]);
	});

	it("defaults to Event for the own repository, case-insensitively, and Default otherwise", async () => {
		const own = await Effect.runPromise(lowered({ repository: { owner: "OWN", name: "Repo" } }));
		assert.deepStrictEqual([own.ref, own.commit, own.isWorkflowRepository], ["refs/heads/main", SHA, true]);
		const other = await Effect.runPromise(lowered({ repository: { owner: "x", name: "y" } }));
		assert.deepStrictEqual([other.ref, other.commit, other.isWorkflowRepository], ["", "", false]);
	});

	it("Branch, Tag, PullRequest, Commit, Ref and Default", async () => {
		assert.deepStrictEqual(await refPair({ _tag: "Branch", name: "dev" }), ["refs/heads/dev", ""]);
		assert.deepStrictEqual(await refPair({ _tag: "Branch", name: "dev", commit: SHA }), ["refs/heads/dev", SHA]);
		assert.deepStrictEqual(await refPair({ _tag: "Tag", name: "v1" }), ["refs/tags/v1", ""]);
		assert.deepStrictEqual(await refPair({ _tag: "Tag", name: "v1", commit: SHA }), ["refs/tags/v1", SHA]);
		assert.deepStrictEqual(await refPair({ _tag: "PullRequest", number: 7, kind: "merge" }), ["refs/pull/7/merge", ""]);
		assert.deepStrictEqual(await refPair({ _tag: "PullRequest", number: 7, kind: "head", commit: SHA }), [
			"refs/pull/7/head",
			SHA,
		]);
		assert.deepStrictEqual(await refPair({ _tag: "Commit", sha: SHA }), ["", SHA]);
		assert.deepStrictEqual(await refPair({ _tag: "Ref", ref: "refs/heads/x" }), ["refs/heads/x", ""]);
		assert.deepStrictEqual(await refPair({ _tag: "Ref", ref: "x", commit: SHA }), ["x", SHA]);
		assert.deepStrictEqual(await refPair({ _tag: "Default" }), ["", ""]);
	});

	it("Ref naming a bare sha is a commit, not a ref", async () => {
		assert.deepStrictEqual(await refPair({ _tag: "Ref", ref: ` ${SHA}\n` }), ["", SHA]);
		const bom = `﻿${SHA}`;
		assert.deepStrictEqual(await refPair({ _tag: "Ref", ref: bom }), [bom, ""]);
	});
});

describe("lower path", () => {
	it("resolves against the workspace, defaulting to it", async () => {
		assert.strictEqual((await Effect.runPromise(lowered({}))).path, "/work");
		assert.strictEqual((await Effect.runPromise(lowered({ path: "a/b" }))).path, "/work/a/b");
	});

	it("refuses a path outside the workspace", async () => {
		for (const path of ["../x", "/elsewhere", "../work-other"]) {
			const error = await Effect.runPromise(Effect.flip(lowered({ path })));
			assert.instanceOf(error, CheckoutPathError);
			assert.strictEqual((error as CheckoutPathError).path, path);
			assert.strictEqual((error as CheckoutPathError).workspace, "/work");
		}
	});
});

describe("lower defaults", () => {
	it("resolves every default", async () => {
		const s = await Effect.runPromise(lowered({}));
		assert.strictEqual(s.credentials, "job");
		assert.isTrue(s.clean);
		assert.strictEqual(s.depth, 1);
		assert.isFalse(s.fetchTags);
		assert.isFalse(s.lfs);
		assert.isFalse(s.submodules);
		assert.isFalse(s.nestedSubmodules);
		assert.isTrue(s.safeDirectory);
		assert.strictEqual(s.serverUrl, "https://github.com");
		assert.strictEqual(s.stateKey, "effected-checkout");
		assert.isTrue(Option.isNone(s.filter));
		assert.isTrue(Option.isNone(s.sparse));
		assert.isTrue(Option.isNone(s.remoteUrl));
		assert.deepStrictEqual([s.owner, s.name], ["own", "repo"]);
	});

	it("maps explicit options", async () => {
		const s = await Effect.runPromise(
			lowered({
				depth: "full",
				submodules: "recursive",
				sparse: { patterns: ["a"] },
				filter: "blob:none",
				serverUrl: "https://ghe.example.com",
				remoteUrl: "https://r/x",
				credentials: "none",
				clean: false,
				stateKey: "k",
			}),
		);
		assert.strictEqual(s.depth, 0);
		assert.isTrue(s.submodules);
		assert.isTrue(s.nestedSubmodules);
		assert.deepStrictEqual(s.sparse, Option.some({ patterns: ["a"], cone: true }));
		assert.deepStrictEqual(s.filter, Option.some("blob:none"));
		assert.strictEqual(s.serverUrl, "https://ghe.example.com");
		assert.deepStrictEqual(s.remoteUrl, Option.some("https://r/x"));
		assert.strictEqual(s.credentials, "none");
		assert.isFalse(s.clean);
		assert.strictEqual(s.stateKey, "k");
		const d = await Effect.runPromise(lowered({ depth: 5.9 }));
		assert.strictEqual(d.depth, 5);
		const neg = await Effect.runPromise(lowered({ depth: -3 }));
		assert.strictEqual(neg.depth, 0);
	});
});

describe("lower unsafe pull request guard", () => {
	const payload = {
		repository: { id: 100 },
		pull_request: {
			head: { sha: HEAD, repo: { id: 200, full_name: "fork/repo" } },
			merge_commit_sha: "2222222222222222222222222222222222222222",
		},
	};
	const ctx = github({ eventName: "pull_request_target", ref: "refs/heads/main" });

	it("skips the guard for the default self-checkout, even when it would refuse", async () => {
		// The event's own ref and sha are exactly what the guard refuses for a fork PR.
		const risky = github({ eventName: "pull_request_target", ref: "refs/pull/3/merge", sha: HEAD });
		const s = await Effect.runPromise(lowered({}, risky, payload));
		assert.deepStrictEqual([s.ref, s.commit], ["refs/pull/3/merge", HEAD]);
		const explicitEvent = await Effect.runPromise(lowered({ ref: { _tag: "Event" } }, risky, payload));
		assert.deepStrictEqual([explicitEvent.ref, explicitEvent.commit], ["refs/pull/3/merge", HEAD]);
		// Control: the same context is refused once the ref is explicit or the repository is the fork.
		const viaRef = await Effect.runPromise(
			Effect.flip(lowered({ ref: { _tag: "Ref", ref: "refs/pull/3/merge" } }, risky, payload)),
		);
		assert.instanceOf(viaRef, CheckoutUnsafePullRequestError);
		const viaCommit = await Effect.runPromise(
			Effect.flip(lowered({ ref: { _tag: "Commit", sha: HEAD } }, risky, payload)),
		);
		assert.instanceOf(viaCommit, CheckoutUnsafePullRequestError);
		const viaRepo = await Effect.runPromise(
			Effect.flip(lowered({ repository: { owner: "fork", name: "repo" } }, risky, payload)),
		);
		assert.instanceOf(viaRepo, CheckoutUnsafePullRequestError);
	});

	it("applies the guard to an explicit pull request ref", async () => {
		const error = await Effect.runPromise(
			Effect.flip(lowered({ ref: { _tag: "PullRequest", number: 3, kind: "merge" } }, ctx, payload)),
		);
		assert.instanceOf(error, CheckoutUnsafePullRequestError);
	});

	it("honours the opt-in", async () => {
		const s = await Effect.runPromise(
			lowered({ ref: { _tag: "PullRequest", number: 3, kind: "merge" }, allowUnsafePrCheckout: true }, ctx, payload),
		);
		assert.strictEqual(s.ref, "refs/pull/3/merge");
	});

	it("applies the guard to a fork repository checkout", async () => {
		const error = await Effect.runPromise(
			Effect.flip(lowered({ repository: { owner: "fork", name: "repo" } }, ctx, payload)),
		);
		assert.instanceOf(error, CheckoutUnsafePullRequestError);
	});
});
