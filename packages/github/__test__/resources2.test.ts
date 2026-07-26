import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber, Latch, Layer, Option } from "effect";
import { FastCheck, TestClock } from "effect/testing";
import { Attestation } from "../src/Attestation.js";
import { Annotation, CheckRun, CheckRunOutput } from "../src/CheckRun.js";
import type { GitHubClient } from "../src/GitHubClient.js";
import { GitHubIssue } from "../src/GitHubIssue.js";
import { GitHubRelease, ReleaseInfo } from "../src/GitHubRelease.js";
import { PullRequest, PullRequestInfo } from "../src/PullRequest.js";
import { CommentMarker, PullRequestComment } from "../src/PullRequestComment.js";
import type { Repo } from "../src/Repo.js";
import { PageOptions } from "../src/Rest.js";
import { WorkflowDispatch } from "../src/WorkflowDispatch.js";
import type { Reply } from "./fixtures.js";
import { linkNext } from "./fixtures.js";
import { harness } from "./harness.js";

const drive = <I, S, A, E>(
	replies: ReadonlyArray<Reply>,
	service: { readonly layer: Layer.Layer<I, never, GitHubClient> },
	tag: Effect.Effect<S, never, I>,
	use: (resource: S) => Effect.Effect<A, E, Repo>,
) =>
	Effect.gen(function* () {
		const { script, base } = harness(replies);
		const value = yield* Effect.provide(Effect.flatMap(tag, use), service.layer.pipe(Layer.provideMerge(base)));
		return { value, script };
	});

describe("CheckRunOutput byte budgeting", () => {
	it("leaves an output that fits alone", () => {
		const output = CheckRunOutput.make({ title: "t", summary: "short" });
		assert.strictEqual(output.truncated().summary, "short");
	});

	it("cuts a summary that exceeds the byte budget", () => {
		const output = CheckRunOutput.make({ title: "t", summary: "a".repeat(70_000) });
		const cut = output.truncated().summary;
		assert.isAtMost(Buffer.byteLength(cut, "utf8"), CheckRunOutput.LIMIT_BYTES);
		assert.isTrue(cut.endsWith(CheckRunOutput.NOTICE));
	});

	it("counts BYTES, not characters", () => {
		// 30k emoji is 30k characters and 120k bytes. A character-count check
		// passes this and the request comes back 422.
		const summary = "🦋".repeat(30_000);
		assert.isBelow(summary.length, CheckRunOutput.LIMIT_BYTES, "under the limit by characters");
		assert.isAbove(Buffer.byteLength(summary, "utf8"), CheckRunOutput.LIMIT_BYTES, "over it by bytes");
		const cut = CheckRunOutput.make({ title: "t", summary }).truncated().summary;
		assert.isAtMost(Buffer.byteLength(cut, "utf8"), CheckRunOutput.LIMIT_BYTES);
	});

	it("leaves no broken code point behind", () => {
		const cut = CheckRunOutput.make({ title: "t", summary: "🦋".repeat(30_000) }).truncated().summary;
		assert.notInclude(cut.slice(0, -CheckRunOutput.NOTICE.length), "�");
	});

	it("caps text as well as summary", () => {
		const output = CheckRunOutput.make({ title: "t", summary: "s", text: "b".repeat(70_000) });
		assert.isAtMost(Buffer.byteLength(output.truncated().text ?? "", "utf8"), CheckRunOutput.LIMIT_BYTES);
	});

	it("drops annotations past GitHub's per-request cap", () => {
		const annotations = Array.from({ length: 80 }, (_, index) =>
			Annotation.make({ path: `f${index}`, startLine: 1, endLine: 1, level: "warning", message: "m" }),
		);
		const output = CheckRunOutput.make({ title: "t", summary: "s", annotations });
		assert.lengthOf(output.truncated().annotations ?? [], CheckRunOutput.MAX_ANNOTATIONS);
	});

	it.prop(
		"stays valid UTF-8 within budget for any input",
		[FastCheck.string({ unit: "binary", maxLength: 40_000 })],
		([summary]) => {
			const cut = CheckRunOutput.make({ title: "t", summary }).truncated().summary;
			const withinBudget = Buffer.byteLength(cut, "utf8") <= CheckRunOutput.LIMIT_BYTES;
			// Round-tripping through UTF-8 is lossless exactly when nothing is broken
			// beyond what the input already contained.
			const noNewDamage = (cut.match(/�/g) ?? []).length <= (summary.match(/�/g) ?? []).length + 1;
			return withinBudget && noNewDamage;
		},
	);
});

describe("CheckRun", () => {
	it.effect("sends a truncated output on the wire, not the raw one", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[{ status: 200, body: { id: 1, name: "n", status: "completed", html_url: "u" } }],
				CheckRun,
				CheckRun,
				(check) => check.update(1, CheckRunOutput.make({ title: "t", summary: "x".repeat(70_000) })),
			);
			const body = JSON.parse(script.calls[0]?.body ?? "{}");
			assert.isAtMost(Buffer.byteLength(body.output.summary, "utf8"), CheckRunOutput.LIMIT_BYTES);
		}),
	);

	it.effect("withCheckRun completes the run on success", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
					{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
				],
				CheckRun,
				CheckRun,
				(check) => check.withCheckRun("build", "sha", (id) => Effect.succeed(id * 2)),
			);
			assert.strictEqual(value, 14);
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "success");
		}),
	);

	it.effect("withCheckRun completes it as a failure and re-fails", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const error = yield* Effect.flip(
				Effect.provide(
					Effect.flatMap(CheckRun, (check) => check.withCheckRun("build", "sha", () => Effect.fail("boom" as const))),
					CheckRun.layer.pipe(Layer.provideMerge(base)),
				),
			);
			assert.strictEqual(error, "boom");
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "failure");
		}),
	);

	it.effect("withCheckRun concludes as cancelled when `use` is interrupted", () =>
		Effect.gen(function* () {
			// A check run left `in_progress` is never reaped by GitHub: it blocks
			// branch protection until someone deletes it by hand. So the finalizer
			// has to be exit-aware, not a `tap`/`tapError` pair — those fire on
			// success and typed failure only, and an interrupted job (a cancelled
			// workflow, a timeout, a failing sibling in a race) hits neither.
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const started = yield* Latch.make();
			const fiber = yield* Effect.forkChild(
				Effect.provide(
					Effect.flatMap(CheckRun, (check) =>
						// Open the latch from INSIDE `use`, so the interrupt below cannot
						// land before the run has been created — otherwise the test could
						// pass by never having started one.
						check.withCheckRun("build", "sha", () => Effect.flatMap(started.open, () => Effect.never)),
					),
					CheckRun.layer.pipe(Layer.provideMerge(base)),
				),
			);
			yield* started.await;
			yield* Fiber.interrupt(fiber);

			assert.lengthOf(script.calls, 2, "the run was concluded rather than left in_progress");
			const body = JSON.parse(script.calls[1]?.body ?? "{}");
			assert.strictEqual(body.conclusion, "cancelled");
			assert.strictEqual(body.status, "completed");
		}),
	);

	it.effect("an explicit conclusion replaces the success default", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const value = yield* Effect.provide(
				Effect.flatMap(CheckRun, (check) =>
					check.withCheckRun("build", "sha", (id, conclude) =>
						Effect.gen(function* () {
							// The shape a findings-derived conclusion takes: the work computes
							// the verdict, then hands it to the bracket.
							yield* conclude("neutral");
							return id * 2;
						}),
					),
				),
				CheckRun.layer.pipe(Layer.provideMerge(base)),
			);
			assert.strictEqual(value, 14, "`use`'s own value is untouched by concluding");
			assert.lengthOf(script.calls, 2, "concluded exactly once — recorded, then written by the finalizer");
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "neutral");
		}),
	);

	it.effect("an explicit conclusion carries its own output", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			yield* Effect.provide(
				Effect.flatMap(CheckRun, (check) =>
					check.withCheckRun("build", "sha", (_id, conclude) =>
						conclude(
							"action_required",
							CheckRunOutput.make({ title: "Needs a maintainer", summary: "Two advisory warnings." }),
						),
					),
				),
				CheckRun.layer.pipe(Layer.provideMerge(base)),
			);
			const body = JSON.parse(script.calls[1]?.body ?? "{}");
			assert.strictEqual(body.conclusion, "action_required");
			assert.strictEqual(body.output.title, "Needs a maintainer");
			assert.strictEqual(body.output.summary, "Two advisory warnings.");
		}),
	);

	it.effect("an explicit conclusion wins over the FAILURE default", () =>
		Effect.gen(function* () {
			// Precedence on the failure path: the work decided the run was skipped,
			// then failed for an unrelated reason. "skipped" is the verdict about the
			// check; the failure is the verdict about the program.
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const error = yield* Effect.flip(
				Effect.provide(
					Effect.flatMap(CheckRun, (check) =>
						check.withCheckRun("build", "sha", (_id, conclude) =>
							Effect.flatMap(conclude("skipped"), () => Effect.fail("boom" as const)),
						),
					),
					CheckRun.layer.pipe(Layer.provideMerge(base)),
				),
			);
			assert.strictEqual(error, "boom", "the failure still propagates");
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "skipped");
		}),
	);

	it.effect("an explicit conclusion wins over the CANCELLED default", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const started = yield* Latch.make();
			const fiber = yield* Effect.forkChild(
				Effect.provide(
					Effect.flatMap(CheckRun, (check) =>
						check.withCheckRun("build", "sha", (_id, conclude) =>
							Effect.gen(function* () {
								// A watchdog that has already decided the run timed out, then
								// waits to be torn down. The interrupt must not overwrite it.
								yield* conclude("timed_out");
								yield* started.open;
								yield* Effect.never;
							}),
						),
					),
					CheckRun.layer.pipe(Layer.provideMerge(base)),
				),
			);
			yield* started.await;
			yield* Fiber.interrupt(fiber);
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "timed_out");
		}),
	);

	it.effect("the last conclusion recorded is the one written", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			yield* Effect.provide(
				Effect.flatMap(CheckRun, (check) =>
					check.withCheckRun("build", "sha", (_id, conclude) =>
						Effect.flatMap(conclude("neutral"), () => conclude("failure")),
					),
				),
				CheckRun.layer.pipe(Layer.provideMerge(base)),
			);
			assert.lengthOf(script.calls, 2, "two conclude calls still produce ONE completion");
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "failure");
		}),
	);

	it.effect("a defect in `use` still concludes the run", () =>
		Effect.gen(function* () {
			// `tapError` fires on the typed error channel only, so a defect used to
			// leave the run open exactly as an interrupt did.
			const { script, base } = harness([
				{ status: 201, body: { id: 7, name: "n", status: "in_progress", html_url: "u" } },
				{ status: 200, body: { id: 7, name: "n", status: "completed", html_url: "u" } },
			]);
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.flatMap(CheckRun, (check) =>
						check.withCheckRun("build", "sha", () => Effect.die(new Error("kaboom"))),
					),
					CheckRun.layer.pipe(Layer.provideMerge(base)),
				),
			);
			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(JSON.parse(script.calls[1]?.body ?? "{}").conclusion, "failure");
		}),
	);
});

describe("CommentMarker", () => {
	it("renders an HTML comment nobody sees", () => {
		assert.strictEqual(CommentMarker.make({ namespace: "acme", key: "release" }).html, "<!-- acme:release -->");
	});

	it("matches only its own marker", () => {
		const marker = CommentMarker.make({ namespace: "acme", key: "release" });
		assert.isTrue(marker.matches("hello\n\n<!-- acme:release -->"));
		assert.isFalse(marker.matches("hello\n\n<!-- acme:other -->"));
	});

	it("needs no client, no layer and no vendor name baked into the library", () => {
		assert.strictEqual(CommentMarker.make({ namespace: "anyone", key: "k" }).html, "<!-- anyone:k -->");
	});
});

describe("PullRequestComment", () => {
	const comment = (id: number, body: string) => ({ id, body, html_url: `https://x/${id}` });
	const marker = CommentMarker.make({ namespace: "acme", key: "release" });

	it.effect("find PAGINATES, so a busy pull request does not lose the marker", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: [comment(1, "chatter"), comment(2, "more")],
						headers: linkNext("https://api.github.com/repositories/1/issues/5/comments?page=2"),
					},
					{ status: 200, body: [comment(3, `sticky\n\n${marker.html}`)] },
				],
				PullRequestComment,
				PullRequestComment,
				(comments) => comments.find(5, marker),
			);
			// The version this replaces read one page of 100 and stopped.
			assert.strictEqual(Option.getOrThrow(value).id, 3);
			assert.strictEqual(script.count(), 2);
		}),
	);

	it.effect("upsert posts when there is nothing marked yet", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[
					{ status: 200, body: [] },
					{ status: 201, body: comment(9, "x") },
				],
				PullRequestComment,
				PullRequestComment,
				(comments) => comments.upsert(5, marker, "the body"),
			);
			assert.strictEqual(script.calls[1]?.method, "POST");
			assert.include(JSON.parse(script.calls[1]?.body ?? "{}").body, marker.html);
		}),
	);

	it.effect("upsert edits the marked comment when there is one", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[
					{ status: 200, body: [comment(9, `old\n\n${marker.html}`)] },
					{ status: 200, body: comment(9, "new") },
				],
				PullRequestComment,
				PullRequestComment,
				(comments) => comments.upsert(5, marker, "the body"),
			);
			assert.strictEqual(script.calls[1]?.method, "PATCH");
			assert.include(script.calls[1]?.path ?? "", "/issues/comments/9");
		}),
	);
});

describe("PullRequest", () => {
	const pull = (number: number, extra: Record<string, unknown> = {}) => ({
		number,
		node_id: `PR_${number}`,
		html_url: `https://x/${number}`,
		title: `pr ${number}`,
		state: "open",
		head: { ref: "feature" },
		base: { ref: "main" },
		draft: false,
		merged: false,
		merged_at: null,
		...extra,
	});

	it.effect("listAssociatedWithCommit answers the question it is named for", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[{ status: 200, body: [pull(12, { merged_at: "2026-01-01T00:00:00Z", state: "closed" })] }],
				PullRequest,
				PullRequest,
				(pulls) => pulls.listAssociatedWithCommit("abc123"),
			);
			assert.strictEqual(value[0]?.number, 12);
			assert.isTrue(Option.isSome(value[0]?.mergedAt ?? Option.none()));
			assert.include(script.calls[0]?.path ?? "", "/commits/abc123/pulls");
		}),
	);

	it.effect("mergedAt is none for an open pull request", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: pull(1) }], PullRequest, PullRequest, (pulls) =>
				pulls.get(1),
			);
			assert.isTrue(Option.isNone(value.mergedAt));
			assert.isFalse(value.merged);
		}),
	);

	it.effect("upsert opens one when none is open", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{ status: 200, body: [] },
					{ status: 201, body: pull(3) },
				],
				PullRequest,
				PullRequest,
				(pulls) => pulls.upsert({ title: "t", head: "feature", base: "main" }),
			);
			assert.isTrue(value.created);
			assert.strictEqual(script.calls[1]?.method, "POST");
		}),
	);

	it.effect("upsert updates the open one when there is one", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{ status: 200, body: [pull(3)] },
					{ status: 200, body: pull(3, { title: "t2" }) },
				],
				PullRequest,
				PullRequest,
				(pulls) => pulls.upsert({ title: "t2", head: "feature", base: "main" }),
			);
			assert.isFalse(value.created);
			assert.strictEqual(script.calls[1]?.method, "PATCH");
		}),
	);

	it.effect("upsert qualifies the head branch with the owner", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[
					{ status: 200, body: [] },
					{ status: 201, body: pull(3) },
				],
				PullRequest,
				PullRequest,
				(pulls) => pulls.upsert({ title: "t", head: "feature", base: "main" }),
			);
			assert.strictEqual(script.queryOf(0).get("head"), "acme:feature");
		}),
	);

	const info = PullRequestInfo.make({
		number: 3,
		nodeId: "PR_3",
		url: "https://x/3",
		title: "t",
		state: "open",
		head: "feature",
		base: "main",
		draft: false,
		merged: false,
		mergedAt: Option.none(),
	});

	it.effect("setAutoMerge is its own call, carrying the GraphQL merge method", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 200, body: { data: {} } }], PullRequest, PullRequest, (pulls) =>
				pulls.setAutoMerge(info, "squash"),
			);
			const body = JSON.parse(script.calls[0]?.body ?? "{}");
			assert.include(body.query, "enablePullRequestAutoMerge");
			// GraphQL spells the methods in capitals; REST does not.
			assert.deepStrictEqual(body.variables, { pullRequestId: "PR_3", mergeMethod: "SQUASH" });
		}),
	);

	it.effect("setAutoMerge off sends the disable mutation", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 200, body: { data: {} } }], PullRequest, PullRequest, (pulls) =>
				pulls.setAutoMerge(info, "off"),
			);
			const body = JSON.parse(script.calls[0]?.body ?? "{}");
			assert.include(body.query, "disablePullRequestAutoMerge");
			assert.deepStrictEqual(body.variables, { pullRequestId: "PR_3" });
		}),
	);

	it.effect("a create that succeeds is not failed by auto-merge", () =>
		Effect.gen(function* () {
			// The previous surface fired auto-merge from an Effect.tap AFTER create,
			// so an auto-merge failure surfaced as if the create had failed.
			const { value } = yield* drive([{ status: 201, body: pull(4) }], PullRequest, PullRequest, (pulls) =>
				pulls.create({ title: "t", head: "feature", base: "main" }),
			);
			assert.strictEqual(value.number, 4);
		}),
	);
});

describe("GitHubIssue GraphQL documents", () => {
	it.effect("linkedIssues distinguishes human links from inferred ones", () =>
		Effect.gen(function* () {
			const node = (number: number) => ({
				id: `I_${number}`,
				number,
				title: `issue ${number}`,
				state: "OPEN",
				url: `https://x/${number}`,
			});
			const { value } = yield* drive(
				[
					{
						status: 200,
						body: {
							data: {
								repository: {
									pullRequest: {
										allLinked: { nodes: [node(1), node(2)] },
										manuallyLinked: { nodes: [node(2)] },
									},
								},
							},
						},
					},
				],
				GitHubIssue,
				GitHubIssue,
				(issues) => issues.linkedIssues(7),
			);
			// The field the whole owned document exists for.
			assert.isFalse(value.find((issue) => issue.number === 1)?.userLinked);
			assert.isTrue(value.find((issue) => issue.number === 2)?.userLinked);
		}),
	);

	it.effect("isCrossReferencedBy is the idempotence guard", () =>
		Effect.gen(function* () {
			const body = (number: number) => ({
				data: {
					repository: {
						issue: { timelineItems: { nodes: [{ source: { __typename: "PullRequest", number } }] } },
					},
				},
			});
			const { value } = yield* drive([{ status: 200, body: body(42) }], GitHubIssue, GitHubIssue, (issues) =>
				issues.isCrossReferencedBy(1, 42),
			);
			assert.isTrue(value);

			const { value: other } = yield* drive([{ status: 200, body: body(41) }], GitHubIssue, GitHubIssue, (issues) =>
				issues.isCrossReferencedBy(1, 42),
			);
			assert.isFalse(other);
		}),
	);
});

describe("GitHubRelease", () => {
	const release = {
		id: 5,
		tag_name: "v1.0.0",
		name: null,
		body: null,
		draft: false,
		prerelease: false,
		html_url: "https://x/5",
		upload_url: "https://uploads.github.com/x{?name,label}",
	};

	it.effect("coalesces GitHub's nulls for name and body", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: release }], GitHubRelease, GitHubRelease, (releases) =>
				releases.getByTag("v1.0.0"),
			);
			assert.strictEqual(value.name, "");
			assert.strictEqual(value.body, "");
		}),
	);

	it.effect("getByTagOption reads absence as none", () =>
		Effect.gen(function* () {
			const { value } = yield* drive(
				[{ status: 404, body: { message: "Not Found" } }],
				GitHubRelease,
				GitHubRelease,
				(releases) => releases.getByTagOption("v9.9.9"),
			);
			assert.isTrue(Option.isNone(value));
		}),
	);

	it.effect("uploadAsset goes to the uploads host with a content type", () =>
		Effect.gen(function* () {
			const info = ReleaseInfo.make({
				id: 5,
				tag: "v1.0.0",
				name: "",
				body: "",
				draft: false,
				prerelease: false,
				url: "https://x/5",
				uploadUrl: "https://uploads.github.com/x",
			});
			const { value, script } = yield* drive(
				[{ status: 201, body: { id: 9, name: "app.zip", browser_download_url: "https://d/9", size: 12 } }],
				GitHubRelease,
				GitHubRelease,
				(releases) => releases.uploadAsset(info, { name: "app.zip", data: "bytes", contentType: "application/zip" }),
			);
			assert.strictEqual(value.id, 9);
			assert.include(script.calls[0]?.url ?? "", "uploads.github.com");
			assert.strictEqual(script.calls[0]?.headers["content-type"], "application/zip");
		}),
	);

	it.effect("listAssets forwards the caller's page budget", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 200, body: [] }], GitHubRelease, GitHubRelease, (releases) =>
				releases.listAssets(5, { page: PageOptions.make({ perPage: 7 }) }),
			);
			assert.strictEqual(script.queryOf(0).get("per_page"), "7");
		}),
	);
});

describe("WorkflowDispatch", () => {
	const run = (status: string, conclusion?: string) => ({
		status: 200,
		body: {
			workflow_runs: [
				{
					id: 1,
					status,
					html_url: "https://x/1",
					path: ".github/workflows/ci.yml",
					...(conclusion !== undefined ? { conclusion } : {}),
				},
			],
			total_count: 1,
		},
	});

	it.effect("polls until the run finishes, with no sentinel error", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 204 },
				run("queued"),
				run("in_progress"),
				run("completed", "success"),
			]);
			const fiber = yield* Effect.forkChild(
				Effect.provide(
					Effect.flatMap(WorkflowDispatch, (workflows) =>
						workflows.dispatchAndWait("ci.yml", "main", {
							poll: { interval: Duration.seconds(1), timeout: Duration.seconds(30) },
						}),
					),
					WorkflowDispatch.layer.pipe(Layer.provideMerge(base)),
				),
			);
			yield* TestClock.adjust(Duration.seconds(10));
			const status = yield* Fiber.join(fiber);
			assert.strictEqual(status.conclusion, "success");
			assert.isTrue(status.isDone);
			assert.isAtLeast(script.count(), 4);
		}),
	);

	it.effect("fails typed when the run never finishes", () =>
		Effect.gen(function* () {
			const { base } = harness([{ status: 204 }, run("in_progress")]);
			const fiber = yield* Effect.forkChild(
				Effect.flip(
					Effect.provide(
						Effect.flatMap(WorkflowDispatch, (workflows) =>
							workflows.dispatchAndWait("ci.yml", "main", {
								poll: { interval: Duration.seconds(1), timeout: Duration.seconds(3) },
							}),
						),
						WorkflowDispatch.layer.pipe(Layer.provideMerge(base)),
					),
				),
			);
			yield* TestClock.adjust(Duration.seconds(30));
			const error = yield* Fiber.join(fiber);
			assert.strictEqual(error.kind, "rejected");
			assert.include(error.reason, "did not finish");
		}),
	);
});

describe("Attestation", () => {
	it.effect("pins the api version on every call", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 201, body: { id: 3 } }], Attestation, Attestation, (attestations) =>
				attestations.upload({ dsseEnvelope: {} }),
			);
			assert.strictEqual(script.calls[0]?.headers["x-github-api-version"], "2026-03-10");
		}),
	);

	it.effect("reads a 404 as no attestations", () =>
		Effect.gen(function* () {
			const { value } = yield* drive(
				[{ status: 404, body: { message: "Not Found" } }],
				Attestation,
				Attestation,
				(attestations) => attestations.listForSubject("abc"),
			);
			assert.deepStrictEqual(value, []);
		}),
	);

	it.effect("reads a 422 as no attestations too", () =>
		Effect.gen(function* () {
			// GitHub answers a digest it has never seen either way depending on path.
			const { value } = yield* drive(
				[{ status: 422, body: { message: "Validation Failed" } }],
				Attestation,
				Attestation,
				(attestations) => attestations.listForSubject("abc"),
			);
			assert.deepStrictEqual(value, []);
		}),
	);

	it.effect("prefixes a bare hex digest", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[{ status: 200, body: { attestations: [] } }],
				Attestation,
				Attestation,
				(attestations) => attestations.listForSubject("deadbeef"),
			);
			assert.include(script.calls[0]?.path ?? "", "sha256:deadbeef");
		}),
	);

	it.effect("projects entries to url and predicate type", () =>
		Effect.gen(function* () {
			const { value } = yield* drive(
				[
					{
						status: 200,
						body: {
							attestations: [{ id: 1, bundle_url: "https://b/1", predicate_type: "https://slsa.dev/provenance/v1" }],
						},
					},
				],
				Attestation,
				Attestation,
				(attestations) => attestations.listForSubject("sha256:abc"),
			);
			assert.strictEqual(value[0]?.url, "https://b/1");
			assert.strictEqual(value[0]?.predicateType, "https://slsa.dev/provenance/v1");
		}),
	);
});
