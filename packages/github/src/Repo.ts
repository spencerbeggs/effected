import { Config, Context, Effect, Layer, Result, Schema } from "effect";

/**
 * A repository slug was not `owner/repo`.
 *
 * @public
 */
export class InvalidRepoRefError extends Schema.TaggedErrorClass<InvalidRepoRefError>()("InvalidRepoRefError", {
	/** What was handed in. */
	input: Schema.String,
}) {
	override get message(): string {
		return `not an owner/repo slug: ${JSON.stringify(this.input)}`;
	}
}

/**
 * Which repository an operation acts on.
 *
 * @public
 */
export class RepoRef extends Schema.Class<RepoRef>("RepoRef")({
	/** The user or organization. */
	owner: Schema.NonEmptyString,
	/** The repository name, without the owner. */
	repo: Schema.NonEmptyString,
}) {
	/**
	 * Parse `"owner/repo"`, synchronously.
	 *
	 * @remarks
	 * The sync `Result` primitive; {@link RepoRef.parse} is the `Effect` form over
	 * it. `make` is reserved by the class factory for the validated field
	 * constructor, which is why string parsing is named rather than overloaded.
	 */
	static parseResult(slug: string): Result.Result<RepoRef, InvalidRepoRefError> {
		const parts = slug.split("/");
		const [owner, repo] = parts;
		if (parts.length !== 2 || owner === undefined || repo === undefined || owner === "" || repo === "") {
			return Result.fail(new InvalidRepoRefError({ input: slug }));
		}
		return Result.succeed(RepoRef.make({ owner, repo }));
	}

	/** Parse `"owner/repo"`. */
	static readonly parse = Effect.fn("RepoRef.parse")((slug: string) => Effect.fromResult(RepoRef.parseResult(slug)));

	/** `"owner/repo"`. */
	get slug(): string {
		return `${this.owner}/${this.repo}`;
	}
}

/**
 * The repository the surrounding program acts on.
 *
 * @remarks
 * Every resource service takes this in its `R` and **no method takes an
 * `{ owner, repo }` argument**, which is what makes a read like
 * `GitHubRepository.defaultBranch` a single expression instead of a preamble.
 *
 * The package this replaces read `process.env.GITHUB_REPOSITORY` in three
 * places — inside the client, inside the App layer, and transitively in every
 * caller of `client.repo` — which is most of what coupled a GitHub API client to
 * the GitHub Actions runtime. Here the coordinate is a value, the env-driven way
 * to get one is a layer variant **named for being env-driven**, and a program
 * that acts on several repositories uses {@link Repo.provide}:
 *
 * @example
 * ```ts
 * import { Repo } from "@effected/github";
 * import { Effect } from "effect";
 *
 * declare const syncOne: Effect.Effect<void, never, Repo>;
 * declare const targets: ReadonlyArray<Repo["Service"]>;
 *
 * const syncAll = Effect.forEach(targets, (target) => syncOne.pipe(Repo.provide(target)), {
 *   concurrency: 4,
 * });
 * ```
 *
 * **A deliberate exception to "no non-effectful members on a service shape."**
 * This shape is entirely one immutable value: there is nothing to leave
 * unimplemented, so `Layer.mock` has nothing to degrade and `Layer.succeed` is
 * the correct double. The rule exists to stop a sync member from quietly
 * degrading a *mixed* shape's partial mock. The boundary to hold: the moment a
 * method appears here, this is a service again and the rule applies.
 *
 * @public
 */
export class Repo extends Context.Service<Repo, RepoRef>()("@effected/github/Repo") {
	/** The repository, as a value you already have. */
	static readonly layer = (ref: RepoRef): Layer.Layer<Repo> => Layer.succeed(Repo, ref);

	/** The repository, from an `"owner/repo"` slug. */
	static readonly layerFromSlug = (slug: string): Layer.Layer<Repo, InvalidRepoRefError> =>
		Layer.effect(Repo, RepoRef.parse(slug));

	/**
	 * The repository from configuration, `GITHUB_REPOSITORY` by default.
	 *
	 * @remarks
	 * The one env-driven variant, read through the ambient `ConfigProvider` rather
	 * than `process.env` — so a test provides a provider instead of mutating the
	 * environment, and a consumer outside Actions can source it however it likes.
	 */
	static readonly layerFromConfig = (
		options: { readonly name?: string | undefined } = {},
	): Layer.Layer<Repo, Config.ConfigError | InvalidRepoRefError> =>
		Layer.effect(
			Repo,
			Effect.flatMap(Config.string(options.name ?? "GITHUB_REPOSITORY"), (slug) => RepoRef.parse(slug)),
		);

	/** Run `effect` against a different repository. */
	static readonly provide =
		(ref: RepoRef) =>
		<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Repo>> =>
			Effect.provideService(effect, Repo, ref);
}
