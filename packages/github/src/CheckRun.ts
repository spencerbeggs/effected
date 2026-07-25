import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
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
 * 422 saying *"summary exceeds a maximum bytesize of 65535"*. One consumer hit
 * exactly that and wrote the truncation by hand.
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

/**
 * Cut `value` to GitHub's byte budget without leaving a broken code point.
 *
 * @remarks
 * Slicing a UTF-8 buffer mid-character decodes to U+FFFD. Splitting a four-byte
 * code point can produce **more than one** replacement character, so the trim
 * loops rather than dropping a single one — which is the hardening this needed
 * over the hand-written version it replaces.
 */
const capBytes = (value: string): string => {
	if (Buffer.byteLength(value, "utf8") <= CheckRunOutput.LIMIT_BYTES) return value;
	const budget = CheckRunOutput.LIMIT_BYTES - Buffer.byteLength(CheckRunOutput.NOTICE, "utf8");
	let cut = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
	while (cut.endsWith("�")) cut = cut.slice(0, -1);
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
}) {}

/**
 * Check runs.
 *
 * @public
 */
export interface CheckRunShape {
	/** Start an in-progress check run against a commit. */
	readonly create: (name: string, headSha: string) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
	readonly get: (id: number) => Effect.Effect<CheckRunRef, GitHubError, Repo>;
	/** Update an in-flight run's output. */
	readonly update: (id: number, output: CheckRunOutput) => Effect.Effect<void, GitHubError, Repo>;
	/** Finish a run. */
	readonly complete: (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
	) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * Run `use` inside a check run, completing it either way.
	 *
	 * @remarks
	 * `use` keeps its own `R`, unlike the version this replaces, whose callback
	 * was `R`-less and so forced consumers to build self-contained layers just to
	 * use the bracket.
	 */
	readonly withCheckRun: <A, E, R>(
		name: string,
		headSha: string,
		use: (id: number) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | GitHubError, R | Repo>;
}

/**
 * Check runs.
 *
 * @public
 */
export class CheckRun extends Context.Service<CheckRun, CheckRunShape>()("@effected/github/CheckRun") {
	static readonly layer: Layer.Layer<CheckRun, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<CheckRunShape> = {}): CheckRunShape => ({
		create: overrides.create ?? (() => unstubbed("create")),
		get: overrides.get ?? (() => unstubbed("get")),
		update: overrides.update ?? (() => unstubbed("update")),
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

const refOf = (raw: { id: number; name: string; html_url?: string | null; status: string }): CheckRunRef =>
	CheckRunRef.make({ id: raw.id, name: raw.name, url: raw.html_url ?? "", status: raw.status });

const make = (client: GitHubClient["Service"]): CheckRunShape => {
	const create = Effect.fn("CheckRun.create")(function* (name: string, headSha: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, name, headSha });
		const created = yield* client.request("POST /repos/{owner}/{repo}/check-runs", {
			owner,
			repo,
			name,
			head_sha: headSha,
			status: "in_progress",
			started_at: new Date().toISOString(),
		});
		return refOf(created);
	});

	const complete = Effect.fn("CheckRun.complete")(function* (
		id: number,
		conclusion: (typeof CheckConclusion.literals)[number],
		output?: CheckRunOutput,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, id, conclusion });
		yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
			owner,
			repo,
			check_run_id: id,
			status: "completed",
			conclusion,
			completed_at: new Date().toISOString(),
			...(output !== undefined ? { output: wireOutput(output) } : {}),
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
			return refOf(raw);
		}),

		update: Effect.fn("CheckRun.update")(function* (id: number, output: CheckRunOutput) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, id });
			yield* client.request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
				owner,
				repo,
				check_run_id: id,
				output: wireOutput(output),
			});
		}),

		withCheckRun: <A, E, R>(name: string, headSha: string, use: (id: number) => Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const run = yield* create(name, headSha);
				return yield* use(run.id).pipe(
					Effect.tap(() =>
						complete(run.id, "success", CheckRunOutput.make({ title: name, summary: "Completed successfully." })),
					),
					Effect.tapError(() =>
						Effect.ignore(complete(run.id, "failure", CheckRunOutput.make({ title: name, summary: "Failed." }))),
					),
				);
			}),
	};
};
