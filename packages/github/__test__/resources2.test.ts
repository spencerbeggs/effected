import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Duration, Effect, Exit, Fiber, Latch, Layer, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Attestation } from "../src/Attestation.js";
import { Annotation, CheckRun, CheckRunOutput } from "../src/CheckRun.js";
import type { RecordedCall } from "../src/GitHubClient.js";
import { GitHubClient, GitHubFixtures } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { GitHubIssue } from "../src/GitHubIssue.js";
import { GitHubRelease, ReleaseInfo } from "../src/GitHubRelease.js";
import { PullRequest, PullRequestInfo } from "../src/PullRequest.js";
import { CommentMarker, PullRequestComment } from "../src/PullRequestComment.js";
import { Repo } from "../src/Repo.js";
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

	// The pre-TextEncoder implementation, kept here as the oracle the portable
	// one must match byte for byte. Tests may use Node's Buffer; src may not.
	const bufferCap = (value: string): string => {
		if (Buffer.byteLength(value, "utf8") <= CheckRunOutput.LIMIT_BYTES) return value;
		const budget = CheckRunOutput.LIMIT_BYTES - Buffer.byteLength(CheckRunOutput.NOTICE, "utf8");
		let cut = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
		while (cut.endsWith("�")) cut = cut.slice(0, -1);
		return `${cut}${CheckRunOutput.NOTICE}`;
	};
	const budget = CheckRunOutput.LIMIT_BYTES - new TextEncoder().encode(CheckRunOutput.NOTICE).length;

	for (const [label, character, offset] of [
		["a three-byte CJK character", "中", 1],
		["a three-byte CJK character, one byte later", "中", 2],
		["a four-byte emoji", "🦋", 1],
		["a four-byte emoji, two bytes later", "🦋", 3],
	] as const) {
		it(`cuts cleanly when the budget lands inside ${label}`, () => {
			// `offset` bytes of the first multi-byte character fit; the rest do not.
			const summary = `${"a".repeat(budget - offset)}${character.repeat(200)}`;
			assert.isAbove(new TextEncoder().encode(summary).length, CheckRunOutput.LIMIT_BYTES, "control: it must be cut");
			const cut = CheckRunOutput.make({ title: "t", summary }).truncated().summary;
			const bytes = new TextEncoder().encode(cut);
			assert.isAtMost(bytes.length, CheckRunOutput.LIMIT_BYTES);
			assert.strictEqual(new TextDecoder("utf-8", { fatal: true }).decode(bytes), cut, "valid UTF-8");
			assert.notInclude(cut, "�", "no replacement character at the cut");
			assert.strictEqual(cut, `${"a".repeat(budget - offset)}${CheckRunOutput.NOTICE}`);
			assert.strictEqual(cut, bufferCap(summary), "byte-identical to the Buffer implementation");
		});
	}

	it("matches the Buffer implementation for ASCII, a leading BOM and mixed text", () => {
		for (const summary of [
			"short",
			"a".repeat(70_000),
			`﻿${"b".repeat(70_000)}`,
			"│ ✅ 中文 🦋 ".repeat(8_000),
			`${"x".repeat(budget - 1)}\uD800${"y".repeat(10)}`,
		]) {
			assert.strictEqual(CheckRunOutput.make({ title: "t", summary }).truncated().summary, bufferCap(summary));
		}
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

	// Every scalar value — the whole plane minus the surrogate block, so the
	// cut can land inside any multi-byte sequence or pair without the input
	// itself carrying broken halves. Generated as code points rather than a
	// string because the native string generator stays in printable ASCII;
	// `size` lifts the length scale to the 40 000 cap so the input actually
	// crosses the 65 535-byte budget.
	const ScalarValue = Schema.Union([
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xd7ff })),
		Schema.Int.check(Schema.isBetween({ minimum: 0xe000, maximum: 0x10ffff })),
	]);
	const binaryText = Arbitrary.schema(Schema.Array(ScalarValue).check(Schema.isMaxLength(40_000))).pipe(
		Arbitrary.map((codePoints) => codePoints.map((codePoint) => String.fromCodePoint(codePoint)).join("")),
	);

	it.prop(
		"stays valid UTF-8 within budget for any input",
		[binaryText],
		([summary]) => {
			const cut = CheckRunOutput.make({ title: "t", summary }).truncated().summary;
			const withinBudget = Buffer.byteLength(cut, "utf8") <= CheckRunOutput.LIMIT_BYTES;
			// Round-tripping through UTF-8 is lossless exactly when nothing is broken
			// beyond what the input already contained.
			const noNewDamage = (cut.match(/�/g) ?? []).length <= (summary.match(/�/g) ?? []).length + 1;
			return withinBudget && noNewDamage && cut === bufferCap(summary);
		},
		// `size: 40_000` is load-bearing: at 20_000 no run ever crosses the
		// 65 535-byte budget (0/100 probed), at 40_000 about one in five does.
		// That makes each run expensive — ~0.7s for 100 locally, past the 5s
		// default under coverage on a CI runner — so the run count is halved and
		// the timeout raised rather than the domain shrunk.
		{ arbitrary: { size: 40_000, runs: 50 }, timeout: 30_000 },
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
		head: { ref: "feature", sha: "feature-sha" },
		base: { ref: "main", sha: "base-sha" },
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

	it.effect("carries the prior description — the carry-through read (effected#373)", () =>
		Effect.gen(function* () {
			// Marker-based PR-body management takes the PRIOR body as input; this
			// is the read path that makes `upsert(existing, managed)` possible.
			const { value } = yield* drive(
				[{ status: 200, body: pull(4, { body: "prior description" }) }],
				PullRequest,
				PullRequest,
				(pulls) => pulls.get(4),
			);
			assert.strictEqual(value.body, "prior description");

			// And through `list`, which shares the projection.
			const { value: listed } = yield* drive(
				[{ status: 200, body: [pull(4, { body: "prior description" })] }],
				PullRequest,
				PullRequest,
				(pulls) => pulls.list(),
			);
			assert.strictEqual(listed[0]?.body, "prior description");
		}),
	);

	it.effect("a null description projects as absent, not as a value", () =>
		Effect.gen(function* () {
			// GitHub sends `body: null` for an empty description; the projection
			// omits the optionalKey rather than inventing "".
			const { value } = yield* drive(
				[{ status: 200, body: pull(5, { body: null }) }],
				PullRequest,
				PullRequest,
				(pulls) => pulls.get(5),
			);
			assert.isUndefined(value.body);
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

	it.effect("carries the head and base shas alongside the branch names", () =>
		Effect.gen(function* () {
			// "Which commit did this branch from" is base.sha — routine, and it used
			// to need a raw route.
			const { value } = yield* drive([{ status: 200, body: pull(9) }], PullRequest, PullRequest, (pulls) =>
				pulls.get(9),
			);
			assert.strictEqual(value.head, "feature");
			assert.strictEqual(value.headSha, "feature-sha");
			assert.strictEqual(value.base, "main");
			assert.strictEqual(value.baseSha, "base-sha");
		}),
	);

	it.effect("listFiles carries the status, not the path alone", () =>
		Effect.gen(function* () {
			// The endpoint answers with the same `diff-entry` shape as the
			// single-commit read; projecting to the filename dropped the status and
			// pushed consumers to a raw route.
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: [
							{ filename: "a.txt", status: "modified", additions: 1, deletions: 2 },
							{ filename: "new.txt", status: "renamed", additions: 0, deletions: 0, previous_filename: "old.txt" },
						],
					},
				],
				PullRequest,
				PullRequest,
				(pulls) => pulls.listFiles(7),
			);
			assert.deepStrictEqual(
				value.map((file) => file.path),
				["a.txt", "new.txt"],
			);
			assert.strictEqual(value[0]?.status, "modified");
			assert.strictEqual(value[1]?.status, "renamed");
			assert.strictEqual(value[1]?.previousPath, "old.txt");
			assert.include(script.calls[0]?.path ?? "", "/pulls/7/files");
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
		headSha: "feature-sha",
		base: "main",
		baseSha: "base-sha",
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

describe("GitHubIssue REST", () => {
	const issue = {
		number: 169,
		title: "close me",
		state: "open",
		labels: ["release", { name: "bug" }],
		html_url: "https://x/169",
		node_id: "I_169",
	};

	/**
	 * The default api-version (2022-11-28) is deprecated — sunset 2028-03-10 —
	 * and GitHub flags old-version calls to changed endpoints with a
	 * `Deprecation` header octokit prints to the consumer's console. The module
	 * pins the current version instead (effected#189); these assertions are on
	 * the wire, through the real octokit path, so dropping the header fails.
	 */
	const PINNED = "2026-03-10";

	it.effect("close sends state, state_reason and the pinned api-version", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[{ status: 200, body: { ...issue, state: "closed" } }],
				GitHubIssue,
				GitHubIssue,
				(issues) => issues.close(169, "not_planned"),
			);
			const call = script.calls[0];
			assert.strictEqual(call?.method, "PATCH");
			assert.strictEqual(call.path, "/repos/acme/widget/issues/169");
			assert.strictEqual(call.headers["x-github-api-version"], PINNED);
			const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
			assert.strictEqual(body.state, "closed");
			assert.strictEqual(body.state_reason, "not_planned");
		}),
	);

	it.effect("close without a reason leaves state_reason out of the body", () =>
		Effect.gen(function* () {
			const { script } = yield* drive(
				[{ status: 200, body: { ...issue, state: "closed" } }],
				GitHubIssue,
				GitHubIssue,
				(issues) => issues.close(169),
			);
			const body = JSON.parse(script.calls[0]?.body ?? "{}") as Record<string, unknown>;
			assert.strictEqual(body.state, "closed");
			assert.notProperty(body, "state_reason");
			// The version header does not leak into the body as a parameter.
			assert.notProperty(body, "headers");
		}),
	);

	it.effect("get pins the api-version and normalizes the label union", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive([{ status: 200, body: issue }], GitHubIssue, GitHubIssue, (issues) =>
				issues.get(169),
			);
			assert.strictEqual(script.calls[0]?.headers["x-github-api-version"], PINNED);
			assert.deepStrictEqual([...value.labels], ["release", "bug"]);
			assert.strictEqual(value.nodeId, "I_169");
		}),
	);

	it.effect("comment pins the api-version and returns the new comment id", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive([{ status: 201, body: { id: 77 } }], GitHubIssue, GitHubIssue, (issues) =>
				issues.comment(169, "done"),
			);
			assert.strictEqual(value, 77);
			const call = script.calls[0];
			assert.strictEqual(call?.method, "POST");
			assert.strictEqual(call.path, "/repos/acme/widget/issues/169/comments");
			assert.strictEqual(call.headers["x-github-api-version"], PINNED);
			assert.strictEqual((JSON.parse(call.body ?? "{}") as Record<string, unknown>).body, "done");
		}),
	);

	it.effect("list pins the api-version and forwards its page options", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive([{ status: 200, body: [issue] }], GitHubIssue, GitHubIssue, (issues) =>
				issues.list({ state: "open", labels: ["release", "bug"], page: PageOptions.make({ perPage: 5 }) }),
			);
			assert.strictEqual(value.length, 1);
			assert.strictEqual(script.calls[0]?.headers["x-github-api-version"], PINNED);
			assert.strictEqual(script.queryOf(0).get("per_page"), "5");
			assert.strictEqual(script.queryOf(0).get("state"), "open");
			assert.strictEqual(script.queryOf(0).get("labels"), "release,bug");
			// The header rode as a header, not as a query parameter.
			assert.isNull(script.queryOf(0).get("headers"));
		}),
	);
});

describe("GitHubIssue.commentOnce", () => {
	const marker = CommentMarker.make({ namespace: "acme", key: "once" });
	const comment = (id: number, body: string) => ({ id, body, html_url: `https://x/${id}` });

	it.effect("skips when the marker is already there — even on a later page", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: [comment(1, "chatter"), comment(2, "more chatter")],
						headers: linkNext("https://api.github.com/repositories/1/issues/5/comments?page=2"),
					},
					{ status: 200, body: [comment(3, `already said\n\n${marker.html}`)] },
				],
				GitHubIssue,
				GitHubIssue,
				(issues) => issues.commentOnce(5, marker, "the body"),
			);
			// Found on page TWO: a single-page read would have posted a duplicate.
			assert.isFalse(value.wrote);
			assert.strictEqual(value.comment.id, 3);
			assert.strictEqual(script.count(), 2);
			// Create-or-skip, never edit: nothing was posted or patched.
			assert.isTrue(script.calls.every((call) => call.method === "GET"));
		}),
	);

	it.effect("creates with the marker appended exactly as upsert formats it", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{ status: 200, body: [comment(1, "unrelated chatter")] },
					{ status: 201, body: comment(9, `the body\n\n${marker.html}`) },
				],
				GitHubIssue,
				GitHubIssue,
				(issues) => issues.commentOnce(5, marker, "the body"),
			);
			assert.isTrue(value.wrote);
			assert.strictEqual(value.comment.id, 9);
			const post = script.calls[1];
			assert.strictEqual(post?.method, "POST");
			assert.strictEqual(post.path, "/repos/acme/widget/issues/5/comments");
			// The exact `upsert` spelling, so either member's comment is findable
			// by the other's marker check.
			const sent = (JSON.parse(post.body ?? "{}") as Record<string, unknown>).body;
			assert.strictEqual(sent, `the body\n\n${marker.html}`);
			// The pinned api-version rides on the read AND the write.
			for (const call of script.calls) {
				assert.strictEqual(call.headers["x-github-api-version"], "2026-03-10");
			}
		}),
	);

	it.effect("passes the client's GitHubError through untouched", () =>
		Effect.gen(function* () {
			const { base } = harness([{ status: 404, body: { message: "Not Found" } }]);
			const error = yield* Effect.flip(
				Effect.provide(
					Effect.flatMap(GitHubIssue, (issues) => issues.commentOnce(5, marker, "the body")),
					GitHubIssue.layer.pipe(Layer.provideMerge(base)),
				),
			);
			assert.strictEqual(error.kind, "notFound");
		}),
	);

	it("makeTest dies loudly on the unstubbed member, naming it", () => {
		assert.throws(
			() => GitHubIssue.makeTest({}).commentOnce(1, marker, "x"),
			/commentOnce\(\) was called but not stubbed/,
		);
	});
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
			// The discriminating assertion is on the BUILT url, not the arguments:
			// this route is outside the generated map, so a `name` passed only as
			// a parameter is silently dropped by octokit — every upload then 400s
			// with "Invalid name for request" (live incident, 2026-07-26).
			assert.strictEqual(script.queryOf(0).get("name"), "app.zip");
			assert.isFalse(script.queryOf(0).has("label"));
			assert.notInclude(script.calls[0]?.url ?? "", "&");
		}),
	);

	it.effect("uploadAsset carries an optional display label as a second query parameter", () =>
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
			const { script } = yield* drive(
				[{ status: 201, body: { id: 9, name: "app.zip", browser_download_url: "https://d/9", size: 12 } }],
				GitHubRelease,
				GitHubRelease,
				(releases) =>
					releases.uploadAsset(info, {
						name: "app.zip",
						data: "bytes",
						contentType: "application/zip",
						label: "Tarball (npm)",
					}),
			);
			assert.strictEqual(script.queryOf(0).get("name"), "app.zip");
			assert.strictEqual(script.queryOf(0).get("label"), "Tarball (npm)");
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

describe("WorkflowDispatch.list", () => {
	const workflowsBody = (workflows: ReadonlyArray<Record<string, unknown>>) => ({
		status: 200,
		body: { total_count: workflows.length, workflows },
	});

	it.effect("reports every workflow, including disabled ones, without interpreting state", () =>
		Effect.gen(function* () {
			// State is reported, never filtered here. Whether a *disabled* workflow
			// counts for a given GitHub feature is that feature's server-side rule,
			// which this package cannot test — so it does not encode a guess about
			// it. A caller that cares filters on `state` itself.
			const { script, base } = harness([
				workflowsBody([
					{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
					{ id: 2, name: "Old", path: ".github/workflows/old.yml", state: "disabled_manually" },
				]),
			]);
			const workflows = yield* Effect.provide(
				Effect.flatMap(WorkflowDispatch, (w) => w.list),
				WorkflowDispatch.layer.pipe(Layer.provideMerge(base)),
			);
			assert.deepStrictEqual(
				[...workflows],
				[
					{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
					{ id: 2, name: "Old", path: ".github/workflows/old.yml", state: "disabled_manually" },
				],
			);
			assert.include(script.calls[0]?.url ?? "", "/actions/workflows");
		}),
	);

	it.effect("a repository with no workflows is an empty array, not a failure", () =>
		Effect.gen(function* () {
			// The case the reporting consumer actually hit: every repository they
			// ran against had zero workflows. Failing here would make "no
			// workflows" indistinguishable from "could not ask".
			const { base } = harness([workflowsBody([])]);
			const workflows = yield* Effect.provide(
				Effect.flatMap(WorkflowDispatch, (w) => w.list),
				WorkflowDispatch.layer.pipe(Layer.provideMerge(base)),
			);
			assert.lengthOf(workflows, 0);
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

/** Drive a resource over a fixture client, recording every call it makes. */
const viaFixtures = <I, S, A, E>(
	fixtures: Omit<Parameters<typeof GitHubClient.layerFixture>[0], "requested">,
	service: { readonly layer: Layer.Layer<I, never, GitHubClient> },
	tag: Effect.Effect<S, never, I>,
	use: (resource: S) => Effect.Effect<A, E, Repo>,
) =>
	Effect.gen(function* () {
		const requested: Array<RecordedCall> = [];
		const client = GitHubClient.layerFixture({ ...fixtures, requested });
		const value = yield* Effect.provide(
			Effect.flatMap(tag, use),
			Layer.mergeAll(service.layer.pipe(Layer.provide(client)), Repo.layerFromSlug("o/r")),
		);
		return { value, requested };
	});

const CREATED = { id: 7, name: "lint", html_url: "https://x/7", status: "queued", external_id: "d1" };

describe("CheckRun create and update options", () => {
	it.effect("create sends status, external_id and details_url when given", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* viaFixtures(
				{ request: { "POST /repos/{owner}/{repo}/check-runs": CREATED } },
				CheckRun,
				CheckRun,
				(check) => check.create("lint", "abc", { status: "queued", externalId: "d1", detailsUrl: "https://ci/1" }),
			);
			const params = requested[0]?.params ?? {};
			assert.strictEqual(params.status, "queued");
			assert.strictEqual(params.external_id, "d1");
			assert.strictEqual(params.details_url, "https://ci/1");
			assert.isUndefined(params.started_at, "a queued run has not started");
			assert.strictEqual(value.externalId, "d1");
		}),
	);

	it.effect("create with no options still starts an in-progress run", () =>
		Effect.gen(function* () {
			const { requested } = yield* viaFixtures(
				{
					request: {
						"POST /repos/{owner}/{repo}/check-runs": { ...CREATED, external_id: null, status: "in_progress" },
					},
				},
				CheckRun,
				CheckRun,
				(check) => check.create("lint", "abc"),
			);
			const params = requested[0]?.params ?? {};
			assert.strictEqual(params.status, "in_progress");
			assert.isString(params.started_at);
			assert.isFalse("external_id" in params);
			assert.isFalse("details_url" in params);
		}),
	);

	it.effect("stamps started_at and completed_at from Clock", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_800_000_000_000);
			const { requested } = yield* viaFixtures(
				{
					request: {
						"POST /repos/{owner}/{repo}/check-runs": CREATED,
						"PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED,
					},
				},
				CheckRun,
				CheckRun,
				(check) =>
					Effect.gen(function* () {
						yield* check.create("lint", "abc");
						yield* TestClock.adjust(Duration.minutes(2));
						yield* check.complete(7, "success");
					}),
			);
			assert.strictEqual(requested[0]?.params.started_at, new Date(1_800_000_000_000).toISOString());
			assert.strictEqual(requested[1]?.params.completed_at, new Date(1_800_000_120_000).toISOString());
		}),
	);

	it.effect("update to in_progress stamps started_at from Clock; other updates do not", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_800_000_000_000);
			const { requested } = yield* viaFixtures(
				{
					request: {
						"POST /repos/{owner}/{repo}/check-runs": CREATED,
						"PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED,
					},
				},
				CheckRun,
				CheckRun,
				(check) =>
					Effect.gen(function* () {
						yield* check.create("lint", "abc", { status: "queued" });
						yield* TestClock.adjust(Duration.minutes(3));
						yield* check.update(7, CheckRunOutput.make({ title: "t", summary: "s" }), { status: "in_progress" });
						yield* check.update(7, CheckRunOutput.make({ title: "t", summary: "s" }));
						yield* check.update(7, CheckRunOutput.make({ title: "t", summary: "s" }), { status: "queued" });
					}),
			);
			assert.isFalse("started_at" in (requested[0]?.params ?? {}), "a queued run has not started");
			assert.strictEqual(requested[1]?.params.started_at, new Date(1_800_000_180_000).toISOString());
			assert.isFalse("started_at" in (requested[2]?.params ?? {}), "an output-only update leaves started_at");
			assert.isFalse("started_at" in (requested[3]?.params ?? {}), "a queued update has not started");
		}),
	);

	it.effect("omits an empty externalId rather than sending one no lookup can find", () =>
		Effect.gen(function* () {
			const { requested } = yield* viaFixtures(
				{ request: { "POST /repos/{owner}/{repo}/check-runs": CREATED } },
				CheckRun,
				CheckRun,
				(check) => check.create("lint", "abc", { externalId: "" }),
			);
			assert.isFalse("external_id" in (requested[0]?.params ?? {}));
		}),
	);

	it.effect("update sends a status and details_url alongside the output", () =>
		Effect.gen(function* () {
			const { requested } = yield* viaFixtures(
				{ request: { "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED } },
				CheckRun,
				CheckRun,
				(check) =>
					Effect.gen(function* () {
						yield* check.update(7, CheckRunOutput.make({ title: "t", summary: "s" }), {
							status: "in_progress",
							detailsUrl: "https://ci/2",
						});
						yield* check.update(7, CheckRunOutput.make({ title: "t", summary: "s" }));
					}),
			);
			assert.strictEqual(requested[0]?.params.status, "in_progress");
			assert.strictEqual(requested[0]?.params.details_url, "https://ci/2");
			assert.isFalse("status" in (requested[1]?.params ?? {}), "no options, no status change");
			assert.deepStrictEqual(requested[1]?.params.output, { title: "t", summary: "s" }, "an output still goes out");
		}),
	);

	it.effect("update with no output sends a status and details_url and no output key", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_800_000_000_000);
			const { requested } = yield* viaFixtures(
				{ request: { "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED } },
				CheckRun,
				CheckRun,
				(check) => check.update(7, undefined, { status: "in_progress", detailsUrl: "https://ci/3" }),
			);
			const params = requested[0]?.params ?? {};
			assert.isFalse("output" in params, "an omitted output sends no output key");
			assert.strictEqual(params.status, "in_progress");
			assert.strictEqual(params.details_url, "https://ci/3");
			assert.strictEqual(params.started_at, new Date(1_800_000_000_000).toISOString());
		}),
	);

	it.effect("update with neither output nor options still sends one PATCH that changes nothing", () =>
		Effect.gen(function* () {
			const { requested } = yield* viaFixtures(
				{ request: { "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED } },
				CheckRun,
				CheckRun,
				(check) => check.update(7),
			);
			assert.lengthOf(requested, 1);
			assert.deepStrictEqual(requested[0]?.params, { owner: "o", repo: "r", check_run_id: 7 });
		}),
	);

	it.effect("complete sends details_url when given, keeping the Clock stamp and the byte cap", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(1_800_000_000_000);
			const { requested } = yield* viaFixtures(
				{ request: { "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": CREATED } },
				CheckRun,
				CheckRun,
				(check) =>
					Effect.gen(function* () {
						yield* check.complete(7, "success", CheckRunOutput.make({ title: "t", summary: "x".repeat(70_000) }), {
							detailsUrl: "https://ci/run/9",
						});
						yield* check.complete(7, "failure", undefined, { detailsUrl: "https://ci/run/10" });
						yield* check.complete(7, "neutral");
					}),
			);
			const [withOutput, withoutOutput, plain] = requested.map((call) => call.params);
			assert.strictEqual(withOutput?.details_url, "https://ci/run/9");
			assert.strictEqual(withOutput?.completed_at, new Date(1_800_000_000_000).toISOString());
			assert.strictEqual(withOutput?.status, "completed");
			const summary = (withOutput?.output as { summary: string } | undefined)?.summary ?? "";
			assert.isAtMost(new TextEncoder().encode(summary).length, CheckRunOutput.LIMIT_BYTES);
			assert.strictEqual(withoutOutput?.details_url, "https://ci/run/10");
			assert.isFalse("output" in (withoutOutput ?? {}));
			assert.isFalse("details_url" in (plain ?? {}), "no option, no details_url");
		}),
	);

	it.effect("decodes a response missing name into a typed decode failure", () =>
		Effect.gen(function* () {
			const { name: _name, ...nameless } = CREATED;
			const result = yield* Effect.result(
				viaFixtures(
					{
						request: {
							"GET /repos/{owner}/{repo}/check-runs/{check_run_id}": nameless,
							"POST /repos/{owner}/{repo}/check-runs": nameless,
						},
						paginate: { "GET /repos/{owner}/{repo}/commits/{ref}/check-runs": [nameless] },
					},
					CheckRun,
					CheckRun,
					(check) =>
						Effect.all([
							Effect.flip(check.get(7)),
							Effect.flip(check.create("lint", "abc")),
							Effect.flip(check.findByExternalId("abc", "lint", "d1")),
						]),
				),
			);
			assert.isTrue(Result.isSuccess(result), "every member fails typed rather than dying");
			if (Result.isSuccess(result)) {
				assert.deepStrictEqual(
					result.success.value.map((error) => [error.kind, error.operation]),
					[
						["decode", "CheckRun.get"],
						["decode", "CheckRun.create"],
						["decode", "CheckRun.findByExternalId"],
					],
				);
				for (const error of result.success.value) assert.instanceOf(error, GitHubError);
			}
		}),
	);
});

describe("CheckRun.findByExternalId", () => {
	const ROUTE = "GET /repos/{owner}/{repo}/commits/{ref}/check-runs";
	const runAt = (id: number, externalId: string | null) => ({
		id,
		name: "lint",
		html_url: `https://x/${id}`,
		status: "completed",
		external_id: externalId,
	});
	// 150 runs: the default page holds 100, so a match at the end is on page 2.
	const runs = [
		...Array.from({ length: 140 }, (_, index) => runAt(index + 1, `other-${index}`)),
		runAt(500, "wanted"),
		runAt(900, "wanted"),
		runAt(700, "wanted"),
		...Array.from({ length: 7 }, (_, index) => runAt(1000 + index, null)),
	];

	it.effect("pages to the newest run with the external id, filtered by check name", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* viaFixtures({ paginate: { [ROUTE]: runs } }, CheckRun, CheckRun, (check) =>
				check.findByExternalId("abc", "lint", "wanted"),
			);
			assert.isTrue(Option.isSome(value));
			if (Option.isSome(value)) {
				assert.strictEqual(value.value.id, 900, "the newest by id, wherever it sits");
				assert.strictEqual(value.value.externalId, "wanted");
			}
			assert.strictEqual(requested[0]?.params.ref, "abc");
			assert.strictEqual(requested[0]?.params.check_name, "lint");
			// GitHub's default filter=latest returns only the newest run per name,
			// which would hide an older run carrying the wanted external id.
			assert.strictEqual(requested[0]?.params.filter, "all");
		}),
	);

	it.effect("is none when no run carries the external id", () =>
		Effect.gen(function* () {
			const { value } = yield* viaFixtures({ paginate: { [ROUTE]: runs } }, CheckRun, CheckRun, (check) =>
				check.findByExternalId("abc", "lint", "missing"),
			);
			assert.isTrue(Option.isNone(value));
		}),
	);

	it.effect("is none for an empty external id, without asking GitHub", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* viaFixtures({ paginate: { [ROUTE]: runs } }, CheckRun, CheckRun, (check) =>
				check.findByExternalId("abc", "lint", ""),
			);
			assert.isTrue(Option.isNone(value));
			assert.lengthOf(requested, 0);
		}),
	);

	it.effect("decodes a null external_id as an absent externalId", () =>
		Effect.gen(function* () {
			const { value } = yield* viaFixtures(
				{ request: { "GET /repos/{owner}/{repo}/check-runs/{check_run_id}": runAt(3, null) } },
				CheckRun,
				CheckRun,
				(check) => check.get(3),
			);
			assert.isFalse("externalId" in value);
		}),
	);

	it("makeTest names the new members when they are unstubbed", () => {
		const double = CheckRun.makeTest();
		assert.throws(() => double.findByExternalId("a", "b", "c"), /findByExternalId\(\) was called but not stubbed/);
	});
});

describe("WorkflowDispatch.cancelRun", () => {
	const ROUTE = "POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel";

	it.effect("is cancelled on a 202", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* viaFixtures(
				{ request: { [ROUTE]: {} } },
				WorkflowDispatch,
				WorkflowDispatch,
				(w) => w.cancelRun(42),
			);
			assert.strictEqual(value, "cancelled");
			assert.strictEqual(requested[0]?.params.run_id, 42);
		}),
	);

	it.effect("is alreadyCompleted on a 409", () =>
		Effect.gen(function* () {
			const { value } = yield* viaFixtures(
				{
					request: {
						[ROUTE]: GitHubFixtures.failure({
							status: 409,
							body: { message: "Cannot cancel a workflow run that is completed." },
						}),
					},
				},
				WorkflowDispatch,
				WorkflowDispatch,
				(w) => w.cancelRun(42),
			);
			assert.strictEqual(value, "alreadyCompleted");
		}),
	);

	it.effect("fails notFound on a 404, and any other failure stays a GitHubError", () =>
		Effect.gen(function* () {
			for (const [status, kind] of [
				[404, "notFound"],
				[422, "rejected"],
			] as const) {
				const error = yield* Effect.flip(
					viaFixtures(
						{ request: { [ROUTE]: GitHubFixtures.failure({ status, body: { message: "nope" } }) } },
						WorkflowDispatch,
						WorkflowDispatch,
						(w) => w.cancelRun(42),
					),
				);
				assert.strictEqual(error._tag, "GitHubError");
				if (error._tag === "GitHubError") assert.strictEqual(error.kind, kind, String(status));
			}
		}),
	);

	it("makeTest names cancelRun when it is unstubbed", () => {
		assert.throws(() => WorkflowDispatch.makeTest().cancelRun(1), /cancelRun\(\) was called but not stubbed/);
	});
});

describe("WorkflowDispatch.dispatchWithRun", () => {
	const ROUTE = "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches";
	const DETAILS = {
		workflow_run_id: 9001,
		run_url: "https://api.github.com/repos/acme/widget/actions/runs/9001",
		html_url: "https://github.com/acme/widget/actions/runs/9001",
	};

	it.effect("a 200 is Some run, and the request carries return_run_details with ref and inputs", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* viaFixtures(
				{ request: { [ROUTE]: DETAILS } },
				WorkflowDispatch,
				WorkflowDispatch,
				(w) => w.dispatchWithRun("release.yml", "main", { dryRun: "false" }),
			);
			assert.isTrue(Option.isSome(value));
			if (Option.isSome(value)) {
				assert.strictEqual(value.value.runId, 9001);
				assert.strictEqual(value.value.runUrl, DETAILS.run_url);
				assert.strictEqual(value.value.htmlUrl, DETAILS.html_url);
			}
			assert.lengthOf(requested, 1);
			assert.strictEqual(requested[0]?.route, ROUTE);
			assert.strictEqual(requested[0]?.params.workflow_id, "release.yml");
			assert.strictEqual(requested[0]?.params.ref, "main");
			assert.deepStrictEqual(requested[0]?.params.inputs, { dryRun: "false" });
			assert.strictEqual(requested[0]?.params.return_run_details, true);
		}),
	);

	it.effect("puts return_run_details on the wire through the real client", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[{ status: 200, body: DETAILS }],
				WorkflowDispatch,
				WorkflowDispatch,
				(w) => w.dispatchWithRun("release.yml", "main", { dryRun: "false" }),
			);
			assert.isTrue(Option.isSome(value));
			assert.strictEqual(script.calls[0]?.method, "POST");
			assert.strictEqual(script.calls[0]?.path, "/repos/acme/widget/actions/workflows/release.yml/dispatches");
			assert.deepStrictEqual(JSON.parse(script.calls[0]?.body ?? "null"), {
				ref: "main",
				inputs: { dryRun: "false" },
				return_run_details: true,
			});
		}),
	);

	it.effect("a 204 with no body is None, not a failure", () =>
		Effect.gen(function* () {
			// What a GitHub Enterprise Server predating the field answers: driven
			// through the real client so octokit's own 204 handling is what is read.
			const { value, script } = yield* drive([{ status: 204 }], WorkflowDispatch, WorkflowDispatch, (w) =>
				w.dispatchWithRun("release.yml", "main"),
			);
			assert.isTrue(Option.isNone(value));
			assert.strictEqual(script.count(), 1);
		}),
	);

	it.effect("a fixture stubbed with null, the no-body convention, is None too", () =>
		Effect.gen(function* () {
			const { value } = yield* viaFixtures(
				{ request: { "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches": null } },
				WorkflowDispatch,
				WorkflowDispatch,
				(w) => w.dispatchWithRun("release.yml", "main"),
			);
			assert.isTrue(Option.isNone(value));
		}),
	);

	it.effect("a 200 whose body is not run details fails decode", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				drive(
					[{ status: 200, body: { workflow_run_id: "nine", run_url: DETAILS.run_url } }],
					WorkflowDispatch,
					WorkflowDispatch,
					(w) => w.dispatchWithRun("release.yml", "main"),
				),
			);
			assert.strictEqual(error._tag, "GitHubError");
			assert.strictEqual(error.kind, "decode");
			assert.strictEqual(error.operation, "WorkflowDispatch.dispatchWithRun");
		}),
	);

	it.effect("a 404 or 422 passes through as the client classified it", () =>
		Effect.gen(function* () {
			for (const [status, kind] of [
				[404, "notFound"],
				[422, "rejected"],
			] as const) {
				const error = yield* Effect.flip(
					viaFixtures(
						{ request: { [ROUTE]: GitHubFixtures.failure({ status, body: { message: "nope" } }) } },
						WorkflowDispatch,
						WorkflowDispatch,
						(w) => w.dispatchWithRun("release.yml", "main"),
					),
				);
				if (error._tag !== "GitHubError") return assert.fail(`expected a GitHubError, got ${error._tag}`);
				assert.strictEqual(error.kind, kind, String(status));
				assert.strictEqual(error.status, status);
			}
		}),
	);

	it.effect("plain dispatch does not send return_run_details", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 204 }], WorkflowDispatch, WorkflowDispatch, (w) =>
				w.dispatch("release.yml", "main", { dryRun: "false" }),
			);
			assert.deepStrictEqual(JSON.parse(script.calls[0]?.body ?? "null"), {
				ref: "main",
				inputs: { dryRun: "false" },
			});
		}),
	);

	it("makeTest names dispatchWithRun when it is unstubbed", () => {
		assert.throws(
			() => WorkflowDispatch.makeTest().dispatchWithRun("a.yml", "main"),
			/dispatchWithRun\(\) was called but not stubbed/,
		);
	});
});

describe("WorkflowDispatch.dispatchAndWait run identity", () => {
	const runById = (status: string, conclusion?: string) => ({
		status: 200,
		body: {
			id: 9001,
			status,
			html_url: "https://github.com/acme/widget/actions/runs/9001",
			...(conclusion !== undefined ? { conclusion } : {}),
		},
	});

	it.effect("polls exactly the run GitHub reported, never the run list", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{
					status: 200,
					body: {
						workflow_run_id: 9001,
						run_url: "https://api.github.com/repos/acme/widget/actions/runs/9001",
						html_url: "https://github.com/acme/widget/actions/runs/9001",
					},
				},
				runById("queued"),
				runById("in_progress"),
				runById("completed", "success"),
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
			// Past the whole poll window, so a regression that polls the wrong route
			// fails on the assertions below instead of hanging.
			yield* TestClock.adjust(Duration.seconds(60));
			const status = yield* Fiber.join(fiber);
			assert.strictEqual(status.id, 9001);
			assert.strictEqual(status.conclusion, "success");
			const polls = script.calls.slice(1);
			assert.lengthOf(polls, 3);
			for (const call of polls) {
				assert.strictEqual(call.method, "GET");
				assert.strictEqual(call.path, "/repos/acme/widget/actions/runs/9001");
			}
		}),
	);

	it.effect("falls back to the run list when the dispatch answers 204", () =>
		Effect.gen(function* () {
			const { script, base } = harness([
				{ status: 204 },
				{
					status: 200,
					body: {
						total_count: 1,
						workflow_runs: [
							{
								id: 5,
								status: "completed",
								conclusion: "success",
								html_url: "https://x/5",
								path: ".github/workflows/ci.yml",
							},
						],
					},
				},
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
			assert.strictEqual(status.id, 5);
			assert.strictEqual(script.calls[1]?.path, "/repos/acme/widget/actions/runs");
			assert.strictEqual(script.queryOf(1).get("branch"), "main");
			assert.isTrue(script.queryOf(1).get("created")?.startsWith(">=") ?? false);
		}),
	);
});
