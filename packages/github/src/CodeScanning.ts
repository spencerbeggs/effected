import { Context, Effect, Layer } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * A CodeQL default-setup configuration.
 *
 * @remarks
 * Every field is optional and an **omitted field means "leave it alone"**, which
 * is why this is a partial rather than a full configuration: sending
 * `undefined` for a key the caller never mentioned would clear a setting they
 * did not ask to change.
 *
 * @public
 */
export interface CodeScanningSetup {
	/** Whether default setup is `configured` or `not-configured`. */
	readonly state?: "configured" | "not-configured" | undefined;
	/** The CodeQL languages to analyse. */
	readonly languages?: ReadonlyArray<string> | undefined;
	/** `default` or `extended`. */
	readonly query_suite?: string | undefined;
	/** `remote` or `remote_and_local`. */
	readonly threat_model?: string | undefined;
	/** `standard` or `labeled`. */
	readonly runner_type?: string | undefined;
	/** The runner label, when `runner_type` is `labeled`. */
	readonly runner_label?: string | undefined;
}

/**
 * CodeQL default setup, and the language detection that gates it.
 *
 * @public
 */
export interface CodeScanningShape {
	/**
	 * Apply a default-setup configuration.
	 *
	 * @remarks
	 * The endpoint answers **202 Accepted** and configures asynchronously.
	 * Nothing here polls: a successful call means GitHub accepted the request,
	 * not that scanning is running.
	 */
	readonly configure: (setup: CodeScanningSetup) => Effect.Effect<void, GitHubError, Repo>;
	/**
	 * The languages GitHub detects in the repository.
	 *
	 * @remarks
	 * The response maps language name to bytes; only the names are returned, in
	 * GitHub's own order (most bytes first). Use it to filter a configured
	 * language list down to what the repository actually contains — GitHub
	 * rejects a default-setup call naming a language it does not detect.
	 */
	readonly languages: () => Effect.Effect<ReadonlyArray<string>, GitHubError, Repo>;
}

/**
 * CodeQL default setup.
 *
 * @public
 */
export class CodeScanning extends Context.Service<CodeScanning, CodeScanningShape>()("@effected/github/CodeScanning") {
	/**
	 * @remarks
	 * The callback is written `(client) => make(client)` rather than passed as
	 * `make` directly, and that is load-bearing: a static initializer runs while
	 * the module body is still evaluating, so naming a `const` declared further
	 * down throws `Cannot access 'make' before initialization` **at import time**,
	 * with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<CodeScanning, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<CodeScanningShape> = {}): CodeScanningShape => ({
		configure: overrides.configure ?? (() => unstubbed("configure")),
		languages: overrides.languages ?? (() => unstubbed("languages")),
	});

	/** {@link CodeScanning.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<CodeScanningShape> = {}): Layer.Layer<CodeScanning> =>
		Layer.succeed(CodeScanning, CodeScanning.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`CodeScanning.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const SETUP_KEYS = [
	"state",
	"languages",
	"query_suite",
	"threat_model",
	"runner_type",
	"runner_label",
] as const satisfies ReadonlyArray<keyof CodeScanningSetup>;

/**
 * Every method resolves {@link Repo} per call rather than once at layer
 * construction, for the reason `GitBranch` states: capturing the coordinate
 * would make a scoped `Repo.provide` silently do nothing.
 */
const make = (client: GitHubClient["Service"]): CodeScanningShape => {
	const configure = Effect.fn("CodeScanning.configure")(function* (setup: CodeScanningSetup) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });

		// Only the keys the caller set are sent. Copying the whole object would
		// send `undefined` for every key they omitted, which clears settings
		// rather than leaving them alone.
		const body: Record<string, unknown> = {};
		for (const key of SETUP_KEYS) {
			const value = setup[key];
			if (value !== undefined) body[key] = key === "languages" ? [...(value as ReadonlyArray<string>)] : value;
		}

		yield* client.request("PATCH /repos/{owner}/{repo}/code-scanning/default-setup", {
			owner,
			repo,
			// Assembled key-by-key above, so it cannot be narrowed to the route's
			// parameter union at compile time. The cast is on the BODY, never the
			// route literal.
			...body,
		} as Rest.Params<"PATCH /repos/{owner}/{repo}/code-scanning/default-setup">);
	});

	const languages = Effect.fn("CodeScanning.languages")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });

		const detected = yield* client.request("GET /repos/{owner}/{repo}/languages", { owner, repo });
		return Object.keys(detected);
	});

	return { configure, languages };
};
