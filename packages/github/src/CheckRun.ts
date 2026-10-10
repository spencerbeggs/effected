import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { numericId } from "./internal/ids.js";
import { Repo } from "./Repo.js";

/** How a check run finished. @public */
export const CheckConclusion = Schema.Literals([
	"success",
	"failure",
	"neutral",
	"cancelled",
	"timed_out",
	"action_required",
	"skipped",
]);

/** How serious an annotation is. @public */
export const AnnotationLevel = Schema.Literals(["notice", "warning", "failure"]);

/**
 * One annotation on a check run.
 *
 * @public
 */
export class Annotation extends Schema.Class<Annotation>("Annotation")({
	/** Repository-relative path. */
	path: Schema.String,
	/** First line of the range, 1-based. */
	startLine: Schema.Int,
	/** Last line of the range, 1-based. */
	endLine: Schema.Int,
	level: AnnotationLevel,
	message: Schema.String,
	title: Schema.optionalKey(Schema.String),
}) {}

/**
 * A check run's rendered output.
 *
 * @remarks
 * GitHub's limits are **byte** limits, and that distinction is the whole reason
 * this class exists rather than a struct: `✅`, `❌`, `🦋` and `│` cost several
 * bytes each, so a character-count check passes while the request comes back
 * 422 saying *"summary exceeds a maximum bytesize of 65535"*. Use
 * {@link CheckRunOutput.truncated} to cut an output to fit.
 *
 * @public
 */
export class CheckRunOutput extends Schema.Class<CheckRunOutput>("CheckRunOutput")({
	title: Schema.String,
	/** Markdown shown under the title. Capped at 65535 **bytes**. */
	summary: Schema.String,
	/** Longer markdown. Capped at 65535 **bytes**. */
	text: Schema.optionalKey(Schema.String),
	/** At most 50 per request; the rest are dropped by {@link CheckRunOutput.truncated}. */
	annotations: Schema.optionalKey(Schema.Array(Annotation)),
}) {
	/** GitHub's cap on `summary` and `text`, in UTF-8 bytes. */
	static readonly LIMIT_BYTES = 65_535;
	/** GitHub's cap on annotations per request. */
	static readonly MAX_ANNOTATIONS = 50;
	/** Appended when a field had to be cut. */
	static readonly NOTICE = "\n\n_…truncated (exceeded GitHub's 65535-byte check limit)._";

	/**
	 * This output, cut to fit GitHub's limits.
	 *
	 * @remarks
	 * Pure, so the byte arithmetic is testable with no client, no layer and no
	 * network — which is what lets a property test hammer it with arbitrary
	 * multi-byte input.
	 */
	truncated(): CheckRunOutput {
		const annotations = this.annotations;
		return CheckRunOutput.make({
			title: this.title,
			summary: capBytes(this.summary),
			...(this.text !== undefined ? { text: capBytes(this.text) } : {}),
			...(annotations !== undefined ? { annotations: annotations.slice(0, CheckRunOutput.MAX_ANNOTATIONS) } : {}),
		});
	}
}

/** UTF-8 encoder for the byte arithmetic; portable, unlike Node's `Buffer`. */
const utf8 = new TextEncoder();

/**
 * UTF-8 decoder for the cut. Non-fatal, so a code point split by the cut decodes
 * to U+FFFD for the trim loop to drop rather than throwing; `ignoreBOM` keeps a
 * leading BOM as content, as `Buffer` did.
 */
const utf8Lenient = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/**
 * Cut `value` to GitHub's byte budget without leaving a broken code point.
 *
 * @remarks
 * Slicing a UTF-8 buffer mid-character decodes to U+FFFD. Splitting a four-byte
 * code point can produce **more than one** replacement character, so the trim
 * loops rather than dropping a single one.
 *
 * `TextEncoder`/`TextDecoder` rather than `Buffer`, which is a Node global: a
 * Worker without `nodejs_compat` would throw a `ReferenceError` here.
 */
const capBytes = (value: string): string => {
	const bytes = utf8.encode(value);
	if (bytes.length <= CheckRunOutput.LIMIT_BYTES) return value;
	const budget = CheckRunOutput.LIMIT_BYTES - utf8.encode(CheckRunOutput.NOTICE).length;
	let cut = utf8Lenient.decode(bytes.subarray(0, budget));
	while (cut.endsWith("\uFFFD")) cut = cut.slice(0, -1);
	return `${cut}${CheckRunOutput.NOTICE}`;
};

/**
 * A check run as GitHub reports it.
 *
 * @public
 */
export class CheckRunRef extends Schema.Class<CheckRunRef>("CheckRunRef")({
	id: Schema.Int,
	name: Schema.String,
	/** The web URL. */
	url: Schema.String,
	status: Schema.String,
	/**
	 * The integrator's own id for the run (wire `external_id`), when it has
	 * one. GitHub reports a run created without one as `null` or `""`; both
	 * leave this absent.
	 */
	externalId: Schema.optionalKey(Schema.String),
}) {}

/**
 * Options for {@link CheckRunShape.create}.
 *
 * @public
 */
export interface CreateCheckRunOptions {
	/**
	 * The run's initial state. Defaults to `"in_progress"`, which also stamps
	 * `started_at`; a `"queued"` run has not started, so it carries none.
	 * Completing a run goes through {@link CheckRunShape.complete}.
	 */
	readonly status?: "queued" | "in_progress" | undefined;
	/**
	 * Your own id for the run (wire `external_id`), for
	 * {@link CheckRunShape.findByExternalId}. An empty string is treated as no
	 * id and not sent, since that lookup never matches `""`.
	 */
	readonly externalId?: string | undefined;
	/** Where the integrator's full details live (wire `details_url`). */
	readonly detailsUrl?: string | undefined;
}

/**
 * Options for {@link CheckRunShape.update}.
 *
 * @public
 */
export interface UpdateCheckRunOptions {
	/**
	 * Move the run to `"queued"` or `"in_progress"`; `"in_progress"` also
	 * stamps `started_at`, as {@link CheckRunShape.create} does. Completing it
	 * goes through {@link CheckRunShape.complete}, which also records the
	 * conclusion.
	 */
	readonly status?: "queued" | "in_progress" | undefined;
	/** Where the integrator's full details live (wire `details_url`). */
	readonly detailsUrl?: string | undefined;
}

/**
 * Options for {@link CheckRunShape.complete}.
 *
 * @public
 */
export interface CompleteCheckRunOptions {
	/**
	 * Where the integrator's full details live (wire `details_url`) — for
	 * instance the workflow run that produced the verdict. Omitted, the run
	 * keeps whatever details URL it already had.
	 */
	readonly detailsUrl?: string | undefined;
}

/**
 * Conclude the surrounding {@link CheckRunShape.withCheckRun} explicitly.
 *
 * @remarks
 * **Recording, not sending.** The call stores the verdict; the bracket's
 * finalizer writes it exactly once, on whichever path `use` leaves by. That is
 * what makes an explicit conclusion survive a later failure or an interrupt,
 * and what keeps the completion a single request no matter how many times this
 * is called. Calling it twice keeps the **last** verdict.
 *
 * Its error channel is `never` because the finalizer owns the reporting: a
 * caller that could observe a failed `complete` here would have to decide what
 * to do about it while already on the way out.
 *
 * Omit `output` to conclude without touching the run's rendered output —
 * whatever the last {@link CheckRunShape.update} wrote stays.
 *
 * @public
 */
export type ConcludeCheckRun = (
	conclusion: (typeof CheckConclusion.literals)[number],
	output?: CheckRunOutput,
) => Effect.Effect<void>;

/**
 * Create, update and conclude GitHub check runs on a commit, including a
 * bracket that always concludes the run.
 *
 * @remarks
 * Every member resolves the target repository from the `Repo` service in `R`.
 *
 * @public
 */
export interface CheckRunShape {
	/** Start a check run against a commit: in progress, unless `options.status` queues it. */
	readonly create: (
		name: string,
		headSha: string,
		options?: CreateCheckRunOptions,
	) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
	readonly get: (id: number) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
	/**
	 * Update an in-flight run: its output, its status, its details URL, or any
	 * combination.
	 *
	 * @remarks
	 * Omit `output` (pass `undefined`) to change only the status or details
	 * URL: no `output` key is sent, so the run keeps the output it has. That is
	 * how a queued run moves to `"in_progress"` without rewriting its output.
	 *
	 * `update(id)` with neither still sends **one** PATCH, carrying nothing but
	 * the run's coordinates. GitHub accepts it and changes nothing; it is not
	 * skipped, so every call is exactly one request and a caller's error
	 * handling sees a missing run or a revoked token the same way either way.
	 */
	readonly update: (
		id: number,
		output?: CheckRunOutput,
		options?: UpdateCheckRunOptions,
	) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * The newest run on `headSha` named `name` whose external id is
	 * `externalId`; none when there is no such run.
	 *
	 * @remarks
	 * Lists every run of the commit filtered by name on GitHub's side
	 * (`filter: "all"`, not GitHub's default of only the latest run per name),
	 * paging through all of them, then matches `external_id` here; "newest" is
	 * the highest id.
	 * An empty `externalId` is none without a request: GitHub reports a run
	 * created without an external id as `""`, so matching on it would find
	 * every such run.
	 */
	readonly findByExternalId: (
		headSha: string,
		name: string,
		externalId: string,
	) => Effect.Effect<Option.Option<CheckRunRef>, GitHubError, Repo>;
	/**
	 * Finish a run, stamping `completed_at` from `Clock`.
	 *
	 * @remarks
	 * Omit `output` (pass `undefined`) to conclude without touching the run's
	 * rendered output; a given output is cut to GitHub's byte limits first.
	 * `options.detailsUrl` points the finished run somewhere, such as the
	 * workflow run that produced it.
	 */
	readonly complete: (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
		options?: CompleteCheckRunOptions,
	) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * Run `use` inside a check run, concluding it however `use` exits.
	 *
	 * @remarks
	 * **Every exit reaches a terminal state.** Left to itself the bracket
	 * concludes `"success"` on success, `"failure"` on a typed failure or a
	 * defect, and `"cancelled"` on an interrupt. A run left `in_progress` is
	 * never reaped by GitHub and blocks branch protection until someone deletes
	 * it by hand, so the finalizer is exit-aware rather than a `tap`/`tapError`
	 * pair — which fires on the first two only.
	 *
	 * **`use` can override that verdict**, which is how the other four
	 * conclusions are reachable. `conclude` records one; a recorded verdict
	 * **wins on every exit path**, including failure and interruption, because
	 * how a check ran and how the surrounding program ended are different
	 * questions. A findings-derived `"neutral"` is the motivating case: the work
	 * ran fine and the result is advisory.
	 *
	 * Only the success path can fail the effect on the conclusion's behalf.
	 * Neither an interrupt nor an existing failure is replaced by whatever went
	 * wrong while reporting it.
	 *
	 * `use` keeps its own `R` and its own `A`, so the bracket composes with
	 * whatever services the wrapped work needs.
	 *
	 * @example
	 * ```ts
	 * import { CheckRun, CheckRunOutput } from "@effected/github";
	 * import { Effect } from "effect";
	 *
	 * const lintWithCheck = (sha: string) =>
	 *   Effect.gen(function* () {
	 *     const check = yield* CheckRun;
	 *     return yield* check.withCheckRun("lint", sha, (_id, conclude) =>
	 *       Effect.gen(function* () {
	 *         const findings = 3; // run the linter here
	 *         // An advisory result: record "neutral" instead of the default "success".
	 *         yield* conclude(
	 *           "neutral",
	 *           CheckRunOutput.make({ title: "lint", summary: `${findings} findings` }),
	 *         );
	 *         return findings;
	 *       }),
	 *     );
	 *   });
	 * ```
	 */
	readonly withCheckRun: <A, E, R>(
		name: string,
		headSha: string,
		use: (id: number, conclude: ConcludeCheckRun) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | GitHubError, R | Repo>;
}

/**
 * Create, update and conclude GitHub check runs, including the
 * {@link CheckRunShape.withCheckRun} bracket that always reaches a terminal state.
 *
 * @remarks
 * Provide it with {@link CheckRun.layer}, which needs a `GitHubClient`; each
 * method also needs a `Repo` in `R`.
 *
 * @public
 */
export class CheckRun extends Context.Service<CheckRun, CheckRunShape>()("@effected/github/CheckRun") {
	/** The live service, built over a `GitHubClient`. */
	static readonly layer: Layer.Layer<CheckRun, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<CheckRunShape> = {}): CheckRunShape => ({
		create: overrides.create ?? (() => unstubbed("create")),
		get: overrides.get ?? (() => unstubbed("get")),
		update: overrides.update ?? (() => unstubbed("update")),
		findByExternalId: overrides.findByExternalId ?? (() => unstubbed("findByExternalId")),
		complete: overrides.complete ?? (() => unstubbed("complete")),
		withCheckRun: overrides.withCheckRun ?? (() => unstubbed("withCheckRun")),
	});

	/** {@link CheckRun.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<CheckRunShape> = {}): Layer.Layer<CheckRun> =>
		Layer.succeed(CheckRun, CheckRun.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`CheckRun.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const wireOutput = (output: CheckRunOutput) => {
	const capped = output.truncated();
	return {
		title: capped.title,
		summary: capped.summary,
		...(capped.text !== undefined ? { text: capped.text } : {}),
		...(capped.annotations !== undefined
			? {
					annotations: capped.annotations.map((annotation) => ({
						path: annotation.path,
						start_line: annotation.startLine,
						end_line: annotation.endLine,
						annotation_level: annotation.level,
						message: annotation.message,
						...(annotation.title !== undefined ? { title: annotation.title } : {}),
					})),
				}
			: {}),
	};
};

/** A verdict `use` recorded through {@link ConcludeCheckRun}. */
interface RecordedConclusion {
	readonly conclusion: (typeof CheckConclusion.literals)[number];
	readonly output: CheckRunOutput | undefined;
}

/**
 * What the bracket concludes when `use` recorded nothing.
 *
 * @remarks
 * **Exit-aware, because a `tap`/`tapError` pair is not.** Those two fire on
 * success and on a *typed* failure; an interrupted `use` — a cancelled
 * workflow, a job timeout, a losing branch of a race — and a defect hit
 * neither, and the run stayed `in_progress` forever. GitHub never reaps such a
 * run, so it blocks branch protection until a human deletes it by hand.
 */
const defaultConclusion = <A, E>(name: string, exit: Exit.Exit<A, E>): RecordedConclusion => {
	if (Exit.isSuccess(exit)) {
		return {
			conclusion: "success",
			output: CheckRunOutput.make({ title: name, summary: "Completed successfully." }),
		};
	}
	const cancelled = Cause.hasInterruptsOnly(exit.cause);
	return {
		conclusion: cancelled ? "cancelled" : "failure",
		output: CheckRunOutput.make({
			title: name,
			summary: cancelled ? "Cancelled before completion." : "Failed.",
		}),
	};
};

/**
 * Conclude a bracketed run: the verdict `use` recorded, or the exit's default.
 *
 * @remarks
 * **`recorded` wins on every exit path**, including failure and interruption.
 * How the *check* ran and how the surrounding *program* ended are different
 * questions, and only `use` knows the first one — a findings-derived
 * `"neutral"` must not be overwritten by a `"cancelled"` just because the job
 * was torn down afterwards.
 *
 * `Effect.onExit` runs its finalizer **uninterruptibly**, which is what lets
 * the concluding request survive the interrupt that triggered it.
 *
 * Only the success path keeps the error channel: failing to record a success
 * is a real failure the caller should see. On the other paths the call is
 * ignored, because neither an interrupt nor an existing failure should be
 * replaced by whatever went wrong while reporting it — and that choice is the
 * **exit's**, independent of whose verdict is being written.
 */
const concludeFor = <A, E>(
	name: string,
	id: number,
	exit: Exit.Exit<A, E>,
	recorded: RecordedConclusion | undefined,
	complete: CheckRunShape["complete"],
): Effect.Effect<void, GitHubError, Repo> => {
	const settled = recorded ?? defaultConclusion(name, exit);
	const write = complete(id, settled.conclusion, settled.output);
	return Exit.isSuccess(exit) ? write : Effect.ignore(write);
};

const decodeRef = Schema.decodeUnknownEffect(CheckRunRef);

/**
 * Project a check-run response onto {@link CheckRunRef}, **decoding** it.
 *
 * @remarks
 * Decoded rather than built with `make`, which throws: a response missing a
 * field (a hand-written double, or GitHub changing shape) is input, and input
 * failures are a typed `decode` `GitHubError` naming the operation rather than
 * a defect.
 */
const refOf = (
	operation: string,
	raw: {
		id: number | bigint;
		name: string;
		html_url?: string | null;
		status: string;
		external_id?: string | null;
	},
): Effect.Effect<CheckRunRef, GitHubError> =>
	decodeRef({
		id: numericId(raw.id),
		name: raw.name,
		url: raw.html_url ?? "",
		status: raw.status,
		// null, absent and "" all mean the run has no external id.
		...(raw.external_id ? { externalId: raw.external_id } : {}),
	}).pipe(
		Effect.catchTag("SchemaError", (error) =>
			Effect.fail(GitHubError.decode(operation, "GitHub returned an unexpected check run", error)),
		),
	);

/** The current time as GitHub's ISO 8601 timestamp, from `Clock` so `TestClock` drives it. */
const isoNow = Effect.map(DateTime.now, DateTime.formatIso);

const make = (client: GitHubClient["Service"]): CheckRunShape => {
	const create = Effect.fn("CheckRun.create")(function* (
		name: string,
		headSha: string,
		options?: CreateCheckRunOptions,
	) {
		const { owner, repo } = yield* Repo;
		const status = options?.status ?? "in_progress";
		yield* Effect.annotateCurrentSpan({ owner, repo, name, headSha, status });
		const created = yield* client.request("POST /repos/{owner}/{repo}/check-runs", {
			owner,
			repo,
			name,
			head_sha: headSha,
			status,
			...(status === "in_progress" ? { started_at: yield* isoNow } : {}),
			// An empty id is no id: findByExternalId never matches "", so sending one
			// would create a run that lookup can never find.
			...(options?.externalId ? { external_id: options.externalId } : {}),
			...(options?.detailsUrl !== undefined ? { details_url: options.detailsUrl } : {}),
		});
		return yield* refOf("CheckRun.create", created);
	});

	const complete = Effect.fn("CheckRun.complete")(function* (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
		options?: CompleteCheckRunOptions,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, id, conclusion });
		yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
			owner,
			repo,
			check_run_id: id,
			status: "completed",
			conclusion,
			completed_at: yield* isoNow,
			...(output !== undefined ? { output: wireOutput(output) } : {}),
			...(options?.detailsUrl !== undefined ? { details_url: options.detailsUrl } : {}),
		});
	});

	return {
		create,
		complete,

		get: Effect.fn("CheckRun.get")(function* (id: number) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, id });
			const raw = yield* client.request("GET /repos/{owner}/{repo}/check-runs/{check_run_id}", {
				owner,
				repo,
				check_run_id: id,
			});
			return yield* refOf("CheckRun.get", raw);
		}),

		update: Effect.fn("CheckRun.update")(function* (
			id: number,
			output?: CheckRunOutput,
			options?: UpdateCheckRunOptions,
		) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, id });
			yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
				owner,
				repo,
				check_run_id: id,
				// Omitted, not sent: the run keeps the output it already has.
				...(output !== undefined ? { output: wireOutput(output) } : {}),
				...(options?.status !== undefined ? { status: options.status } : {}),
				...(options?.status === "in_progress" ? { started_at: yield* isoNow } : {}),
				...(options?.detailsUrl !== undefined ? { details_url: options.detailsUrl } : {}),
			});
		}),

		findByExternalId: Effect.fn("CheckRun.findByExternalId")(function* (
			headSha: string,
			name: string,
			externalId: string,
		) {
			if (externalId === "") return Option.none<CheckRunRef>();
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, headSha, name, externalId });
			const runs = yield* client.paginate("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
				owner,
				repo,
				ref: headSha,
				check_name: name,
				// The default, `latest`, returns only the newest run per name, which
				// hides an older run that carries the wanted external id.
				filter: "all",
			});
			let newest: (typeof runs)[number] | undefined;
			for (const run of runs) {
				if (run.external_id !== externalId) continue;
				if (newest === undefined || numericId(run.id) > numericId(newest.id)) newest = run;
			}
			return newest === undefined
				? Option.none<CheckRunRef>()
				: Option.some(yield* refOf("CheckRun.findByExternalId", newest));
		}),

		withCheckRun: <A, E, R>(
			name: string,
			headSha: string,
			use: (id: number, conclude: ConcludeCheckRun) => Effect.Effect<A, E, R>,
		) =>
			Effect.gen(function* () {
				const run = yield* create(name, headSha);
				const recorded = yield* Ref.make<RecordedConclusion | undefined>(undefined);
				const conclude: ConcludeCheckRun = (conclusion, output) => Ref.set(recorded, { conclusion, output });
				return yield* use(run.id, conclude).pipe(
					Effect.onExit((exit) =>
						Effect.flatMap(Ref.get(recorded), (chosen) => concludeFor(name, run.id, exit, chosen, complete)),
					),
				);
			}),
	};
};
