import { Clock, Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { numericId } from "./internal/ids.js";
import { Repo } from "./Repo.js";
import { PageOptions } from "./Rest.js";

/**
 * Where a workflow run has got to.
 *
 * @public
 */
export class WorkflowRunStatus extends Schema.Class<WorkflowRunStatus>("WorkflowRunStatus")({
	/** The run's numeric id. */
	id: Schema.Int,
	/** `queued`, `in_progress`, `completed`, … */
	status: Schema.String,
	/** Set once `status` is `completed`. */
	conclusion: Schema.optionalKey(Schema.String),
	/** The run's web URL. */
	url: Schema.String,
}) {
	/** Has the run finished, whatever the outcome? */
	get isDone(): boolean {
		return this.status === "completed";
	}
}

/**
 * The run a `workflow_dispatch` created, as GitHub reports it when asked.
 *
 * @remarks
 * Returned by {@link WorkflowDispatchShape.dispatchWithRun}. `runId` is usable
 * directly with {@link WorkflowDispatchShape.runStatus} and
 * {@link WorkflowDispatchShape.cancelRun}.
 *
 * @public
 */
export class DispatchedRun extends Schema.Class<DispatchedRun>("DispatchedRun")({
	/** The created run's numeric id. */
	runId: Schema.Int,
	/** The run's API URL. */
	runUrl: Schema.String,
	/** The run's web URL. */
	htmlUrl: Schema.String,
}) {}

/**
 * One workflow defined in the repository.
 *
 * @remarks
 * `state` is GitHub's own value — `active`, `disabled_manually`,
 * `disabled_inactivity`, and so on. It is reported rather than interpreted:
 * whether a *disabled* workflow counts for a given GitHub feature is that
 * feature's rule, not this package's. Callers that care filter on it
 * themselves.
 *
 * @public
 */
export interface WorkflowInfo {
	/** The workflow's numeric id, usable as `workflow_id` on other routes. */
	readonly id: number;
	/** The workflow's display name. */
	readonly name: string;
	/** Repository-relative path, e.g. `.github/workflows/ci.yml`. */
	readonly path: string;
	/** GitHub's state string; see the remarks above before branching on it. */
	readonly state: string;
}

/**
 * How often to poll for a dispatched run, and how long to keep polling.
 *
 * @public
 */
export interface PollOptions {
	/** How often to check. Defaults to ten seconds. */
	readonly interval?: Duration.Duration | undefined;
	/** How long to keep checking. Defaults to five minutes. */
	readonly timeout?: Duration.Duration | undefined;
}

const DEFAULT_INTERVAL = Duration.seconds(10);
const DEFAULT_TIMEOUT = Duration.minutes(5);

/**
 * Dispatch workflows, wait for the run they start, and list the repository's
 * workflows.
 *
 * @public
 */
export interface WorkflowDispatchShape {
	/**
	 * Fire a `workflow_dispatch` event and discard GitHub's answer; use
	 * {@link WorkflowDispatchShape.dispatchWithRun} when the run id is needed.
	 */
	readonly dispatch: (
		workflow: string,
		ref: string,
		inputs?: Record<string, string>,
	) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * Fire a `workflow_dispatch` event and report the run it created.
	 *
	 * @remarks
	 * Sends the same request as {@link WorkflowDispatchShape.dispatch} with
	 * `return_run_details: true`. GitHub then answers 200 with the run's id and
	 * URLs, which arrive as `Option.some` of a {@link DispatchedRun}; a 200 body
	 * that does not have that shape fails with a `decode` `GitHubError`.
	 *
	 * A 204 with no body is `Option.none()`. That is what a GitHub Enterprise
	 * Server predating the field answers — it ignores `return_run_details` and
	 * still dispatches — so it is **not a failure**: the workflow was dispatched,
	 * the server just did not say which run it created.
	 *
	 * Under `GitHubClient.layerFixture`, stub the 204 the way every other
	 * no-body route is stubbed: answer the dispatch route with `null`. `""`
	 * (what octokit itself hands back for an empty body) works too.
	 *
	 * Every failure of the request itself (a 404 for an unknown workflow, a 422
	 * for a workflow without a `workflow_dispatch` trigger, …) is the
	 * `GitHubError` the client classified, passed through unchanged.
	 */
	readonly dispatchWithRun: (
		workflow: string,
		ref: string,
		inputs?: Record<string, string>,
	) => Effect.Effect<Option.Option<DispatchedRun>, GitHubError, Repo>;
	/** Read one workflow run's status. */
	readonly runStatus: (runId: number) => Effect.Effect<WorkflowRunStatus, GitHubError, Repo>;
	/**
	 * Cancel a workflow run.
	 *
	 * @remarks
	 * `"cancelled"` when GitHub accepted the cancellation (202; the run stops
	 * shortly after, not necessarily before this returns). GitHub answers 409
	 * when the run has already finished, which is `"alreadyCompleted"` rather
	 * than a failure: the run is not running either way. Any other failure,
	 * such as a 404 for an unknown run, is a `GitHubError`.
	 */
	readonly cancelRun: (runId: number) => Effect.Effect<"cancelled" | "alreadyCompleted", GitHubError, Repo>;
	/**
	 * Every workflow defined in the repository.
	 *
	 * @remarks
	 * The question this answers is "does this repository have workflows at all",
	 * which nothing else in the package could ask: repository *languages* come
	 * from linguist and can never report `actions`, while GitHub validates that
	 * language against workflow **files**. A consumer offering CodeQL setup
	 * otherwise has to either request `actions` blindly and absorb a 422, or
	 * drop it for every repository including the ones where it is valid.
	 *
	 * An empty array is the honest answer for a repository with no workflows,
	 * not an error.
	 */
	readonly list: Effect.Effect<ReadonlyArray<WorkflowInfo>, GitHubError, Repo>;
	/**
	 * Dispatch, find the run it created, and wait for it to finish.
	 *
	 * @remarks
	 * The wait is `Effect.repeat` with a predicate over the **success** value, so
	 * "not finished yet" is never an error. If the run is not found finished
	 * within `poll.timeout`, it fails with a `rejected` `GitHubError` (status
	 * 408).
	 *
	 * The run is identified by {@link WorkflowDispatchShape.dispatchWithRun}:
	 * when GitHub reports the run it created, exactly that run is polled, so
	 * concurrent dispatches cannot be confused. When it does not (a 204 from a
	 * GitHub Enterprise Server predating `return_run_details`), the run is found
	 * instead by branch, creation time and workflow path — and on that fallback
	 * alone, concurrent dispatches of the same workflow on the same ref can be
	 * confused.
	 */
	readonly dispatchAndWait: (
		workflow: string,
		ref: string,
		options?: { readonly inputs?: Record<string, string> | undefined; readonly poll?: PollOptions | undefined },
	) => Effect.Effect<WorkflowRunStatus, GitHubError, Repo>;
}

/**
 * Dispatch workflows, wait for the run they start, and list the repository's
 * workflows.
 *
 * @remarks
 * Provide it with {@link WorkflowDispatch.layer}, which needs a `GitHubClient`;
 * each method also needs a `Repo` in `R`. `list` is an `Effect` value, not a
 * function.
 *
 * @example
 * ```ts
 * import { WorkflowDispatch } from "@effected/github";
 * import { Duration, Effect } from "effect";
 *
 * const release = Effect.gen(function* () {
 *   const workflows = yield* WorkflowDispatch;
 *   const run = yield* workflows.dispatchAndWait("release.yml", "main", {
 *     inputs: { dryRun: "false" },
 *     poll: { interval: Duration.seconds(15), timeout: Duration.minutes(20) },
 *   });
 *   return run.conclusion;
 * });
 * ```
 *
 * @public
 */
export class WorkflowDispatch extends Context.Service<WorkflowDispatch, WorkflowDispatchShape>()(
	"@effected/github/WorkflowDispatch",
) {
	/** The live service, built over a `GitHubClient`. */
	static readonly layer: Layer.Layer<WorkflowDispatch, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<WorkflowDispatchShape> = {}): WorkflowDispatchShape => ({
		dispatch: overrides.dispatch ?? (() => unstubbed("dispatch")),
		dispatchWithRun: overrides.dispatchWithRun ?? (() => unstubbed("dispatchWithRun")),
		runStatus: overrides.runStatus ?? (() => unstubbed("runStatus")),
		cancelRun: overrides.cancelRun ?? (() => unstubbed("cancelRun")),
		// A value member, so the stub has to defer: `unstubbed()` throws, and
		// throwing while BUILDING the double would fail every test that provides
		// it rather than the ones that actually read `list`.
		list: overrides.list ?? Effect.sync(() => unstubbed("list")),
		dispatchAndWait: overrides.dispatchAndWait ?? (() => unstubbed("dispatchAndWait")),
	});

	/** {@link WorkflowDispatch.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<WorkflowDispatchShape> = {}): Layer.Layer<WorkflowDispatch> =>
		Layer.succeed(WorkflowDispatch, WorkflowDispatch.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`WorkflowDispatch.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const statusOf = (raw: {
	id: number | bigint;
	status?: string | null;
	conclusion?: string | null;
	html_url: string;
}): WorkflowRunStatus =>
	WorkflowRunStatus.make({
		id: numericId(raw.id),
		status: raw.status ?? "unknown",
		...(raw.conclusion != null ? { conclusion: raw.conclusion } : {}),
		url: raw.html_url,
	});

/** GitHub's `workflow-dispatch-response`; the id is `number | bigint` in the generated types. */
const DispatchResponse = Schema.Struct({
	workflow_run_id: Schema.Union([Schema.Number, Schema.BigInt]),
	run_url: Schema.String,
	html_url: Schema.String,
});

const decodeDispatchResponse = Schema.decodeUnknownEffect(DispatchResponse);
const decodeDispatchedRun = Schema.decodeUnknownEffect(DispatchedRun);

const make = (client: GitHubClient["Service"]): WorkflowDispatchShape => {
	const dispatch = Effect.fn("WorkflowDispatch.dispatch")(function* (
		workflow: string,
		ref: string,
		inputs?: Record<string, string>,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, workflow, ref });
		yield* client.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
			owner,
			repo,
			workflow_id: workflow,
			ref,
			...(inputs !== undefined ? { inputs } : {}),
		});
	});

	const dispatchWithRun = Effect.fn("WorkflowDispatch.dispatchWithRun")(function* (
		workflow: string,
		ref: string,
		inputs?: Record<string, string>,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, workflow, ref });
		const data: unknown = yield* client.request(
			"POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
			{
				owner,
				repo,
				workflow_id: workflow,
				ref,
				...(inputs !== undefined ? { inputs } : {}),
				return_run_details: true,
			},
		);
		// The client hands back only `data`. octokit answers a 204 (or 205) by
		// returning before it reads the body, leaving `data` at its initial `""`;
		// any 2xx with a body is parsed. So `""` is exactly "no run details".
		// `null` is the fixture convention for a no-body route; a real 200 body
		// never parses to a bare `null`, so accepting it costs nothing.
		if (data === "" || data === null) return Option.none<DispatchedRun>();
		const run = yield* decodeDispatchResponse(data).pipe(
			Effect.flatMap((raw) =>
				decodeDispatchedRun({
					runId: numericId(raw.workflow_run_id),
					runUrl: raw.run_url,
					htmlUrl: raw.html_url,
				}),
			),
			Effect.catchTag("SchemaError", (error) =>
				Effect.fail(
					GitHubError.decode("WorkflowDispatch.dispatchWithRun", "GitHub returned unexpected run details", error),
				),
			),
		);
		return Option.some(run);
	});

	const runStatus = Effect.fn("WorkflowDispatch.runStatus")(function* (runId: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, runId });
		const raw = yield* client.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}", {
			owner,
			repo,
			run_id: runId,
		});
		return statusOf(raw);
	});

	const list = Effect.fn("WorkflowDispatch.list")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });
		// Paginated. A single `request` returns one page, so a repository with more
		// workflows than a page holds would silently report a subset — and the
		// symptom is a length that disagrees with GitHub's own total_count.
		const workflows = yield* client.paginate("GET /repos/{owner}/{repo}/actions/workflows", { owner, repo });
		return workflows.map(
			(workflow): WorkflowInfo => ({
				id: workflow.id,
				name: workflow.name,
				path: workflow.path,
				state: workflow.state,
			}),
		);
	});

	const cancelRun = Effect.fn("WorkflowDispatch.cancelRun")(function* (runId: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, runId });
		return yield* client
			.request("POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel", { owner, repo, run_id: runId })
			.pipe(
				Effect.as("cancelled" as const),
				// 409 is GitHub's answer for a run that already finished.
				Effect.catchIf(
					(error) => error.status === 409,
					() => Effect.succeed("alreadyCompleted" as const),
				),
			);
	});

	return {
		dispatch,
		dispatchWithRun,
		runStatus,
		cancelRun,
		list: list(),

		dispatchAndWait: Effect.fn("WorkflowDispatch.dispatchAndWait")(function* (
			workflow: string,
			ref: string,
			options?: { readonly inputs?: Record<string, string> | undefined; readonly poll?: PollOptions | undefined },
		) {
			const { owner, repo } = yield* Repo;
			const interval = options?.poll?.interval ?? DEFAULT_INTERVAL;
			const timeout = options?.poll?.timeout ?? DEFAULT_TIMEOUT;
			const attempts = Math.max(1, Math.ceil(Duration.toMillis(timeout) / Duration.toMillis(interval)));
			yield* Effect.annotateCurrentSpan({ owner, repo, workflow, ref, attempts });

			// `dispatchedAt` is read before the dispatch so that, on the 204 fallback
			// where the run has to be found by when it was created, a run created in
			// the same second is not missed.
			const dispatchedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
			const dispatched = yield* dispatchWithRun(workflow, ref, options?.inputs);

			const findRun: Effect.Effect<Option.Option<WorkflowRunStatus>, GitHubError, Repo> = Option.isSome(dispatched)
				? // GitHub named the run: poll exactly it, so a concurrent dispatch of the
					// same workflow on the same ref cannot be mistaken for it.
					Effect.map(runStatus(dispatched.value.runId), Option.some)
				: // No run details (an older GitHub Enterprise Server): find the run by
					// creation time, branch and workflow path.
					Effect.gen(function* () {
						const runs = yield* client.paginate(
							"GET /repos/{owner}/{repo}/actions/runs",
							{ owner, repo, created: `>=${dispatchedAt}`, branch: ref },
							PageOptions.make({ perPage: 10, maxPages: 1 }),
						);
						const match = runs.find((run) => run.path?.endsWith(workflow) ?? true);
						return match === undefined ? Option.none<WorkflowRunStatus>() : Option.some(statusOf(match));
					});

			const settled = yield* Effect.repeat(findRun, {
				// Repeat WHILE the answer is "not yet" — a predicate over the success
				// value, so "pending" never has to masquerade as an error.
				while: (found) => Option.isNone(found) || !found.value.isDone,
				schedule: Schedule.spaced(interval),
				times: attempts,
			});

			if (Option.isNone(settled) || !settled.value.isDone) {
				return yield* Effect.fail(
					GitHubError.rejected(
						"WorkflowDispatch.dispatchAndWait",
						408,
						`workflow ${workflow} did not finish within ${Duration.format(timeout)}`,
					),
				);
			}
			return settled.value;
		}),
	};
};
