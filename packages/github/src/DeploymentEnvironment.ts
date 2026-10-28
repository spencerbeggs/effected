import { Context, Effect, Layer } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { ENVIRONMENT_PUT_ROUTE_PARAMS, reservedBodyKey } from "./internal/requestOptions.js";
import { unstubbed } from "./internal/unstubbed.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * A deployment environment, as listing returns it.
 *
 * @public
 */
export interface DeploymentEnvironmentInfo {
	/** The environment's name. */
	readonly name: string;
}

/**
 * Create or update, list and delete a repository's deployment environments.
 *
 * @public
 */
export interface DeploymentEnvironmentShape {
	/**
	 * Create or update a deployment environment.
	 *
	 * @remarks
	 * The route is **idempotent** — a `PUT` on an existing environment updates it
	 * — so there is no list-then-branch here, unlike variables.
	 *
	 * `config` stays an open record because the protection-rule body is a moving
	 * target: wait timers, reviewers, deployment-branch policies and whatever
	 * GitHub adds next.
	 *
	 * It is sent as the request BODY and nothing else. octokit reads `baseUrl`,
	 * `url`, `method`, `headers`, `request` and `mediaType` off a call's flat
	 * parameters as the request itself, and a `data` key as the whole body, so a
	 * config spread beside the coordinates could send the authenticated `PUT` to
	 * another host with the token attached. A config naming one of those, the
	 * route's own `owner`, `repo` or `environment_name`, or `__proto__`, dies
	 * with a `RangeError` before any request is made.
	 */
	readonly upsert: (name: string, config?: Record<string, unknown>) => Effect.Effect<void, GitHubError, Repo>;

	/** The repository's deployment environments. */
	readonly list: () => Effect.Effect<ReadonlyArray<DeploymentEnvironmentInfo>, GitHubError, Repo>;

	/**
	 * Remove one deployment environment.
	 *
	 * @remarks
	 * **This deletes the environment's secrets and variables with it.** Anything
	 * sequencing a cleanup pass depends on that: removing an environment after
	 * its secrets is redundant, and removing it before them makes those deletions
	 * fail against a resource that no longer exists.
	 */
	readonly delete: (name: string) => Effect.Effect<void, GitHubError, Repo>;
}

/**
 * Create or update, list and delete a repository's deployment environments.
 *
 * @remarks
 * Provide it with {@link DeploymentEnvironment.layer}, which needs a
 * `GitHubClient`; each method also needs a `Repo` in `R`.
 *
 * @example
 * ```ts
 * import { DeploymentEnvironment } from "@effected/github";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const environments = yield* DeploymentEnvironment;
 *   yield* environments.upsert("production", { wait_timer: 10 });
 *   return yield* environments.list();
 * });
 * ```
 *
 * @public
 */
export class DeploymentEnvironment extends Context.Service<DeploymentEnvironment, DeploymentEnvironmentShape>()(
	"@effected/github/DeploymentEnvironment",
) {
	/**
	 * The live service, built over a `GitHubClient`.
	 *
	 * @remarks
	 * `(client) => make(client)` rather than `make`: a static initializer runs
	 * while the module body is still evaluating, so naming a `const` declared
	 * further down throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<DeploymentEnvironment, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; an unstubbed member dies when run, naming itself. */
	static readonly makeTest = (overrides: Partial<DeploymentEnvironmentShape> = {}): DeploymentEnvironmentShape => ({
		upsert: overrides.upsert ?? (() => dies("upsert")),
		list: overrides.list ?? (() => dies("list")),
		delete: overrides.delete ?? (() => dies("delete")),
	});

	/** {@link DeploymentEnvironment.makeTest} behind a `Layer`. */
	static readonly layerTest = (
		overrides: Partial<DeploymentEnvironmentShape> = {},
	): Layer.Layer<DeploymentEnvironment> =>
		Layer.succeed(DeploymentEnvironment, DeploymentEnvironment.makeTest(overrides));
}

const dies = unstubbed("DeploymentEnvironment.makeTest");

const make = (client: GitHubClient["Service"]): DeploymentEnvironmentShape => {
	const upsert = Effect.fn("DeploymentEnvironment.upsert")(function* (
		name: string,
		config: Record<string, unknown> = {},
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, environment: name });

		// A name octokit would read as a request option, or the route's own path
		// parameter, is never an environment setting. The body travels as `data`
		// below, so it could not reach the request anyway; refusing it as well is
		// defence in depth, and stops a config that names one from reporting
		// success while GitHub ignores the key.
		for (const key of Object.keys(config)) {
			const reason = reservedBodyKey(key, ENVIRONMENT_PUT_ROUTE_PARAMS, "an environment setting");
			if (reason !== undefined) {
				return yield* Effect.die(new RangeError(`DeploymentEnvironment.upsert: "${key}" ${reason}`));
			}
		}

		yield* client.request("PUT /repos/{owner}/{repo}/environments/{environment_name}", {
			owner,
			repo,
			environment_name: name,
			// `data` REPLACES octokit's body, so no key in the open config is read
			// as a request option (`baseUrl`, `headers`, `request`, ...) or as a path
			// parameter: the coordinates above stay authoritative by construction.
			// Copied, so a caller mutating its map afterwards cannot change what was
			// sent. An open record cannot be narrowed to the route's parameter
			// union, so the cast is on the parameters, never the route literal.
			data: { ...config },
		} as unknown as Rest.Params<"PUT /repos/{owner}/{repo}/environments/{environment_name}">);
	});

	const list = Effect.fn("DeploymentEnvironment.list")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });

		const environments = yield* client.paginate("GET /repos/{owner}/{repo}/environments", { owner, repo });
		// Paginated, so this is already an array — octokit's paginator normalises
		// the envelope, including the case where a repository with none answers
		// without the key at all.
		return environments.map((environment): DeploymentEnvironmentInfo => ({ name: environment.name }));
	});

	const delete_ = Effect.fn("DeploymentEnvironment.delete")(function* (name: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, environment: name });

		yield* client.request("DELETE /repos/{owner}/{repo}/environments/{environment_name}", {
			owner,
			repo,
			environment_name: name,
		});
	});

	return { upsert, list, delete: delete_ };
};
