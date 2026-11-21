import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { CheckoutUnsafePullRequestError } from "../../src/Checkout.js";
import { assertSafePullRequest } from "../../src/internal/checkout/unsafePullRequest.js";

const BASE_REPO_ID = 100;
const FORK_REPO_ID = 200;
// Holds a-f, so a case-sensitive comparison of the uppercased form would miss it.
const PR_HEAD_SHA = "abcdef0123456789abcdef0123456789abcdef01";
const PR_MERGE_SHA = "2222222222222222222222222222222222222222";
const SAFE_BASE_SHA = "3333333333333333333333333333333333333333";
const WORKFLOW_RUN_HEAD_COMMIT_SHA = "4444444444444444444444444444444444444444";
const BASE_QUALIFIED_REPO = "some-owner/some-repo";
const FORK_QUALIFIED_REPO = "another-repo/fork";

const forkPullRequestTargetPayload = () => ({
	repository: { id: BASE_REPO_ID },
	pull_request: {
		head: { sha: PR_HEAD_SHA, repo: { id: FORK_REPO_ID, full_name: FORK_QUALIFIED_REPO } },
		merge_commit_sha: PR_MERGE_SHA,
	},
});

const sameRepoPullRequestTargetPayload = () => ({
	repository: { id: BASE_REPO_ID },
	pull_request: {
		head: { sha: PR_HEAD_SHA, repo: { id: BASE_REPO_ID, full_name: BASE_QUALIFIED_REPO } },
		merge_commit_sha: PR_MERGE_SHA,
	},
});

const forkWorkflowRunPayload = () => ({
	repository: { id: BASE_REPO_ID },
	workflow_run: {
		event: "pull_request",
		head_commit: { id: WORKFLOW_RUN_HEAD_COMMIT_SHA },
		head_repository: { id: FORK_REPO_ID, full_name: FORK_QUALIFIED_REPO },
	},
});

const run = (
	event: { name: string; payload: unknown },
	input: { repository: string; ref: string; commit: string; allowUnsafe: boolean },
) => Effect.runPromise(Effect.result(assertSafePullRequest(input, event)));

const allowed = async (
	event: { name: string; payload: unknown },
	input: { repository: string; ref: string; commit: string; allowUnsafe?: boolean },
) => {
	const r = await run(event, { allowUnsafe: false, ...input });
	assert.strictEqual(r._tag, "Success");
};

const refused = async (
	event: { name: string; payload: unknown },
	input: { repository: string; ref: string; commit: string },
) => {
	const r = await run(event, { allowUnsafe: false, ...input });
	assert.strictEqual(r._tag, "Failure");
	if (r._tag === "Failure") {
		assert.instanceOf(r.failure, CheckoutUnsafePullRequestError);
		assert.match(r.failure.message, /Refusing to check out fork pull request code/);
		assert.match(r.failure.message, /allow-unsafe-pr-checkout/);
	}
};

describe("assertSafePullRequest", () => {
	it("allows pull_request events untouched", async () => {
		await allowed(
			{ name: "pull_request", payload: forkPullRequestTargetPayload() },
			{ repository: "attacker/fork", ref: "refs/pull/1/merge", commit: "" },
		);
	});

	it("allows pull_request_target default checkout (base branch)", async () => {
		await allowed(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/heads/main", commit: SAFE_BASE_SHA },
		);
	});

	it("allows same-repo pull_request_target checkout of PR head", async () => {
		await allowed(
			{ name: "pull_request_target", payload: sameRepoPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: PR_HEAD_SHA },
		);
	});

	it("refuses pull_request_target fork PR head SHA checkout", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: PR_HEAD_SHA },
		);
	});

	it("refuses pull_request_target fork PR merge_commit_sha checkout", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: PR_MERGE_SHA },
		);
	});

	it("refuses pull_request_target fork PR ref pattern (head)", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/42/head", commit: "" },
		);
	});

	it("refuses pull_request_target fork PR ref pattern (merge)", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/42/merge", commit: "" },
		);
	});

	it("refuses pull_request_target when repository points at the fork", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: FORK_QUALIFIED_REPO, ref: "refs/heads/main", commit: "" },
		);
	});

	it("allows pull_request_target checkout of an unrelated third-party repo", async () => {
		await allowed(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: "some-other/unrelated", ref: "refs/heads/main", commit: "" },
		);
	});

	it("refuses pull_request_target ignoring repository case differences", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: FORK_QUALIFIED_REPO.toUpperCase(), ref: "", commit: "" },
		);
	});

	it("refuses pull_request_target ignoring commit SHA case differences", async () => {
		await refused(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: PR_HEAD_SHA.toUpperCase() },
		);
	});

	it("allows pull_request_target fork PR checkout when opted in", async () => {
		await allowed(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/42/merge", commit: "", allowUnsafe: true },
		);
	});

	it("refuses workflow_run fork PR head_commit.id checkout", async () => {
		await refused(
			{ name: "workflow_run", payload: forkWorkflowRunPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: WORKFLOW_RUN_HEAD_COMMIT_SHA },
		);
	});

	it("refuses workflow_run with pull_request_target underlying event", async () => {
		const payload = forkWorkflowRunPayload();
		payload.workflow_run.event = "pull_request_target";
		await refused(
			{ name: "workflow_run", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: WORKFLOW_RUN_HEAD_COMMIT_SHA },
		);
	});

	it("allows workflow_run same-repo PR (head_repository.id matches base)", async () => {
		const payload = forkWorkflowRunPayload();
		payload.workflow_run.head_repository.id = BASE_REPO_ID;
		await allowed(
			{ name: "workflow_run", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: WORKFLOW_RUN_HEAD_COMMIT_SHA },
		);
	});

	it("refuses pull_request_target from a deleted fork (head.repo null) asking for a pull ref", async () => {
		const payload = { ...forkPullRequestTargetPayload(), pull_request: { head: { sha: PR_HEAD_SHA, repo: null } } };
		await refused(
			{ name: "pull_request_target", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/42/merge", commit: "" },
		);
		await refused(
			{ name: "pull_request_target", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "", commit: PR_HEAD_SHA },
		);
	});

	it("allows pull_request_target from a deleted fork (head.repo null) asking for the base branch", async () => {
		const payload = { ...forkPullRequestTargetPayload(), pull_request: { head: { sha: PR_HEAD_SHA, repo: null } } };
		await allowed(
			{ name: "pull_request_target", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/heads/main", commit: SAFE_BASE_SHA },
		);
	});

	it("refuses workflow_run from a deleted fork (head_repository null) asking for a pull ref", async () => {
		const payload = {
			repository: { id: BASE_REPO_ID },
			workflow_run: { event: "pull_request", head_repository: null },
		};
		await refused(
			{ name: "workflow_run", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/7/head", commit: "" },
		);
		await allowed(
			{ name: "workflow_run", payload },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/heads/main", commit: "" },
		);
	});

	it("reads an unknown or empty payload defensively", async () => {
		const input = { repository: FORK_QUALIFIED_REPO, ref: "", commit: PR_HEAD_SHA };
		await allowed({ name: "pull_request_target", payload: null }, input);
		await allowed({ name: "pull_request_target", payload: {} }, input);
		await allowed({ name: "pull_request_target", payload: "x" }, input);
		await allowed({ name: "workflow_run", payload: { repository: { id: 1 }, workflow_run: { event: 5 } } }, input);
	});

	it("names the event, repository and ref on the error", async () => {
		const r = await run(
			{ name: "pull_request_target", payload: forkPullRequestTargetPayload() },
			{ repository: BASE_QUALIFIED_REPO, ref: "refs/pull/42/head", commit: "", allowUnsafe: false },
		);
		if (r._tag === "Failure") {
			assert.strictEqual(r.failure.event, "pull_request_target");
			assert.strictEqual(r.failure.repository, BASE_QUALIFIED_REPO);
			assert.strictEqual(r.failure.ref, "refs/pull/42/head");
		} else {
			assert.fail("expected a refusal");
		}
	});
});
