import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CheckRun, CheckRunOutput, CheckRunRef, ReportedCheckRunOutput } from "../src/CheckRun.js";
import type { Repo } from "../src/Repo.js";
import { PageOptions } from "../src/Rest.js";
import type { Reply } from "./fixtures.js";
import { linkNext } from "./fixtures.js";
import { harness } from "./harness.js";

const drive = <A, E>(replies: ReadonlyArray<Reply>, use: (check: CheckRun["Service"]) => Effect.Effect<A, E, Repo>) =>
	Effect.gen(function* () {
		const { script, base } = harness(replies);
		const value = yield* Effect.provide(Effect.flatMap(CheckRun, use), CheckRun.layer.pipe(Layer.provideMerge(base)));
		return { value, script };
	});

/** A check run as GitHub's REST schema describes it, every field present. */
const wireRun = (overrides: Record<string, unknown> = {}) => ({
	id: 4,
	head_sha: "009b8a3a9ccbb128af87f9b1c0f4c62e8a304f6d",
	node_id: "MDg6Q2hlY2tSdW40",
	external_id: "42",
	url: "https://api.github.com/repos/acme/widget/check-runs/4",
	html_url: "https://github.com/acme/widget/runs/4",
	details_url: "https://example.com/details",
	status: "completed",
	conclusion: "neutral",
	started_at: "2018-05-04T01:14:52Z",
	completed_at: "2018-05-04T01:15:52Z",
	output: {
		title: "Mighty Readme report",
		summary: "There are 0 failures.",
		text: "long-form text that must not be kept",
		annotations_count: 2,
		annotations_url: "https://api.github.com/repos/acme/widget/check-runs/4/annotations",
	},
	name: "mighty_readme",
	check_suite: { id: 5 },
	app: null,
	pull_requests: [],
	...overrides,
});

describe("CheckRunRef projection", () => {
	it.effect("decodes every documented field, keeping the web url under `url`", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: wireRun() }], (check) => check.get(4));
			assert.deepStrictEqual(
				value,
				CheckRunRef.make({
					id: 4,
					name: "mighty_readme",
					url: "https://github.com/acme/widget/runs/4",
					status: "completed",
					externalId: "42",
					headSha: "009b8a3a9ccbb128af87f9b1c0f4c62e8a304f6d",
					nodeId: "MDg6Q2hlY2tSdW40",
					conclusion: "neutral",
					startedAt: "2018-05-04T01:14:52Z",
					completedAt: "2018-05-04T01:15:52Z",
					detailsUrl: "https://example.com/details",
					htmlUrl: "https://github.com/acme/widget/runs/4",
					apiUrl: "https://api.github.com/repos/acme/widget/check-runs/4",
					checkSuiteId: 5,
					output: ReportedCheckRunOutput.make({
						title: "Mighty Readme report",
						summary: "There are 0 failures.",
						annotationsCount: 2,
					}),
				}),
			);
		}),
	);

	it.effect("keeps GitHub's nulls: no web url, no suite, an unfinished run", () =>
		Effect.gen(function* () {
			const { value } = yield* drive(
				[
					{
						status: 200,
						body: wireRun({
							html_url: null,
							details_url: null,
							check_suite: null,
							status: "queued",
							conclusion: null,
							started_at: null,
							completed_at: null,
							output: { title: null, summary: null, text: null, annotations_count: 0, annotations_url: "x" },
						}),
					},
				],
				(check) => check.get(4),
			);
			assert.strictEqual(value.url, "");
			assert.isNull(value.htmlUrl);
			assert.isNull(value.detailsUrl);
			assert.isNull(value.checkSuiteId);
			assert.isNull(value.conclusion);
			assert.isNull(value.startedAt);
			assert.isNull(value.completedAt);
			assert.deepStrictEqual(
				value.output,
				ReportedCheckRunOutput.make({ title: null, summary: null, annotationsCount: 0 }),
			);
		}),
	);

	it.effect("decodes a stale conclusion, which only GitHub can set", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: wireRun({ conclusion: "stale" }) }], (check) =>
				check.get(4),
			);
			assert.strictEqual(value.conclusion, "stale");
		}),
	);

	it.effect("refuses a status outside the documented set with a typed decode error", () =>
		Effect.gen(function* () {
			const { value } = yield* drive([{ status: 200, body: wireRun({ status: "mystery" }) }], (check) =>
				Effect.flip(check.get(4)),
			);
			assert.deepStrictEqual([value.kind, value.operation], ["decode", "CheckRun.get"]);
		}),
	);
});

describe("CheckRun.updateRef / completeRef", () => {
	it.effect("updateRef answers the PATCH response and sends what update sends", () =>
		Effect.gen(function* () {
			const reply: Reply = { status: 200, body: wireRun({ status: "in_progress", conclusion: null }) };
			const output = CheckRunOutput.make({ title: "t", summary: "s" });
			const viaRef = yield* drive([reply], (check) =>
				check.updateRef(4, output, { detailsUrl: "https://example.com/d" }),
			);
			const viaVoid = yield* drive([reply], (check) =>
				check.update(4, output, { detailsUrl: "https://example.com/d" }),
			);
			assert.strictEqual(viaRef.value.status, "in_progress");
			assert.strictEqual(viaRef.value.id, 4);
			assert.strictEqual(viaRef.script.calls[0]?.method, "PATCH");
			assert.strictEqual(viaRef.script.calls[0]?.body, viaVoid.script.calls[0]?.body);
			assert.lengthOf(viaRef.script.calls, 1);
		}),
	);

	it.effect("completeRef answers the finished run", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[{ status: 200, body: wireRun({ conclusion: "success", status: "completed" }) }],
				(check) => check.completeRef(4, "success"),
			);
			assert.strictEqual(value.conclusion, "success");
			assert.strictEqual(value.status, "completed");
			const body = JSON.parse(script.calls[0]?.body ?? "{}");
			assert.deepStrictEqual([body.status, body.conclusion], ["completed", "success"]);
			assert.isString(body.completed_at);
		}),
	);

	// update and complete discard the response: complete runs in the bracket's
	// finalizer, and must not fail over a field nobody asked to read.
	it.effect("update and complete do not decode the response", () =>
		Effect.gen(function* () {
			const odd: Reply = { status: 200, body: { id: 4, name: "n", status: "mystery" } };
			yield* drive([odd], (check) => check.update(4));
			yield* drive([odd], (check) => check.complete(4, "success"));
			const control = yield* drive([odd], (check) => Effect.flip(check.updateRef(4)));
			assert.deepStrictEqual([control.value.kind, control.value.operation], ["decode", "CheckRun.updateRef"]);
		}),
	);
});

describe("CheckRun.list", () => {
	it.effect("sends each filter and walks every page", () =>
		Effect.gen(function* () {
			const page = (ids: ReadonlyArray<number>) => ({
				total_count: 3,
				check_runs: ids.map((id) => wireRun({ id, name: "lint" })),
			});
			const { value, script } = yield* drive(
				[
					{ status: 200, body: page([1, 2]), headers: linkNext("https://api.github.com/next?page=2") },
					{ status: 200, body: page([3]) },
				],
				(check) => check.list("main", { checkName: "lint", appId: 15368, status: "completed", filter: "all" }),
			);
			assert.deepStrictEqual(
				value.map((run) => run.id),
				[1, 2, 3],
			);
			assert.strictEqual(script.calls[0]?.path, "/repos/acme/widget/commits/main/check-runs");
			const query = script.queryOf(0);
			assert.deepStrictEqual(
				[query.get("check_name"), query.get("app_id"), query.get("status"), query.get("filter")],
				["lint", "15368", "completed", "all"],
			);
			assert.lengthOf(script.calls, 2);
		}),
	);

	it.effect("sends no filter it was not given", () =>
		Effect.gen(function* () {
			const { script } = yield* drive([{ status: 200, body: { total_count: 0, check_runs: [] } }], (check) =>
				check.list("abc"),
			);
			const query = script.queryOf(0);
			for (const key of ["check_name", "app_id", "status", "filter"]) assert.isNull(query.get(key), key);
		}),
	);

	it.effect("honours maxPages", () =>
		Effect.gen(function* () {
			const { value, script } = yield* drive(
				[
					{
						status: 200,
						body: { total_count: 2, check_runs: [wireRun({ id: 1 })] },
						headers: linkNext("https://api.github.com/next?page=2"),
					},
					{ status: 200, body: { total_count: 2, check_runs: [wireRun({ id: 2 })] } },
				],
				(check) => check.list("abc", { page: PageOptions.make({ perPage: 1, maxPages: 1 }) }),
			);
			assert.lengthOf(value, 1);
			assert.lengthOf(script.calls, 1);
		}),
	);
});

describe("CheckRun.makeTest", () => {
	it("dies naming an unstubbed new member", () => {
		const double = CheckRun.makeTest();
		for (const member of ["updateRef", "completeRef", "list"] as const) {
			assert.throws(() => (double[member] as (...args: Array<unknown>) => unknown)(1, "x"), new RegExp(member));
		}
	});
});
