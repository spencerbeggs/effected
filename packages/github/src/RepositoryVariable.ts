import { Context, Effect, Layer } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";

/**
 * A variable, as listing returns it.
 *
 * @remarks
 * Unlike a secret this carries its **value**: variables are readable, so a
 * consumer comparing desired against live can detect an *edited* variable and
 * not merely a deleted one. Discarding the value in a projection here would
 * throw that away silently.
 *
 * @public
 */
export interface VariableInfo {
	readonly name: string;
	readonly value: string;
}

/**
 * Repository and environment variables.
 *
 * @public
 */
export interface RepositoryVariableShape {
	/**
	 * Create or update one repository variable.
	 *
	 * @remarks
	 * GitHub has **no upsert** for variables: creating uses `POST` on the
	 * collection and updating uses `PATCH` on the item, and each fails if used
	 * for the other case. So this reads the collection first and branches — one
	 * extra request per write, and the reason it is not optional.
	 */
	readonly set: (name: string, value: string) => Effect.Effect<void, GitHubError, Repo>;
	/** The repository's variables, with their values. */
	readonly list: () => Effect.Effect<ReadonlyArray<VariableInfo>, GitHubError, Repo>;
	/** Remove one repository variable. */
	readonly delete: (name: string) => Effect.Effect<void, GitHubError, Repo>;

	/** Create or update one environment variable, branching the same way. */
	readonly setForEnvironment: (
		environment: string,
		name: string,
		value: string,
	) => Effect.Effect<void, GitHubError, Repo>;
	/** One environment's variables, with their values. */
	readonly listForEnvironment: (environment: string) => Effect.Effect<ReadonlyArray<VariableInfo>, GitHubError, Repo>;
	/** Remove one environment variable. */
	readonly deleteForEnvironment: (environment: string, name: string) => Effect.Effect<void, GitHubError, Repo>;
}

/**
 * Repository and environment variables.
 *
 * @remarks
 * No encryption and no public key, unlike secrets — but also **no upsert**,
 * which is the asymmetry worth knowing: every write costs a read first, because
 * the create and update routes are different endpoints with different verbs and
 * neither tolerates the other's case.
 *
 * @public
 */
export class RepositoryVariable extends Context.Service<RepositoryVariable, RepositoryVariableShape>()(
	"@effected/github/RepositoryVariable",
) {
	/**
	 * @remarks
	 * `(client) => make(client)` rather than `make`: a static initializer runs
	 * while the module body is still evaluating, so naming a `const` declared
	 * further down throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<RepositoryVariable, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<RepositoryVariableShape> = {}): RepositoryVariableShape => ({
		set: overrides.set ?? (() => unstubbed("set")),
		list: overrides.list ?? (() => unstubbed("list")),
		delete: overrides.delete ?? (() => unstubbed("delete")),
		setForEnvironment: overrides.setForEnvironment ?? (() => unstubbed("setForEnvironment")),
		listForEnvironment: overrides.listForEnvironment ?? (() => unstubbed("listForEnvironment")),
		deleteForEnvironment: overrides.deleteForEnvironment ?? (() => unstubbed("deleteForEnvironment")),
	});

	/** {@link RepositoryVariable.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<RepositoryVariableShape> = {}): Layer.Layer<RepositoryVariable> =>
		Layer.succeed(RepositoryVariable, RepositoryVariable.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`RepositoryVariable.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const make = (client: GitHubClient["Service"]): RepositoryVariableShape => {
	const set = Effect.fn("RepositoryVariable.set")(function* (name: string, value: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, variable: name });

		const variables = yield* client.paginate("GET /repos/{owner}/{repo}/actions/variables", { owner, repo });

		if (variables.some((variable) => variable.name === name)) {
			yield* client.request("PATCH /repos/{owner}/{repo}/actions/variables/{name}", { owner, repo, name, value });
			return;
		}

		yield* client.request("POST /repos/{owner}/{repo}/actions/variables", { owner, repo, name, value });
	});

	const list = Effect.fn("RepositoryVariable.list")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });

		const variables = yield* client.paginate("GET /repos/{owner}/{repo}/actions/variables", { owner, repo });
		return variables.map((variable): VariableInfo => ({ name: variable.name, value: variable.value }));
	});

	const delete_ = Effect.fn("RepositoryVariable.delete")(function* (name: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, variable: name });

		yield* client.request("DELETE /repos/{owner}/{repo}/actions/variables/{name}", { owner, repo, name });
	});

	const setForEnvironment = Effect.fn("RepositoryVariable.setForEnvironment")(function* (
		environment: string,
		name: string,
		value: string,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, environment, variable: name });

		const variables = yield* client.paginate("GET /repos/{owner}/{repo}/environments/{environment_name}/variables", {
			owner,
			repo,
			environment_name: environment,
		});

		if (variables.some((variable) => variable.name === name)) {
			yield* client.request("PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}", {
				owner,
				repo,
				environment_name: environment,
				name,
				value,
			});
			return;
		}

		yield* client.request("POST /repos/{owner}/{repo}/environments/{environment_name}/variables", {
			owner,
			repo,
			environment_name: environment,
			name,
			value,
		});
	});

	const listForEnvironment = Effect.fn("RepositoryVariable.listForEnvironment")(function* (environment: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, environment });

		const variables = yield* client.paginate("GET /repos/{owner}/{repo}/environments/{environment_name}/variables", {
			owner,
			repo,
			environment_name: environment,
		});
		return variables.map((variable): VariableInfo => ({ name: variable.name, value: variable.value }));
	});

	const deleteForEnvironment = Effect.fn("RepositoryVariable.deleteForEnvironment")(function* (
		environment: string,
		name: string,
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, environment, variable: name });

		yield* client.request("DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}", {
			owner,
			repo,
			environment_name: environment,
			name,
		});
	});

	return { set, list, delete: delete_, setForEnvironment, listForEnvironment, deleteForEnvironment };
};
