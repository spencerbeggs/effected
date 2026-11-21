import type { GitCommandError, GitShape, NotARepositoryError } from "@effected/git";
import { Git, GitVersion, UnknownRefError } from "@effected/git";
import type { GitHubClientShape } from "@effected/github";
import { GitHubClient } from "@effected/github";
import type { PlatformError, Scope } from "effect";
import { Cause, Context, Duration, Effect, FileSystem, Option, Path, Random, Redacted, Schedule, Schema } from "effect";
import type { SecureRandom } from "effect/crypto";
import { Base64 } from "effect/encoding";
import type { ChildProcessSpawner } from "effect/process";
import type { ActionEnvironmentError } from "../../ActionEnvironment.js";
import { ActionEnvironment } from "../../ActionEnvironment.js";
import { ActionLogger } from "../../ActionLogger.js";
import type { ActionOutputs } from "../../ActionOutputs.js";
import type { ActionStateError } from "../../ActionState.js";
import { ActionState } from "../../ActionState.js";
import type { CheckoutError, CheckoutOptions } from "../../Checkout.js";
import {
	CheckoutAuthError,
	CheckoutCommitMismatchError,
	CheckoutDefaultBranchError,
	CheckoutGitTooOldError,
	CheckoutRefNotFoundError,
	CheckoutResult,
	CheckoutStateKeyInUseError,
} from "../../Checkout.js";
import { Secret } from "../../Secret.js";
import {
	CredentialRecord,
	configure,
	configureGlobalAuth,
	configureSubmodules,
	prepareGlobalConfig,
	remove,
} from "./credentials.js";
import { ensureDirectory, prepareExistingDirectory } from "./directory.js";
import type { CheckoutInfoLookup, TestRefLookup } from "./refs.js";
import { checkoutInfo, fetchUrl, refSpec, refSpecForAllHistory, testRef } from "./refs.js";
import type { Settings } from "./settings.js";
import { lower } from "./settings.js";

/**
 * The retry policy of a checkout's network steps: 3 attempts, a random 10–20
 * second delay between them, as checkout's `retry-helper` does.
 *
 * @internal
 */
export const CheckoutRetry = Context.Reference<Schedule.Schedule<unknown, unknown>>(
	"@effected/github-actions/CheckoutRetry",
	{
		defaultValue: () =>
			Schedule.recurs(2).pipe(
				Schedule.modifyDelay(() => Effect.map(Random.nextIntBetween(10, 20), (seconds) => Duration.seconds(seconds))),
			),
	},
);

/**
 * Builds the API client a checkout uses from its own token and API base: a
 * live {@link GitHubClient.layerFromToken} client by default; a test replaces
 * it to stay off the network.
 *
 * @internal
 */
export const CheckoutApiClient = Context.Reference<
	(options: { readonly token: Redacted.Redacted<string>; readonly baseUrl: string }) => Effect.Effect<GitHubClientShape>
>("@effected/github-actions/CheckoutApiClient", {
	defaultValue: () => (options) =>
		Effect.provide(
			Effect.gen(function* () {
				return yield* GitHubClient;
			}),
			GitHubClient.layerFromToken(options),
		),
});

/** The oldest git a checkout runs on. */
const MINIMUM_GIT = new GitVersion({ major: 2, minor: 39, patch: 0 });

/**
 * The ceiling of every git spawn a checkout makes: a fetch of a real repository's full history is slow, and so is a
 * checkout after a partial-clone fetch, a sparse set on a partial clone, an LFS smudge, or a clean of a big tree.
 */
const NETWORK_TIMEOUT = "30 minutes";

/** git's hints, silenced for every run so they reach neither the log nor the transcript. */
const QUIET_CONFIG: Readonly<Record<string, string>> = {
	"advice.defaultBranchName": "false",
	"advice.detachedHead": "false",
	"advice.ignoredHook": "false",
};

/** stderr phrases git and ssh use when the remote refused the credentials. */
const AUTH_FAILURES = [
	"Authentication failed",
	"could not read Username",
	"Permission denied (publickey)",
	"terminal prompts disabled",
];

/** Anything the sequence fails with. */
type SourceError =
	| CheckoutError
	| GitCommandError
	| NotARepositoryError
	| UnknownRefError
	| ActionStateError
	| ActionEnvironmentError
	| PlatformError.PlatformError;

/** Everything the sequence needs. */
type SourceRequirements =
	| Scope.Scope
	| Git
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
	| SecureRandom.SecureRandom
	| ActionEnvironment
	| ActionOutputs
	| ActionState
	| ActionLogger;

/**
 * The state keys `"job"` checkouts saved, per `ActionState` service (one per action run), each with the path whose
 * credentials it records. The runner keeps one value per key, so a second checkout of another path under the same key
 * would leave the first one's credentials behind at cleanup.
 */
const savedStateKeys = new WeakMap<object, Map<string, string>>();

const short = (sha: string): string => sha.slice(0, 7);

/** A ref as a reader names it: `main` for `refs/heads/main`, `pull/40/merge` for `refs/pull/40/merge`. */
const displayRef = (ref: string): string => ref.replace(/^refs\/(?:heads\/|tags\/)?/, "");

const firstLine = (text: string): string => text.split(/\r\n|\r|\n/)[0] ?? "";

/** Whether a server is GitHub Enterprise Server, as checkout's `url-helper` decides it. */
const isGhes = (serverUrl: string): boolean => {
	const hostname = new URL(serverUrl).hostname.trimEnd().toUpperCase();
	return hostname !== "GITHUB.COM" && !hostname.endsWith(".GHE.COM") && !hostname.endsWith(".LOCALHOST");
};

/**
 * The REST API root for a server, as checkout's `getServerApiUrl` derives it:
 * the workflow's own `GITHUB_API_URL` for the workflow's server, otherwise
 * `<origin>/api/v3` on GitHub Enterprise Server and `api.<host>` elsewhere.
 *
 * @internal
 */
export const serverApiUrl = (serverUrl: string, workflow: { readonly serverUrl: string; readonly apiUrl: string }) => {
	if (serverUrl.trim() === "" || serverUrl === workflow.serverUrl) {
		return workflow.apiUrl || "https://api.github.com";
	}
	const url = new URL(serverUrl);
	if (isGhes(serverUrl)) {
		url.pathname = "api/v3";
	} else {
		url.hostname = `api.${url.hostname}`;
	}
	const text = url.toString();
	return text.endsWith("/") ? text.slice(0, -1) : text;
};

const tokenOf = (settings: Settings): Option.Option<Redacted.Redacted<string>> =>
	settings.auth._tag === "Token" ? Option.some(settings.auth.token) : Option.fromUndefinedOr(settings.auth.token);

/**
 * The API client: one built from the checkout's own token against its own
 * server's API base, as checkout always uses; the ambient one only when the
 * checkout has no token.
 */
const apiClient = (settings: Settings, apiUrl: string): Effect.Effect<Option.Option<GitHubClientShape>> => {
	const token = tokenOf(settings);
	if (Option.isNone(token)) return Effect.serviceOption(GitHubClient);
	return Effect.flatMap(CheckoutApiClient, (build) =>
		Effect.map(build({ token: token.value, baseUrl: apiUrl }), Option.some),
	);
};

/** Registers every secret with the runner's log filter before any git runs. */
const maskSecrets = (settings: Settings): Effect.Effect<void, never, ActionOutputs> =>
	Effect.gen(function* () {
		const token = tokenOf(settings);
		if (Option.isSome(token)) {
			const plaintext = yield* Secret.forRunnerFile(token.value);
			yield* Secret.mask(Redacted.make(Base64.encode(`x-access-token:${plaintext}`)));
		}
		if (settings.auth._tag === "Ssh") {
			yield* Secret.mask(settings.auth.key);
		}
	});

/**
 * Retries an effect under {@link CheckoutRetry}. A pre-spawn refusal and a
 * missing ref are never retried: neither changes on a second attempt.
 */
const retried = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const schedule = yield* CheckoutRetry;
		return yield* Effect.retry(effect, {
			schedule,
			while: (error: E) =>
				!(error instanceof CheckoutRefNotFoundError) &&
				!(typeof error === "object" && error !== null && (error as { kind?: unknown }).kind === "refused"),
		});
	});

/** The repository's object format: from the pinned commit's length, else the API, else git's default. */
const objectFormat = (
	settings: Settings,
	client: Option.Option<GitHubClientShape>,
): Effect.Effect<Option.Option<"sha1" | "sha256">> => {
	if (/^[0-9a-fA-F]{64}$/.test(settings.commit)) return Effect.succeed(Option.some("sha256"));
	if (/^[0-9a-fA-F]{40}$/.test(settings.commit)) return Effect.succeed(Option.some("sha1"));
	if (Option.isNone(client)) return Effect.succeed(Option.none());
	return client.value
		.requestDecoded(
			"GET /repos/{owner}/{repo}/hash-algorithm",
			{ owner: settings.owner, repo: settings.name },
			Schema.Struct({ hash_algorithm: Schema.String }),
		)
		.pipe(
			Effect.map(
				({ hash_algorithm }): Option.Option<"sha1" | "sha256"> =>
					hash_algorithm === "sha256" || hash_algorithm === "sha1" ? Option.some(hash_algorithm) : Option.none(),
			),
			Effect.tap((format) =>
				Option.isNone(format)
					? Effect.logDebug("Unable to determine repository object format from hash-algorithm endpoint")
					: Effect.void,
			),
			Effect.catch((error) =>
				Effect.as(
					Effect.logDebug(
						`Unable to determine repository object format from hash-algorithm endpoint: ${error.message}`,
					),
					Option.none<"sha1" | "sha256">(),
				),
			),
		);
};

/**
 * The default branch, `refs/heads/`-prefixed: `ls-remote` for an SSH key or a `remoteUrl`, the API otherwise, as checkout
 * looks it up.
 * A failure carries the reason, with `scrub` applied so the token never reaches it.
 */
const defaultBranch = (
	settings: Settings,
	git: GitShape,
	client: Option.Option<GitHubClientShape>,
	scrub: (text: string) => string,
): Effect.Effect<string, CheckoutDefaultBranchError> => {
	const repository = `${settings.owner}/${settings.name}`;
	const failed = (detail: string) => new CheckoutDefaultBranchError({ repository, detail: scrub(detail) });
	// The remote's own HEAD for SSH, as checkout does, and for a `remoteUrl`: the API only knows the repository a
	// derived GitHub URL names.
	const lookup: Effect.Effect<string, unknown> =
		settings.auth._tag === "Ssh" || Option.isSome(settings.remoteUrl)
			? Effect.flatMap(retried(git.remoteHead(settings.path, "origin")), (head) =>
					Option.match(head, {
						onNone: () => Effect.fail(failed("the remote names no HEAD")),
						onSome: Effect.succeed,
					}),
				)
			: Option.match(client, {
					onNone: () => Effect.fail(failed("no GitHub API client to ask")),
					onSome: (api) =>
						retried(
							Effect.gen(function* () {
								yield* Effect.logInfo("Retrieving the default branch name");
								const name = yield* api
									.request("GET /repos/{owner}/{repo}", { owner: settings.owner, repo: settings.name })
									.pipe(
										Effect.map((repo) => repo.default_branch),
										Effect.catch((error) =>
											error.status === 404 && settings.name.toUpperCase().endsWith(".WIKI")
												? Effect.succeed("master")
												: Effect.fail(error),
										),
									);
								if (!name) return yield* Effect.fail(failed("the API reported no default branch"));
								return name;
							}),
						),
				});
	return lookup.pipe(
		Effect.tap((name) => Effect.logInfo(`Default branch '${name}'`)),
		Effect.map((name) => (name.startsWith("refs/") ? name : `refs/heads/${name}`)),
		Effect.mapError((error) =>
			error instanceof CheckoutDefaultBranchError
				? error
				: failed(error instanceof Error ? error.message : String(error)),
		),
	);
};

/** Whether exactly `ref` exists locally. */
const refExists = (git: GitShape, cwd: string, ref: string): Effect.Effect<boolean> =>
	git.forEachRef(cwd, { patterns: [ref] }).pipe(
		Effect.map((entries) => entries.some((entry) => entry.ref === ref)),
		Effect.orElseSucceed(() => false),
	);

/** The lookups `checkoutInfo` and `testRef` ask of the repository. */
const lookups = (git: GitShape, cwd: string): CheckoutInfoLookup & TestRefLookup => ({
	branchExists: (remoteName) => refExists(git, cwd, `refs/remotes/${remoteName}`),
	tagExists: (name) => refExists(git, cwd, `refs/tags/${name}`),
	shaExists: (sha) => git.refExists(cwd, `${sha}^{object}`).pipe(Effect.orElseSucceed(() => false)),
	revParse: (ref) => git.revParse(cwd, ref).pipe(Effect.orElseSucceed(() => "")),
});

/**
 * A fetch failure in checkout's terms: a missing ref, or refused credentials.
 *
 * @remarks
 * A shallow fetch whose refspecs are all globs (an unqualified ref) and match
 * nothing exits 1 with no output at all; that silence is a missing ref too.
 */
const classifyFetch =
	(settings: Settings, refspecs: ReadonlyArray<string>) =>
	<E>(error: E): E | CheckoutRefNotFoundError | CheckoutAuthError => {
		if (error instanceof UnknownRefError) {
			return new CheckoutRefNotFoundError({ ref: settings.ref });
		}
		const tagged = error as { readonly _tag?: unknown; readonly stderr?: unknown; readonly exitCode?: unknown };
		if (tagged._tag === "GitCommandError" && typeof tagged.stderr === "string") {
			const stderr = tagged.stderr;
			if (tagged.exitCode === 1 && stderr.trim() === "" && refspecs.every((spec) => spec.includes("*"))) {
				return new CheckoutRefNotFoundError({ ref: settings.ref });
			}
			const match = AUTH_FAILURES.find((phrase) => stderr.includes(phrase));
			if (match !== undefined) {
				return new CheckoutAuthError({ repository: `${settings.owner}/${settings.name}`, detail: match });
			}
		}
		return error;
	};

/** The fetch step's red line. */
const fetchFailure = (cause: Cause.Cause<unknown>): string => {
	const error = Option.getOrUndefined(Cause.findErrorOption(cause));
	if (error instanceof CheckoutRefNotFoundError) {
		return `fetch failed · branch or tag '${displayRef(error.ref)}' not found`;
	}
	if (error instanceof CheckoutCommitMismatchError) {
		return `fetch failed · ref moved past ${short(error.expected)}`;
	}
	if (error instanceof CheckoutAuthError) {
		return "fetch failed · authentication refused";
	}
	const squashed = Cause.squash(cause);
	return `fetch failed · ${firstLine(squashed instanceof Error ? squashed.message : String(squashed))}`;
};

/**
 * Checks a repository out the way checkout v7's `getSource` does, one step per
 * phase of work under one phase heading.
 *
 * @internal
 */
export const getSource = (options: CheckoutOptions): Effect.Effect<CheckoutResult, SourceError, SourceRequirements> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const git = yield* Git;
		const logger = yield* ActionLogger;
		const state = yield* ActionState;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const github = yield* env.github;
		const workspace = yield* env.get("GITHUB_WORKSPACE");
		// A privileged event's payload decides the unsafe pull request guard: never guess it.
		const privileged = github.eventName === "pull_request_target" || github.eventName === "workflow_run";
		const payload = privileged ? yield* env.payload : yield* env.payload.pipe(Effect.orElseSucceed(() => ({})));
		const settings = yield* lower(options, { github, workspace, payload });
		if (settings.credentials === "job") {
			const recorded = savedStateKeys.get(state)?.get(settings.stateKey);
			if (recorded !== undefined && recorded !== settings.path) {
				return yield* new CheckoutStateKeyInUseError({ stateKey: settings.stateKey, path: recorded });
			}
		}
		const repositoryUrl = Option.getOrElse(settings.remoteUrl, () => fetchUrl(settings));
		const client = yield* apiClient(settings, serverApiUrl(settings.serverUrl, github));
		const token = tokenOf(settings);
		const plaintext = Option.isSome(token) ? yield* Secret.forRunnerFile(token.value) : "";
		/** Removes the token from text bound for an error. */
		const scrub = (text: string): string => (plaintext === "" ? text : text.replaceAll(plaintext, "***"));
		const target = settings.ref
			? displayRef(settings.ref)
			: settings.commit
				? short(settings.commit)
				: "default branch";

		/** The run environment so far: `GIT_CONFIG_GLOBAL` once it exists, `GIT_SSH_COMMAND` once configured. */
		let runEnv: Record<string, string> = {};
		const withRun = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			Effect.suspend(() => Git.withRunOptions(effect, { env: { ...runEnv } }));

		let temporaryConfig = Option.none<string>();
		/** What removal removes, set once the credentials are written. */
		let credentials = Option.none<CredentialRecord>();

		const discardGlobalConfig = Effect.suspend(() =>
			Option.match(temporaryConfig, {
				onNone: () => Effect.void,
				onSome: (file) => fs.remove(path.dirname(file), { recursive: true, force: true }).pipe(Effect.ignore),
			}),
		);
		const removeCredentials = Effect.suspend(() =>
			Option.match(credentials, {
				onNone: () => Effect.void,
				onSome: (record) => logger.step("credentials removed", remove(record, git), { window: "10 seconds" }),
			}),
		);

		if (settings.credentials === "action") {
			// Registered before anything is written, so an interruption at any later point still removes it.
			yield* Effect.addFinalizer(() => removeCredentials);
		}

		const prepare = Effect.gen(function* () {
			const existing = yield* ensureDirectory(settings.path);
			const version = yield* git.version(settings.path);
			if (!GitVersion.atLeast(version, MINIMUM_GIT)) {
				return yield* new CheckoutGitTooOldError({ found: version.toString(), required: MINIMUM_GIT.toString() });
			}

			if (settings.safeDirectory || settings.submodules) {
				// Uninterruptible, so the directory it makes is recorded for discarding as soon as it exists.
				yield* Effect.uninterruptible(
					Effect.tap(prepareGlobalConfig(settings, git), (file) =>
						Effect.sync(() => {
							temporaryConfig = Option.some(file);
							runEnv = { ...runEnv, GIT_CONFIG_GLOBAL: file };
						}),
					),
				);
			}

			return yield* withRun(
				Effect.gen(function* () {
					const prepared = existing
						? yield* prepareExistingDirectory(git, settings.path, repositoryUrl, settings.clean, settings.ref)
						: { reused: false, cleaned: false };

					if (!(yield* fs.exists(path.join(settings.path, ".git")))) {
						const format = yield* objectFormat(settings, client);
						if (Option.contains(format, "sha256")) {
							yield* Effect.logInfo("Detected SHA-256 repository object format");
						}
						// The detected format either way, so a runner's GIT_DEFAULT_HASH cannot change it.
						yield* git.init(
							settings.path,
							settings.path,
							Option.match(format, { onNone: () => ({}), onSome: (objectFormat) => ({ objectFormat }) }),
						);
						yield* git.remoteAdd(settings.path, "origin", repositoryUrl);
					}

					yield* git
						.configSet(settings.path, "gc.auto", "0")
						.pipe(
							Effect.catch(() =>
								Effect.logWarning(
									"Unable to turn off git automatic garbage collection. The git fetch operation may trigger garbage collection and cause a delay.",
								),
							),
						);

					// Uninterruptible, so the credentials are either all recorded for removal or rolled back:
					// `configure` removes its own partial writes, and a failed save removes the whole layout.
					const written = yield* Effect.uninterruptible(
						Effect.gen(function* () {
							const configured = yield* configure(
								settings,
								git,
								Option.isSome(temporaryConfig) ? { temporaryGlobalConfig: temporaryConfig.value } : undefined,
							);
							// The temporary global config is discarded when checkout ends, so a later removal makes its own.
							const lasting = CredentialRecord.make({ ...configured.record, temporaryGlobalConfig: Option.none() });
							if (settings.credentials === "job") {
								yield* state
									.save(settings.stateKey, lasting, CredentialRecord)
									.pipe(Effect.onError(() => remove(configured.record, git)));
								const keys = savedStateKeys.get(state) ?? new Map<string, string>();
								savedStateKeys.set(state, keys.set(settings.stateKey, settings.path));
							}
							credentials = Option.some(settings.credentials === "none" ? configured.record : lasting);
							return configured;
						}),
					);
					runEnv = { ...runEnv, ...written.runEnv };
					return { version, prepared, record: written.record };
				}),
			);
		});

		const fetch = (refspecs: ReadonlyArray<string>, filter: Option.Option<string>) =>
			Effect.gen(function* () {
				const shallow = yield* fs.exists(path.join(settings.path, ".git", "shallow"));
				yield* retried(
					git
						.fetchRefspecs(settings.path, {
							refspecs,
							...(settings.depth > 0 ? { depth: settings.depth } : shallow ? { unshallow: true } : {}),
							...(Option.isSome(filter) ? { filter: filter.value } : {}),
							noTags: true,
							prune: true,
							noRecurseSubmodules: true,
							protocolVersion: 2,
						})
						.pipe(Effect.mapError(classifyFetch(settings, refspecs))),
				);
			});

		const fetchRef = withRun(
			Effect.gen(function* () {
				const ref =
					!settings.ref && !settings.commit ? yield* defaultBranch(settings, git, client, scrub) : settings.ref;
				const commit = settings.commit;
				if (settings.lfs) {
					yield* git.lfsInstall(settings.path, { local: true });
				}
				const filter = Option.isSome(settings.filter)
					? settings.filter
					: Option.isSome(settings.sparse)
						? Option.some("blob:none")
						: Option.none<string>();
				const lookup = lookups(git, settings.path);
				const mismatch = () => new CheckoutCommitMismatchError({ ref, expected: commit });

				if (settings.depth <= 0) {
					yield* fetch(refSpecForAllHistory(ref, commit), filter);
					// The ref may have moved since the event: fetch the pinned commit explicitly.
					if (!(yield* testRef(lookup, ref, commit))) {
						yield* fetch(refSpec(ref, commit, false), filter);
						if (!(yield* testRef(lookup, ref, commit))) return yield* mismatch();
					}
				} else {
					yield* fetch(refSpec(ref, commit, settings.fetchTags), filter);
					if (!(yield* testRef(lookup, ref, commit))) return yield* mismatch();
				}

				const info = yield* checkoutInfo(lookup, ref, commit);
				const fetched = yield* git.revParse(
					settings.path,
					`${Option.getOrElse(info.startPoint, () => info.ref)}^{commit}`,
				);
				return { ref, info, fetched };
			}),
		);

		const checkoutRef = (info: { readonly ref: string; readonly startPoint: Option.Option<string> }) =>
			withRun(
				Effect.gen(function* () {
					if (Option.isSome(settings.sparse)) {
						yield* git.sparseCheckoutSet(settings.path, settings.sparse.value.patterns, {
							cone: settings.sparse.value.cone,
						});
					} else {
						yield* git.sparseCheckoutDisable(settings.path);
					}
					if (Option.isSome(info.startPoint)) {
						yield* git.checkout(settings.path, info.startPoint.value, { force: true, branch: info.ref });
					} else {
						yield* git.checkout(settings.path, info.ref, { force: true });
					}
					const commit = yield* git.revParse(settings.path, "HEAD");
					const subject = firstLine((yield* git.commitInfo(settings.path, "HEAD")).message);
					return { commit, subject, branch: Option.map(info.startPoint, () => info.ref) };
				}),
			);

		const updateSubmodules = (record: CredentialRecord) =>
			withRun(
				Effect.gen(function* () {
					const recursive = settings.nestedSubmodules;
					yield* configureGlobalAuth(settings, record, git);
					yield* git.submoduleSync(settings.path, { recursive });
					yield* git.submoduleUpdate(settings.path, {
						init: true,
						force: true,
						...(settings.depth > 0 ? { depth: settings.depth } : {}),
						recursive,
						protocolVersion: 2,
					});
					yield* git.submoduleForeach(settings.path, "git config --local gc.auto 0", { recursive });
					yield* configureSubmodules(settings, record, git);
					return (yield* git.submoduleStatus(settings.path, { recursive })).length;
				}),
			);

		const sequence = Effect.gen(function* () {
			const setup = yield* logger.step("prepare", prepare, {
				window: "10 seconds",
				summary: ({ version, prepared }) =>
					`git ${version} · ${prepared.reused ? (prepared.cleaned ? "reused, cleaned" : "reused") : "fresh clone"}`,
			});

			const fetched = yield* logger.step("fetch", fetchRef, {
				window: "2 minutes",
				summary: ({ fetched }) =>
					`fetched ${short(fetched)} · ${settings.depth > 0 ? `depth ${settings.depth}` : "full history"}`,
				failure: fetchFailure,
			});

			if (settings.lfs && Option.isNone(settings.sparse)) {
				// One explicit fetch downloads the LFS objects in parallel; a sparse checkout fetches them lazily.
				yield* logger.step(
					"lfs",
					withRun(
						retried(
							git.lfsFetch(settings.path, {
								ref: Option.getOrElse(fetched.info.startPoint, () => fetched.info.ref),
							}),
						),
					),
					{ window: "2 minutes", summary: () => "fetched LFS objects" },
				);
			}

			const checkedOut = yield* logger.step("checkout", checkoutRef(fetched.info), {
				window: "10 seconds",
				summary: ({ commit, subject, branch }) =>
					`checked out ${short(commit)} (${Option.getOrElse(branch, () => "detached")}) "${subject}"`,
			});

			if (settings.submodules) {
				yield* logger.step("submodules", updateSubmodules(setup.record), {
					window: "2 minutes",
					summary: (count) => `${count} submodule${count === 1 ? "" : "s"} checked out`,
				});
			}

			if (settings.credentials === "job") {
				yield* logger.step("credentials kept for the job", Effect.void);
			} else if (settings.credentials === "action") {
				yield* logger.step("credentials removed when the action ends", Effect.void);
			}

			return CheckoutResult.make({
				ref: fetched.ref,
				commit: checkedOut.commit,
				path: settings.path,
				repository: { owner: settings.owner, name: settings.name },
			});
		});

		yield* maskSecrets(settings);
		const body = settings.credentials === "none" ? Effect.ensuring(sequence, removeCredentials) : sequence;
		return yield* logger.phase(
			`Checkout ${settings.owner}/${settings.name} @ ${target}`,
			Effect.ensuring(body, discardGlobalConfig),
		);
	}).pipe(
		Git.withRunOptions({
			env: options.lfs === true ? {} : { GIT_LFS_SKIP_SMUDGE: "1" },
			config: QUIET_CONFIG,
			timeout: NETWORK_TIMEOUT,
		}),
	);
