import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";

/**
 * Raised when the runner environment does not say what an action needs.
 *
 * @remarks
 * Two reasons, and the distinction is actionable: `missing` means the variable
 * is absent or empty (the workflow did not grant something, or the action is
 * running outside Actions); `malformed` means it is present but unusable (a
 * non-numeric run id, an unparseable event payload). The first is usually a
 * workflow fix, the second usually a bug report.
 *
 * @public
 */
export class ActionEnvironmentError extends Schema.TaggedErrorClass<ActionEnvironmentError>()(
	"ActionEnvironmentError",
	{
		reason: Schema.Literals(["missing", "malformed"]),
		/** The environment variable involved. */
		name: Schema.String,
		/** What was wrong, when the reason is `malformed`. */
		detail: Schema.optionalKey(Schema.String),
	},
) {
	override get message(): string {
		return this.reason === "missing"
			? `Required environment variable "${this.name}" is not set`
			: `Environment variable "${this.name}" is malformed${this.detail === undefined ? "" : `: ${this.detail}`}`;
	}
}

/**
 * The workflow's GitHub context, projected from the `GITHUB_*` variables.
 *
 * @public
 */
export class GitHubContext extends Schema.Class<GitHubContext>("GitHubContext")({
	/** `owner/repo`. */
	repository: Schema.String,
	repositoryOwner: Schema.String,
	/** The full ref, e.g. `refs/heads/main`. */
	ref: Schema.String,
	/** The short ref, e.g. `main`. */
	refName: Schema.String,
	/**
	 * The source branch of the pull request, when the event has one.
	 *
	 * @remarks
	 * `GITHUB_HEAD_REF` is only set for `pull_request` events — and on every
	 * other event the runner does not merely omit it, it may write the **empty
	 * string**, which a raw `process.env` read happily reports as present. That
	 * trap is encoded in the type: absent and `""` both decode to
	 * `Option.none()`, so a consumer cannot build a cache key segment out of an
	 * empty branch name by accident. For "the branch a human means", use
	 * {@link GitHubContext.branch}, which owns the fallback to `refName`.
	 *
	 * The encoded form is `string | null` rather than a serialized `Option`, so
	 * an encoded context stays plain JSON.
	 */
	headRef: Schema.OptionFromNullOr(Schema.String),
	sha: Schema.String,
	workflow: Schema.String,
	job: Schema.String,
	runId: Schema.Number,
	runAttempt: Schema.Number,
	eventName: Schema.String,
	actor: Schema.String,
	serverUrl: Schema.String,
	apiUrl: Schema.String,
	graphqlUrl: Schema.String,
	workspace: Schema.String,
}) {
	/**
	 * The branch a human means: `headRef` when present (a pull request, where
	 * `refName` is the useless `123/merge`), otherwise `refName`.
	 *
	 * @remarks
	 * This is the universal branch-scoped-cache-key fallback chain, written
	 * once. On a `push` or any other non-PR event `headRef` is `Option.none()`
	 * — including when the runner wrote it as the empty string — so the answer
	 * is the short ref. Note that on a tag push `refName` names the tag, not a
	 * branch; a consumer that must distinguish still has the full `ref`.
	 */
	get branch(): string {
		return Option.getOrElse(this.headRef, () => this.refName);
	}
}

/**
 * The runner's own context, projected from the `RUNNER_*` variables.
 *
 * @public
 */
export class RunnerContext extends Schema.Class<RunnerContext>("RunnerContext")({
	os: Schema.String,
	arch: Schema.String,
	name: Schema.String,
	/** A scratch directory emptied between jobs. */
	temp: Schema.String,
	/** Where `ToolInstaller` caches toolchains. */
	toolCache: Schema.String,
}) {}

/**
 * Environment overrides layered on top of the seeded snapshot.
 *
 * @remarks
 * A `Context.Reference` rather than a mutable global: overrides are
 * **fiber-local**, so two concurrent fibers can override the same variable
 * without seeing each other, and nothing needs restoring afterwards. This is
 * what makes {@link ActionEnvironmentShape.withEnv} parallel-safe — the
 * property the hand-rolled set/restore version it replaces could not have.
 *
 * @internal
 */
const EnvOverrides = Context.Reference<Readonly<Record<string, string>>>("@effected/github-actions/EnvOverrides", {
	defaultValue: () => ({}),
});

/**
 * The {@link ActionEnvironment} service shape.
 *
 * @public
 */
export interface ActionEnvironmentShape {
	/** A required variable. Absent or empty fails typed. */
	readonly get: (name: string) => Effect.Effect<string, ActionEnvironmentError>;
	/** An optional variable. Empty reads as absent, as the runner treats it. */
	readonly getOptional: (name: string) => Effect.Effect<Option.Option<string>>;
	/** The `GITHUB_*` context. */
	readonly github: Effect.Effect<GitHubContext, ActionEnvironmentError>;
	/** The `RUNNER_*` context. */
	readonly runner: Effect.Effect<RunnerContext, ActionEnvironmentError>;
	/** Whether the runner is in step-debug mode. */
	readonly isDebug: Effect.Effect<boolean>;
	/**
	 * The webhook event payload.
	 *
	 * @remarks
	 * `R` is `never`: the layer resolves `FileSystem` once at construction, so
	 * a caller never re-injects one to keep its own requirements clean.
	 */
	readonly payload: Effect.Effect<unknown, ActionEnvironmentError>;
	/**
	 * Run an effect with environment overrides applied.
	 *
	 * @remarks
	 * Fiber-local and parallel-safe — `process.env` is never mutated, so
	 * concurrent callers cannot corrupt each other and there is nothing to
	 * restore. Overrides **merge** with any enclosing `withEnv`.
	 *
	 * The trade, stated: a variable exported mid-run by
	 * `ActionOutputs.exportVariable` is not observed here, because the snapshot
	 * is taken once. That matches GitHub's own model, where `exportVariable`
	 * targets *subsequent* steps rather than the running one.
	 */
	readonly withEnv: <A, E, R>(
		overrides: Readonly<Record<string, string>>,
		effect: Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E, R>;
}

const numeric = (name: string, raw: string): Effect.Effect<number, ActionEnvironmentError> => {
	const parsed = Number(raw);
	return Number.isFinite(parsed)
		? Effect.succeed(parsed)
		: Effect.fail(new ActionEnvironmentError({ reason: "malformed", name, detail: `expected a number, got "${raw}"` }));
};

const make = (
	base: Readonly<Record<string, string>>,
): Effect.Effect<ActionEnvironmentShape, never, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const lookup = (name: string): Effect.Effect<Option.Option<string>> =>
			Effect.map(EnvOverrides, (overrides) => {
				const value = overrides[name] ?? base[name];
				// The runner sets absent inputs to the empty string; treating "" as
				// present would make every unset optional input look supplied.
				return value === undefined || value === "" ? Option.none() : Option.some(value);
			});

		const get = (name: string): Effect.Effect<string, ActionEnvironmentError> =>
			Effect.flatMap(lookup(name), (found) =>
				Option.isSome(found)
					? Effect.succeed(found.value)
					: Effect.fail(new ActionEnvironmentError({ reason: "missing", name })),
			);

		return {
			get,
			getOptional: lookup,
			isDebug: Effect.map(lookup("RUNNER_DEBUG"), (value) => Option.isSome(value) && value.value === "1"),

			github: Effect.gen(function* () {
				const [repository, repositoryOwner, ref, refName, sha, workflow, job] = yield* Effect.all([
					get("GITHUB_REPOSITORY"),
					get("GITHUB_REPOSITORY_OWNER"),
					get("GITHUB_REF"),
					get("GITHUB_REF_NAME"),
					get("GITHUB_SHA"),
					get("GITHUB_WORKFLOW"),
					get("GITHUB_JOB"),
				]);
				const runId = yield* Effect.flatMap(get("GITHUB_RUN_ID"), (raw) => numeric("GITHUB_RUN_ID", raw));
				const runAttempt = yield* Effect.flatMap(get("GITHUB_RUN_ATTEMPT"), (raw) =>
					numeric("GITHUB_RUN_ATTEMPT", raw),
				);
				// GITHUB_HEAD_REF is absent outside pull requests — and the runner may
				// write it as the empty string, which `lookup` already reads as absent.
				const headRef = yield* lookup("GITHUB_HEAD_REF");
				const [eventName, actor, serverUrl, apiUrl, graphqlUrl, workspace] = yield* Effect.all([
					get("GITHUB_EVENT_NAME"),
					get("GITHUB_ACTOR"),
					get("GITHUB_SERVER_URL"),
					get("GITHUB_API_URL"),
					get("GITHUB_GRAPHQL_URL"),
					get("GITHUB_WORKSPACE"),
				]);
				return GitHubContext.make({
					repository,
					repositoryOwner,
					ref,
					refName,
					headRef,
					sha,
					workflow,
					job,
					runId,
					runAttempt,
					eventName,
					actor,
					serverUrl,
					apiUrl,
					graphqlUrl,
					workspace,
				});
			}),

			runner: Effect.gen(function* () {
				const [os, arch, name, temp, toolCache] = yield* Effect.all([
					get("RUNNER_OS"),
					get("RUNNER_ARCH"),
					get("RUNNER_NAME"),
					get("RUNNER_TEMP"),
					get("RUNNER_TOOL_CACHE"),
				]);
				return RunnerContext.make({ os, arch, name, temp, toolCache });
			}),

			payload: Effect.gen(function* () {
				const path = yield* get("GITHUB_EVENT_PATH");
				const raw = yield* fs.readFileString(path).pipe(
					Effect.mapError(
						(cause) =>
							new ActionEnvironmentError({
								reason: "malformed",
								name: "GITHUB_EVENT_PATH",
								detail: `could not read "${path}": ${String(cause)}`,
							}),
					),
				);
				return yield* Effect.try({
					try: () => JSON.parse(raw) as unknown,
					catch: (cause) =>
						new ActionEnvironmentError({
							reason: "malformed",
							name: "GITHUB_EVENT_PATH",
							detail: `not valid JSON: ${String(cause)}`,
						}),
				});
			}),

			withEnv: (overrides, effect) =>
				Effect.flatMap(EnvOverrides, (current) =>
					Effect.provideService(effect, EnvOverrides, { ...current, ...overrides }),
				),
		} satisfies ActionEnvironmentShape;
	});

/** The `GITHUB_*` / `RUNNER_*` block a test double seeds so suites do not restate it. */
const TEST_DEFAULTS: Readonly<Record<string, string>> = {
	GITHUB_REPOSITORY: "acme/example",
	GITHUB_REPOSITORY_OWNER: "acme",
	GITHUB_REF: "refs/heads/main",
	GITHUB_REF_NAME: "main",
	GITHUB_SHA: "0000000000000000000000000000000000000000",
	GITHUB_WORKFLOW: "test",
	GITHUB_JOB: "test",
	GITHUB_RUN_ID: "1",
	GITHUB_RUN_ATTEMPT: "1",
	GITHUB_EVENT_NAME: "push",
	GITHUB_ACTOR: "tester",
	GITHUB_SERVER_URL: "https://github.com",
	GITHUB_API_URL: "https://api.github.com",
	GITHUB_GRAPHQL_URL: "https://api.github.com/graphql",
	GITHUB_WORKSPACE: "/workspace",
	RUNNER_OS: "Linux",
	RUNNER_ARCH: "X64",
	RUNNER_NAME: "test-runner",
	RUNNER_TEMP: "/tmp",
	RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
};

/**
 * The runner environment an action is executing inside.
 *
 * @remarks
 * The single reader of `process.env` in this package. Everything else — inputs,
 * outputs, state, the token bridge — goes through a service rather than
 * reaching for a global, which is what makes them all testable without
 * mutating the test process.
 *
 * @example
 * ```ts
 * import { ActionEnvironment } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const env = yield* ActionEnvironment;
 *   const { repository, runId } = yield* env.github;
 *   return `${repository}#${runId}`;
 * });
 * ```
 *
 * @public
 */
export class ActionEnvironment extends Context.Service<ActionEnvironment, ActionEnvironmentShape>()(
	"@effected/github-actions/ActionEnvironment",
) {
	/** Seeded from `process.env`, once, at layer construction. */
	static readonly layer: Layer.Layer<ActionEnvironment, never, FileSystem.FileSystem> = Layer.effect(
		this,
		Effect.flatMap(
			Effect.sync(() => ({ ...process.env }) as Readonly<Record<string, string>>),
			make,
		),
	);

	/**
	 * Seeded from an explicit record.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference — bind it to a `const` rather than calling it at each
	 * composition site.
	 */
	static readonly layerFrom = (
		env: Readonly<Record<string, string>>,
	): Layer.Layer<ActionEnvironment, never, FileSystem.FileSystem> => Layer.effect(ActionEnvironment, make(env));

	/**
	 * A test double seeded with a complete `GITHUB_*` / `RUNNER_*` block.
	 *
	 * @remarks
	 * **A recorded exception to the die-on-unstubbed rule.** Every other service
	 * in this package dies when a suite calls something it did not stub, because
	 * a plausible default hides a real gap. Here the opposite is true: the twelve
	 * context variables have one obviously-correct shape, and requiring each
	 * suite to restate them produced a byte-identical block duplicated six times
	 * across the consumers. Overrides merge on top.
	 */
	static readonly makeTest = (
		overrides: Readonly<Record<string, string>> = {},
	): Effect.Effect<ActionEnvironmentShape, never, FileSystem.FileSystem> => make({ ...TEST_DEFAULTS, ...overrides });

	/** {@link ActionEnvironment.makeTest} behind a layer, with `FileSystem` stubbed out. */
	static readonly layerTest = (overrides: Readonly<Record<string, string>> = {}): Layer.Layer<ActionEnvironment> =>
		Layer.effect(ActionEnvironment, ActionEnvironment.makeTest(overrides)).pipe(
			Layer.provide(FileSystem.layerNoop({})),
		);
}
