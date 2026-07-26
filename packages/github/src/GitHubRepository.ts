import { Context, Effect, Layer } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * Everything GitHub reports about a repository.
 *
 * @remarks
 * The **generated** response type, not a hand-written projection. One surveyed
 * consumer declared a sixteen-field interface for this endpoint and round-tripped
 * those fields back through `PATCH` — and every one of the sixteen already
 * existed, verbatim, in the OpenAPI types the package now leans on. Re-declaring
 * them would have been the same mistake with our name on it.
 *
 * @public
 */
export type RepositorySettings = Rest.Data<"GET /repos/{owner}/{repo}">;

/**
 * The fields `PATCH /repos/{owner}/{repo}` accepts, minus the coordinate.
 *
 * @public
 */
export type RepositoryPatch = Omit<Rest.Params<"PATCH /repos/{owner}/{repo}">, "owner" | "repo">;

/**
 * The repository itself.
 *
 * @public
 */
export interface GitHubRepositoryShape {
	/** The full, faithfully typed repository payload. */
	readonly settings: Effect.Effect<RepositorySettings, GitHubError, Repo>;
	/** Apply a settings patch and return what GitHub then reports. */
	readonly updateSettings: (patch: RepositoryPatch) => Effect.Effect<RepositorySettings, GitHubError, Repo>;
	/**
	 * The default branch's name.
	 *
	 * @remarks
	 * One surveyed consumer spent eight lines of hand-written octokit interface
	 * plus eleven lines of code to read this one string.
	 */
	readonly defaultBranch: Effect.Effect<string, GitHubError, Repo>;
	/**
	 * The repository's GraphQL node id.
	 *
	 * @remarks
	 * Needed as `repositoryId` by the `createLinkedBranch` and `createPullRequest`
	 * mutations, which is why a second consumer cast `repos.get` for it alone.
	 */
	readonly nodeId: Effect.Effect<string, GitHubError, Repo>;
}

/**
 * Repository settings and coordinates.
 *
 * @public
 */
export class GitHubRepository extends Context.Service<GitHubRepository, GitHubRepositoryShape>()(
	"@effected/github/GitHubRepository",
) {
	static readonly layer: Layer.Layer<GitHubRepository, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<GitHubRepositoryShape> = {}): GitHubRepositoryShape => ({
		settings: overrides.settings ?? Effect.sync(() => unstubbed("settings")),
		updateSettings: overrides.updateSettings ?? (() => unstubbed("updateSettings")),
		defaultBranch: overrides.defaultBranch ?? Effect.sync(() => unstubbed("defaultBranch")),
		nodeId: overrides.nodeId ?? Effect.sync(() => unstubbed("nodeId")),
	});

	/** {@link GitHubRepository.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitHubRepositoryShape> = {}): Layer.Layer<GitHubRepository> =>
		Layer.succeed(GitHubRepository, GitHubRepository.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`GitHubRepository.makeTest: ${member} was read but not stubbed — pass an override.`);
};

const make = (client: GitHubClient["Service"]): GitHubRepositoryShape => {
	const settings = Effect.fn("GitHubRepository.settings")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });
		return yield* client.request("GET /repos/{owner}/{repo}", { owner, repo });
	})();

	return {
		settings,
		updateSettings: Effect.fn("GitHubRepository.updateSettings")(function* (patch: RepositoryPatch) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, fields: Object.keys(patch).length });
			return yield* client.request("PATCH /repos/{owner}/{repo}", { ...patch, owner, repo });
		}),
		defaultBranch: Effect.map(settings, (repository) => repository.default_branch),
		nodeId: Effect.map(settings, (repository) => repository.node_id),
	};
};
