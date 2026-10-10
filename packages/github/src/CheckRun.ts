import { Cause, Context, DateTime, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { numericId } from "./internal/ids.js";
import { Repo } from "./Repo.js";
import type { PageOptions } from "./Rest.js";

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

/**
 * The phase of its lifecycle a check run is in, as GitHub reports it.
 *
 * @remarks
 * `"waiting"`, `"requested"` and `"pending"` are reserved for GitHub Actions
 * runs; an integrator can only write `"queued"`, `"in_progress"` and, through
 * {@link CheckRunShape.complete}, `"completed"`.
 *
 * @public
 */
export const CheckRunStatus = Schema.Literals([
	"queued",
	"in_progress",
	"completed",
	"waiting",
	"requested",
	"pending",
]);

/**
 * How a check run finished, as GitHub reports it: every
 * {@link CheckConclusion} plus `"stale"`.
 *
 * @remarks
 * GitHub's check-run response schema omits `"stale"`, but its update
 * endpoint documents it: *"You cannot change a check run conclusion to
 * `stale`, only GitHub can set this."* GitHub sets it on a run left
 * incomplete too long, so a read that refused it would fail on any commit
 * carrying one. It is read-only, which is why {@link CheckConclusion}, the
 * write set, does not include it.
 *
 * @public
 */
export const ReportedCheckConclusion = Schema.Literals([
	"success",
	"failure",
	"neutral",
	"cancelled",
	"timed_out",
	"action_required",
	"skipped",
	"stale",
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
 * The rendered output a check run reports: its title and summary, and how
 * many annotations it carries.
 *
 * @remarks
 * The read-side counterpart of {@link CheckRunOutput}. It leaves out the
 * long-form `text` deliberately: it can run to 65535 bytes, and a caller
 * listing a commit's runs rarely wants it. Read the run's full output through
 * the typed request surface when you do.
 *
 * @public
 */
export class ReportedCheckRunOutput extends Schema.Class<ReportedCheckRunOutput>("ReportedCheckRunOutput")({
	/** The output's title; `null` when the run has none. */
	title: Schema.NullOr(Schema.String),
	/** The output's markdown summary; `null` when the run has none. */
	summary: Schema.NullOr(Schema.String),
	/** How many annotations the run carries (wire `annotations_count`). */
	annotationsCount: Schema.Int,
}) {}

/**
 * A check run as GitHub reports it.
 *
 * @remarks
 * Every field beyond the original five (the four required ones and
 * `externalId`) is optional, so a test double built with
 * `CheckRunRef.make({ id, name, url, status })` stays valid; a run decoded
 * from a GitHub response carries all of them, because GitHub always sends
 * them. A nullable field is `null` when GitHub reported `null`.
 *
 * **Three URLs, named apart.** `url` is the **web** URL (wire `html_url`, or
 * `""` when GitHub reported none), kept under that name so existing callers
 * read what they always read. `htmlUrl` is the same wire field with its
 * `null` preserved, `apiUrl` is the REST URL (wire `url`), and `detailsUrl`
 * is the integrator's own link (wire `details_url`).
 *
 * @public
 */
export class CheckRunRef extends Schema.Class<CheckRunRef>("CheckRunRef")({
	id: Schema.Int,
	name: Schema.String,
	/** The web URL (wire `html_url`), or `""` when GitHub reported none. See also `htmlUrl`. */
	url: Schema.String,
	/** The run's lifecycle phase. */
	status: CheckRunStatus,
	/**
	 * The integrator's own id for the run (wire `external_id`), when it has
	 * one. GitHub reports a run created without one as `null` or `""`; both
	 * leave this absent.
	 */
	externalId: Schema.optionalKey(Schema.String),
	/** The commit the run checks (wire `head_sha`). */
	headSha: Schema.optionalKey(Schema.String),
	/** The run's GraphQL node id (wire `node_id`). */
	nodeId: Schema.optionalKey(Schema.String),
	/** How the run finished; `null` until it completes. */
	conclusion: Schema.optionalKey(Schema.NullOr(ReportedCheckConclusion)),
	/** When the run started, as GitHub's ISO 8601 string; `null` for a run that has not. */
	startedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** When the run completed, as GitHub's ISO 8601 string; `null` for a run that has not. */
	completedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** The integrator's link for the run (wire `details_url`). */
	detailsUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** The web URL (wire `html_url`), `null` preserved. */
	htmlUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** The run's REST API URL (wire `url`). */
	apiUrl: Schema.optionalKey(Schema.String),
	/** The check suite the run belongs to (wire `check_suite.id`); `null` when GitHub reported none. */
	checkSuiteId: Schema.optionalKey(Schema.NullOr(Schema.Int)),
	/** The run's title, summary and annotation count. */
	output: Schema.optionalKey(ReportedCheckRunOutput),
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
 * Options for {@link CheckRunShape.list}.
 *
 * @public
 */
export interface ListCheckRunsOptions {
	/** Only runs with this name (wire `check_name`). */
	readonly checkName?: string | undefined;
	/** Only runs created by this GitHub App (wire `app_id`). */
	readonly appId?: number | undefined;
	/**
	 * Only runs in this phase. GitHub filters on these three only; the
	 * Actions-reserved phases are not a filter it accepts.
	 */
	readonly status?: "queued" | "in_progress" | "completed" | undefined;
	/**
	 * `"latest"` (GitHub's default) answers only the newest run per name;
	 * `"all"` answers every run, re-runs included.
	 */
	readonly filter?: "latest" | "all" | undefined;
	/** How far to page. Unset, every page is read, 100 runs at a time. */
	readonly page?: PageOptions | undefined;
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
	 * {@link CheckRunShape.update}, answering the run as GitHub reports it
	 * after the PATCH.
	 *
	 * @remarks
	 * The same single request, with the same omission rules; the difference is
	 * only that GitHub's response is decoded into a {@link CheckRunRef} rather
	 * than discarded. A separate member rather than a new return type on
	 * `update`, so a test double that stubs `update` with `Effect.void` keeps
	 * compiling.
	 */
	readonly updateRef: (
		id: number,
		output?: CheckRunOutput,
		options?: UpdateCheckRunOptions,
	) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
	/**
	 * The check runs on a commit, newest per name unless `options.filter` is
	 * `"all"`.
	 *
	 * @remarks
	 * `ref` is a commit SHA, a branch name or a tag name. Every page is read
	 * unless `options.page` bounds the walk, so a filter that matches past
	 * page one is still answered in full.
	 */
	readonly list: (
		ref: string,
		options?: ListCheckRunsOptions,
	) => Effect.Effect<ReadonlyArray<CheckRunRef>, GitHubError, Repo>;
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
	 * {@link CheckRunShape.complete}, answering the finished run as GitHub
	 * reports it after the PATCH.
	 *
	 * @remarks
	 * The same single request, with the same `completed_at` stamp and output
	 * byte cap; GitHub's response is decoded into a {@link CheckRunRef} rather
	 * than discarded. A separate member for the same reason as
	 * {@link CheckRunShape.updateRef}.
	 */
	readonly completeRef: (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
		options?: CompleteCheckRunOptions,
	) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
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
		updateRef: overrides.updateRef ?? (() => unstubbed("updateRef")),
		list: overrides.list ?? (() => unstubbed("list")),
		findByExternalId: overrides.findByExternalId ?? (() => unstubbed("findByExternalId")),
		complete: overrides.complete ?? (() => unstubbed("complete")),
		completeRef: overrides.completeRef ?? (() => unstubbed("completeRef")),
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
 * The fields of GitHub's check-run payload this package projects.
 *
 * @remarks
 * Structural rather than octokit's generated type, so every route that
 * answers a run (create, get, PATCH, and an item of the commit listing)
 * satisfies it without a cast. Fields are optional here because a
 * hand-written fixture may omit them; whatever is present is decoded.
 */
interface RawCheckRun {
	readonly id: number | bigint;
	readonly name: string;
	readonly status: string;
	readonly html_url?: string | null;
	readonly external_id?: string | null;
	readonly head_sha?: string;
	readonly node_id?: string;
	readonly url?: string;
	readonly details_url?: string | null;
	readonly conclusion?: string | null;
	readonly started_at?: string | null;
	readonly completed_at?: string | null;
	readonly check_suite?: { readonly id: number | bigint } | null;
	readonly output?: {
		readonly title?: string | null;
		readonly summary?: string | null;
		readonly annotations_count?: number;
	} | null;
}

/** Whether a wire value is an object whose fields can be read. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * A nested wire object's fields, renamed for the schema, or the value itself
 * when it is not an object.
 *
 * @remarks
 * Handing the raw value through is what keeps a malformed response typed: a
 * `null` `output` (which GitHub's schema forbids) reaches the decoder and fails
 * as `decode` instead of throwing a `TypeError` while its fields are read,
 * which would be a defect escaping every `GitHubError` handler.
 */
const nested = (value: unknown, project: (record: Record<string, unknown>) => unknown): unknown =>
	isRecord(value) ? project(value) : value;

/**
 * Project a check-run response onto {@link CheckRunRef}, **decoding** it.
 *
 * @remarks
 * Decoded rather than built with `make`, which throws: a response missing a
 * field (a hand-written double, or GitHub changing shape) is input, and input
 * failures are a typed `decode` `GitHubError` naming the operation rather than
 * a defect. That includes a status or conclusion outside the literal sets:
 * GitHub adding one fails the read loudly instead of passing an unknown
 * string to a caller's exhaustive switch.
 */
const refOf = (operation: string, raw: RawCheckRun): Effect.Effect<CheckRunRef, GitHubError> =>
	// A run that is not an object (a `null` list item, say) goes to the decoder
	// as it is, so it fails typed rather than throwing while `id` is read.
	decodeRef(
		!isRecord(raw as unknown)
			? raw
			: {
					id: numericId(raw.id),
					name: raw.name,
					url: raw.html_url ?? "",
					status: raw.status,
					// null, absent and "" all mean the run has no external id.
					...(raw.external_id ? { externalId: raw.external_id } : {}),
					...(raw.head_sha !== undefined ? { headSha: raw.head_sha } : {}),
					...(raw.node_id !== undefined ? { nodeId: raw.node_id } : {}),
					...(raw.conclusion !== undefined ? { conclusion: raw.conclusion } : {}),
					...(raw.started_at !== undefined ? { startedAt: raw.started_at } : {}),
					...(raw.completed_at !== undefined ? { completedAt: raw.completed_at } : {}),
					...(raw.details_url !== undefined ? { detailsUrl: raw.details_url } : {}),
					...(raw.html_url !== undefined ? { htmlUrl: raw.html_url } : {}),
					...(raw.url !== undefined ? { apiUrl: raw.url } : {}),
					...(raw.check_suite !== undefined
						? {
								checkSuiteId: nested(raw.check_suite, (suite) =>
									typeof suite.id === "number" || typeof suite.id === "bigint" ? numericId(suite.id) : suite.id,
								),
							}
						: {}),
					...(raw.output !== undefined
						? {
								output: nested(raw.output, (output) => ({
									title: output.title,
									summary: output.summary,
									annotationsCount: output.annotations_count,
								})),
							}
						: {}),
				},
	).pipe(
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

	/**
	 * The completing PATCH, answering GitHub's raw response.
	 *
	 * @remarks
	 * Shared by `complete`, which discards the response, and `completeRef`,
	 * which decodes it. Only the second can fail on an unexpected response:
	 * `complete` runs inside the bracket's finalizer, and a run GitHub has
	 * already concluded must not fail the program over a field it did not ask
	 * to read.
	 */
	const completePatch = (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output: CheckRunOutput | undefined,
		options: CompleteCheckRunOptions | undefined,
	) =>
		Effect.gen(function* () {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, id, conclusion });
			return yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
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

	const complete = Effect.fn("CheckRun.complete")(function* (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
		options?: CompleteCheckRunOptions,
	) {
		yield* completePatch(id, conclusion, output, options);
	});

	const completeRef = Effect.fn("CheckRun.completeRef")(function* (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
		options?: CompleteCheckRunOptions,
	) {
		return yield* refOf("CheckRun.completeRef", yield* completePatch(id, conclusion, output, options));
	});

	/** The updating PATCH, answering GitHub's raw response; see `completePatch` for why it is shared. */
	const updatePatch = (id: number, output: CheckRunOutput | undefined, options: UpdateCheckRunOptions | undefined) =>
		Effect.gen(function* () {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, id });
			return yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
				owner,
				repo,
				check_run_id: id,
				// Omitted, not sent: the run keeps the output it already has.
				...(output !== undefined ? { output: wireOutput(output) } : {}),
				...(options?.status !== undefined ? { status: options.status } : {}),
				...(options?.status === "in_progress" ? { started_at: yield* isoNow } : {}),
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
			yield* updatePatch(id, output, options);
		}),

		updateRef: Effect.fn("CheckRun.updateRef")(function* (
			id: number,
			output?: CheckRunOutput,
			options?: UpdateCheckRunOptions,
		) {
			return yield* refOf("CheckRun.updateRef", yield* updatePatch(id, output, options));
		}),

		completeRef,

		list: Effect.fn("CheckRun.list")(function* (ref: string, options?: ListCheckRunsOptions) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, ref });
			const runs = yield* client.paginate(
				"GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
				{
					owner,
					repo,
					ref,
					...(options?.checkName !== undefined ? { check_name: options.checkName } : {}),
					...(options?.appId !== undefined ? { app_id: options.appId } : {}),
					...(options?.status !== undefined ? { status: options.status } : {}),
					...(options?.filter !== undefined ? { filter: options.filter } : {}),
				},
				options?.page,
			);
			return yield* Effect.forEach(runs, (run) => refOf("CheckRun.list", run));
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
