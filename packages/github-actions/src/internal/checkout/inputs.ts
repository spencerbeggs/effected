import { Config, Effect, Option, Redacted, Schema, SchemaIssue } from "effect";
import type { ActionEnvironmentError } from "../../ActionEnvironment.js";
import { ActionEnvironment } from "../../ActionEnvironment.js";
import { ActionInput } from "../../ActionInput.js";
import { ActionManifestInput } from "../../ActionManifest.js";
import type { CheckoutAuth, CheckoutOptions, CheckoutRef } from "../../Checkout.js";

const SHA_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
// ASCII whitespace only: a BOM or NBSP is valid inside a git ref name.
const asciiTrim = (value: string): string => value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");

const invalid = (message: string, actual: unknown): Config.ConfigError =>
	new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue({ message }, actual)));

/**
 * One checkout input: its name, checkout's description and its default.
 *
 * @internal
 */
const declare = (description: string, defaultValue?: string): ActionManifestInput =>
	ActionManifestInput.make({ description, ...(defaultValue === undefined ? {} : { default: defaultValue }) });

/** @internal */
export const declarations: ReadonlyArray<readonly [string, ActionManifestInput]> = [
	["repository", declare("Repository name with owner. For example, actions/checkout", "${{ github.repository }}")],
	[
		"ref",
		declare(
			"The branch, tag or SHA to checkout. When checking out the repository that triggered a workflow, this defaults to the reference or SHA for that event.  Otherwise, uses the default branch.\n",
		),
	],
	[
		"token",
		declare(
			"Personal access token (PAT) used to fetch the repository. The PAT is configured with the local git config, which enables your scripts to run authenticated git commands. The post-job step removes the PAT.\nWe recommend using a service account with the least permissions necessary. Also when generating a new PAT, select the least scopes necessary.\n[Learn more about creating and using encrypted secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets)\n",
			"${{ github.token }}",
		),
	],
	[
		"ssh-key",
		declare(
			"SSH key used to fetch the repository. The SSH key is configured with the local git config, which enables your scripts to run authenticated git commands. The post-job step removes the SSH key.\nWe recommend using a service account with the least permissions necessary.\n[Learn more about creating and using encrypted secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets)\n",
		),
	],
	[
		"ssh-known-hosts",
		declare(
			"Known hosts in addition to the user and global host key database. The public SSH keys for a host may be obtained using the utility `ssh-keyscan`. For example, `ssh-keyscan github.com`. The public key for github.com is always implicitly added.\n",
		),
	],
	[
		"ssh-strict",
		declare(
			"Whether to perform strict host key checking. When true, adds the options `StrictHostKeyChecking=yes` and `CheckHostIP=no` to the SSH command line. Use the input `ssh-known-hosts` to configure additional hosts.\n",
			"true",
		),
	],
	["ssh-user", declare("The user to use when connecting to the remote SSH host. By default 'git' is used.\n", "git")],
	["persist-credentials", declare("Whether to configure the token or SSH key with the local git config", "true")],
	["path", declare("Relative path under $GITHUB_WORKSPACE to place the repository")],
	["clean", declare("Whether to execute `git clean -ffdx && git reset --hard HEAD` before fetching", "true")],
	["filter", declare("Partially clone against a given filter. Overrides sparse-checkout if set.\n")],
	[
		"sparse-checkout",
		declare("Do a sparse checkout on given patterns. Each pattern should be separated with new lines.\n"),
	],
	["sparse-checkout-cone-mode", declare("Specifies whether to use cone-mode when doing a sparse checkout.\n", "true")],
	["fetch-depth", declare("Number of commits to fetch. 0 indicates all history for all branches and tags.", "1")],
	["fetch-tags", declare("Whether to fetch tags, even if fetch-depth > 0.", "false")],
	["show-progress", declare("Whether to show progress status output when fetching.", "true")],
	["lfs", declare("Whether to download Git-LFS files", "false")],
	[
		"submodules",
		declare(
			"Whether to checkout submodules: `true` to checkout submodules or `recursive` to recursively checkout submodules.\nWhen the `ssh-key` input is not provided, SSH URLs beginning with `git@github.com:` are converted to HTTPS.\n",
			"false",
		),
	],
	[
		"set-safe-directory",
		declare(
			"Add repository path as safe.directory for Git global config by running `git config --global --add safe.directory <path>`",
			"true",
		),
	],
	[
		"github-server-url",
		declare(
			"The base URL for the GitHub instance that you are trying to clone from, will use environment defaults to fetch from the same instance that the workflow is running from unless specified. Example URLs are https://github.com or https://my-ghes-server.example.com",
		),
	],
	[
		"allow-unsafe-pr-checkout",
		declare(
			"Required to check out fork pull request code from a workflow triggered by `pull_request_target` or `workflow_run`. These workflows run with the base repository's GITHUB_TOKEN, secrets, default-branch cache scope, and runner access; fetching and executing a fork's code in that trusted context commonly leads to \"pwn request\" vulnerabilities. Set to `true` only after reviewing the risks at https://gh.io/securely-using-pull_request_target.\n",
			"false",
		),
	],
];

const flag = (name: string, fallback: boolean): Config.Config<boolean> =>
	ActionInput.boolean(name).pipe(Config.withDefault(fallback));

// checkout's core.getInput trims every input; a whitespace-only value is absent.
const trimmed = (name: string): Config.Config<Option.Option<string>> =>
	Config.option(ActionInput.string(name)).pipe(
		Config.map((value) =>
			Option.flatMap(value, (raw) => {
				const text = raw.trim();
				return text === "" ? Option.none() : Option.some(text);
			}),
		),
	);

const optional = trimmed;

const optionalSecret = (name: string): Config.Config<Option.Option<Redacted.Redacted<string>>> =>
	Config.map(
		trimmed(name),
		Option.map((text) => Redacted.make(text)),
	);

const withFallback = (name: string, fallback: string): Config.Config<string> =>
	Config.map(
		trimmed(name),
		Option.getOrElse(() => fallback),
	);

/** @internal */
export const readInputs = (
	prefix: string,
): Effect.Effect<CheckoutOptions, Config.ConfigError | ActionEnvironmentError, ActionEnvironment> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const github = yield* env.github;
		const n = (name: string): string => `${prefix}${name}`;

		const qualified = yield* withFallback(n("repository"), github.repository);
		const parts = qualified.split("/");
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			return yield* Effect.fail(
				invalid(`Invalid repository '${qualified}'. Expected format {owner}/{repo}.`, qualified),
			);
		}
		const isWorkflowRepository = qualified.toUpperCase() === github.repository.toUpperCase();

		// Read raw: the input provider does not trim, so a leading BOM or NBSP survives.
		const rawRef = asciiTrim(Option.getOrElse(yield* Config.option(ActionInput.string(n("ref"))), () => ""));
		const ref: CheckoutRef =
			rawRef === ""
				? isWorkflowRepository
					? { _tag: "Event" }
					: { _tag: "Default" }
				: SHA_PATTERN.test(rawRef)
					? { _tag: "Commit", sha: rawRef }
					: { _tag: "Ref", ref: rawRef };

		const tokenInput = yield* optionalSecret(n("token"));
		if (Option.isNone(tokenInput)) {
			return yield* Effect.fail(invalid(`Input "${n("token")}" is required`, ""));
		}
		const token = tokenInput.value;
		const sshKey = yield* optionalSecret(n("ssh-key"));
		const auth: CheckoutAuth = Option.isSome(sshKey)
			? {
					_tag: "Ssh",
					key: sshKey.value,
					token,
					strict: yield* flag(n("ssh-strict"), true),
					user: yield* withFallback(n("ssh-user"), "git"),
					...Option.match(yield* optional(n("ssh-known-hosts")), {
						onNone: () => ({}),
						onSome: (knownHosts) => ({ knownHosts }),
					}),
				}
			: { _tag: "Token", token };

		const persist = yield* flag(n("persist-credentials"), true);
		const path = yield* optional(n("path"));
		const clean = yield* flag(n("clean"), true);
		const filter = yield* optional(n("filter"));
		const patterns = yield* ActionInput.lines(n("sparse-checkout")).pipe(
			Config.withDefault([] as ReadonlyArray<string>),
		);
		const cone = yield* flag(n("sparse-checkout-cone-mode"), true);
		const rawDepth = yield* withFallback(n("fetch-depth"), "1");
		const depthNumber = Math.floor(Number(rawDepth));
		const depth = Number.isNaN(depthNumber) || depthNumber <= 0 ? ("full" as const) : depthNumber;
		const fetchTags = yield* flag(n("fetch-tags"), false);
		// Read for parity with checkout's surface; the transcript is always captured.
		yield* optional(n("show-progress"));
		const lfs = yield* flag(n("lfs"), false);
		const submodulesText = (yield* withFallback(n("submodules"), "")).toUpperCase();
		const submodules = submodulesText === "RECURSIVE" ? "recursive" : submodulesText === "TRUE";
		const safeDirectory = yield* flag(n("set-safe-directory"), true);
		const serverUrl = yield* optional(n("github-server-url"));
		const allowUnsafePrCheckout = yield* flag(n("allow-unsafe-pr-checkout"), false);

		return {
			repository: { owner: parts[0], name: parts[1] },
			ref,
			auth,
			credentials: persist ? "job" : "none",
			clean,
			depth,
			fetchTags,
			lfs,
			submodules,
			safeDirectory,
			allowUnsafePrCheckout,
			...(Option.isSome(path) ? { path: path.value } : {}),
			...(Option.isSome(filter) ? { filter: filter.value } : {}),
			...(patterns.length > 0 ? { sparse: { patterns, cone } } : {}),
			...(Option.isSome(serverUrl) ? { serverUrl: serverUrl.value } : {}),
		} satisfies CheckoutOptions;
	});
