import { Clock, Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";
import { PageOptions } from "./Rest.js";

/**
 * Where a workflow run has got to.
 *
 * @public
 */
export class WorkflowRunStatus extends Schema.Class<WorkflowRunStatus>("WorkflowRunStatus")({
	id: Schema.Int,
	/** `queued`, `in_progress`, `completed`, … */
	status: Schema.String,
	/** Set once `status` is `completed`. */
	conclusion: Schema.optionalKey(Schema.String),
	url: Schema.String,
}) {
	/** Has the run finished, whatever the outcome? */
	get isDone(): boolean {
		return this.status === "completed";
	}
}

/**
 * How long to wait for a dispatched run.
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
 * Triggering workflows.
 *
 * @public
 */
export interface WorkflowDispatchShape {
	/** Fire a `workflow_dispatch` event. GitHub answers 204 with no run id. */
	readonly dispatch: (
		workflow: string,
		ref: string,
		inputs?: Record<string, string>,
	) => Effect.Effect<void, GitHubError, Repo>;
	readonly runStatus: (runId: number) => Effect.Effect<WorkflowRunStatus, GitHubError, Repo>;
	/**
	 * Dispatch, find the run it created, and wait for it to finish.
	 *
	 * @remarks
	 * The wait is `Effect.repeat` with a predicate over the **success** value.
	 * The version this replaces encoded "not finished yet" as a sentinel *error*
	 * baked into a user-visible error union — control flow in the error channel,
	 * which every consumer then had to know not to treat as a failure.
	 */
	readonly dispatchAndWait: (
		workflow: string,
		ref: string,
		options?: { readonly inputs?: Record<string, string> | undefined; readonly poll?: PollOptions | undefined },
	) => Effect.Effect<WorkflowRunStatus, GitHubError, Repo>;
}

/**
 * Workflow dispatch.
 *
 * @public
 */
export class WorkflowDispatch extends Context.Service<WorkflowDispatch, WorkflowDispatchShape>()(
	"@effected/github/WorkflowDispatch",
) {
	static readonly layer: Layer.Layer<WorkflowDispatch, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<WorkflowDispatchShape> = {}): WorkflowDispatchShape => ({
		dispatch: overrides.dispatch ?? (() => unstubbed("dispatch")),
		runStatus: overrides.runStatus ?? (() => unstubbed("runStatus")),
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
	id: number;
	status?: string | null;
	conclusion?: string | null;
	html_url: string;
}): WorkflowRunStatus =>
	WorkflowRunStatus.make({
		id: raw.id,
		status: raw.status ?? "unknown",
		...(raw.conclusion != null ? { conclusion: raw.conclusion } : {}),
		url: raw.html_url,
	});

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

	return {
		dispatch,
		runStatus,

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

			// GitHub answers a dispatch with 204 and no run id, so the run has to be
			// found by when it was created. `dispatchedAt` is read before the
			// dispatch so a run created in the same second is not missed.
			const dispatchedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
			yield* dispatch(workflow, ref, options?.inputs);

			const findRun = Effect.gen(function* () {
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
