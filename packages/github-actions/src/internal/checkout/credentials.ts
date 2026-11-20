import type { GitCommandError, GitShape, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import { Effect, FileSystem, Option, Path, PlatformError, Redacted, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64 } from "effect/encoding";
import type { ChildProcessSpawner } from "effect/process";
import { ChildProcess } from "effect/process";
import type { ActionEnvironmentError } from "../../ActionEnvironment.js";
import { ActionEnvironment } from "../../ActionEnvironment.js";
import { ActionLogger } from "../../ActionLogger.js";
import type { ActionOutputs } from "../../ActionOutputs.js";
import { Secret } from "../../Secret.js";
import { isWindowsRunner } from "../runner.js";
import { serverOrigin } from "./refs.js";
import type { Settings } from "./settings.js";

const SSH_COMMAND_KEY = "core.sshCommand";
const TOKEN_PLACEHOLDER = "AUTHORIZATION: basic ***";
const CREDENTIALS_FILE = /git-credentials-[0-9a-f-]+\.config$/i;
const KNOWN_GITHUB_HOST =
	"github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=";

/**
 * What a checkout wrote to authenticate, so it can be removed later: from a
 * scope finalizer, before `checkout` returns, or from the post step, which
 * reads it back from `ActionState`.
 *
 * @remarks
 * Encodes to plain JSON: every optional path is `OptionFromNullOr`.
 *
 * @internal
 */
export class CredentialRecord extends Schema.Class<CredentialRecord>("CredentialRecord")({
	/** The checked-out repository's working directory. */
	repositoryPath: Schema.String,
	/** The server's `SCHEME://HOST[:PORT]`, which names the extraheader and `insteadOf` keys. */
	origin: Schema.String,
	/** The credentials file `includeIf` points at, when a token was configured. */
	credentialsFile: Schema.OptionFromNullOr(Schema.String),
	/** The SSH private key file. */
	sshKeyPath: Schema.OptionFromNullOr(Schema.String),
	/** The SSH known-hosts file. */
	knownHostsPath: Schema.OptionFromNullOr(Schema.String),
	/** The temporary global config (`GIT_CONFIG_GLOBAL`), discarded after the run. */
	temporaryGlobalConfig: Schema.OptionFromNullOr(Schema.String),
	/** Whether the repository was marked a `safe.directory`. */
	safeDirectory: Schema.Boolean,
	/** Whether submodules were checked out, so removal walks them. */
	submodules: Schema.Boolean,
}) {}

/** Anything a credential write can fail with. */
type CredentialError =
	| GitCommandError
	| NotARepositoryError
	| UnknownRefError
	| PlatformError.PlatformError
	| ActionEnvironmentError;

const forward = (value: string): string => value.replace(/\\/g, "/");
const basename = (value: string): string => forward(value).split("/").pop() ?? value;

/** A pure POSIX `relative`, tolerant of a Windows drive's letter case. */
const relativeTo = (from: string, to: string): string => {
	const drive = /^[A-Za-z]:/.test(from);
	const fromParts = from.split("/").filter((part) => part.length > 0);
	const toParts = to.split("/").filter((part) => part.length > 0);
	const same = (a: string | undefined, b: string | undefined) =>
		drive ? a?.toLowerCase() === b?.toLowerCase() : a === b;
	let common = 0;
	while (common < fromParts.length && common < toParts.length && same(fromParts[common], toParts[common])) {
		common += 1;
	}
	return [...fromParts.slice(common).map(() => ".."), ...toParts.slice(common)].join("/");
};

/** `/github/workspace` joined with a relative path, `..` segments resolved. */
const containerPath = (relative: string): string => {
	const parts = ["github", "workspace"];
	for (const part of relative.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};

/**
 * The `includeIf` entries checkout writes so a git directory reads the
 * credentials file: the host directory and its worktrees, then the same pair
 * as a container job sees them under `/github/workspace`, pointing at
 * `/github/runner_temp/<basename>`.
 *
 * @remarks
 * Pure. Backslashes become `/` in every key on every OS, as checkout does; the
 * host value is the credentials file exactly as given. `worktrees: false`
 * drops the worktree pair, as checkout's submodule entries do.
 *
 * @internal
 */
export const includeIfKeys = (input: {
	readonly gitDir: string;
	readonly workspace: string;
	readonly credentialsFile: string;
	readonly worktrees?: boolean;
}): ReadonlyArray<{ readonly key: string; readonly value: string }> => {
	const gitDir = forward(input.gitDir);
	const container = containerPath(relativeTo(forward(input.workspace), gitDir));
	const containerFile = `/github/runner_temp/${basename(input.credentialsFile)}`;
	const worktrees = input.worktrees ?? true;
	return [
		{ key: `includeIf.gitdir:${gitDir}.path`, value: input.credentialsFile },
		...(worktrees ? [{ key: `includeIf.gitdir:${gitDir}/worktrees/*.path`, value: input.credentialsFile }] : []),
		{ key: `includeIf.gitdir:${container}.path`, value: containerFile },
		...(worktrees ? [{ key: `includeIf.gitdir:${container}/worktrees/*.path`, value: containerFile }] : []),
	];
};

/**
 * Creates the temporary global config, `$RUNNER_TEMP/<uuid>/.gitconfig`,
 * seeded from `<home>/.gitconfig` when one exists, as checkout's
 * `configureTempGlobalConfig` does.
 *
 * @remarks
 * Point git at it with `GIT_CONFIG_GLOBAL`; write into it with `-f`. Removing
 * its directory discards it.
 *
 * @internal
 */
export const temporaryGlobalConfig = (
	home: Option.Option<string>,
	runnerTemp: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path | SecureRandom.SecureRandom> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const random = yield* SecureRandom.SecureRandom;
		const directory = path.join(runnerTemp, yield* random.uuidV4());
		yield* fs.makeDirectory(directory, { recursive: true });
		const file = path.join(directory, ".gitconfig");
		const source = Option.map(home, (dir) => path.join(dir, ".gitconfig"));
		const seeded = Option.isSome(source) && (yield* fs.exists(source.value));
		if (seeded) {
			yield* Effect.logInfo(`Copying '${source.value}' to '${file}'`);
			yield* fs.copyFile(source.value, file);
		} else {
			yield* fs.writeFileString(file, "");
		}
		return file;
	});

/** `HOME`, or `USERPROFILE` where Windows leaves `HOME` unset. */
const homeDirectory = (env: ActionEnvironment["Service"]): Effect.Effect<Option.Option<string>> =>
	Effect.flatMap(env.getOptional("HOME"), (home) =>
		Option.isSome(home) ? Effect.succeed(home) : env.getOptional("USERPROFILE"),
	);

/**
 * Creates the temporary global config a checkout runs under and, when
 * `settings.safeDirectory`, marks the repository a `safe.directory` in it, as
 * checkout does before it touches an existing directory. A failed
 * `safe.directory` write is logged and the run continues, as checkout's is.
 *
 * @internal
 */
export const prepareGlobalConfig = (
	settings: Settings,
	git: GitShape,
): Effect.Effect<
	string,
	PlatformError.PlatformError | ActionEnvironmentError,
	ActionEnvironment | FileSystem.FileSystem | Path.Path | SecureRandom.SecureRandom
> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const path = yield* Path.Path;
		const file = yield* temporaryGlobalConfig(yield* homeDirectory(env), yield* env.get("RUNNER_TEMP"));
		if (settings.safeDirectory) {
			yield* Effect.logInfo("Adding repository directory to the temporary git global config as a safe directory");
			yield* git
				.configAdd(path.dirname(file), "safe.directory", settings.path, { file })
				.pipe(
					Effect.catch((error) => Effect.logInfo(`Failed to initialize safe directory with error: ${error.message}`)),
				);
		}
		return file;
	});

/** The values checkout rewrites to HTTPS: `git@<host>:` and, from the event payload, `org-<id>@github.com:`. */
const insteadOfValues = (env: ActionEnvironment["Service"], serverUrl: string): Effect.Effect<ReadonlyArray<string>> =>
	Effect.gen(function* () {
		const values = [`git@${new URL(serverUrl).hostname}:`];
		const payload = yield* env.payload.pipe(Effect.orElseSucceed(() => undefined));
		const id = (payload as { repository?: { owner?: { id?: unknown } } } | undefined)?.repository?.owner?.id;
		if (typeof id === "number") values.push(`org-${id}@github.com:`);
		return values;
	});

const insteadOfKey = (origin: string): string => `url.${origin}/.insteadOf`;
const extraheaderKey = (origin: string): string => `http.${origin}/.extraheader`;

/**
 * The SSH command, as checkout builds it. `form: "persisted"` spells the files
 * as `$RUNNER_TEMP/<basename>`, checkout's own form, so a later step (or a
 * container job) resolves them in its own temp directory; `form: "run"` uses
 * the absolute paths, so the run never depends on an ambient `RUNNER_TEMP`.
 */
const sshCommand = (keyPath: string, knownHostsPath: string, strict: boolean, form: "run" | "persisted"): string => {
	const file = (value: string) => (form === "run" ? forward(value) : `$RUNNER_TEMP/${basename(value)}`);
	const strictness = strict ? " -o StrictHostKeyChecking=yes -o CheckHostIP=no" : "";
	return `ssh -i "${file(keyPath)}"${strictness} -o "UserKnownHostsFile=${file(knownHostsPath)}"`;
};

const sshStrict = (settings: Settings): boolean => settings.auth._tag !== "Ssh" || (settings.auth.strict ?? true);

/** The token the extraheader carries: a `Token`'s, or an `Ssh` auth's optional one. */
const tokenOf = (settings: Settings): Option.Option<Redacted.Redacted<string>> =>
	settings.auth._tag === "Token" ? Option.some(settings.auth.token) : Option.fromUndefinedOr(settings.auth.token);

/** Runs `icacls`, failing typed on a non-zero exit. */
const icacls = (args: ReadonlyArray<string>) =>
	Effect.flatMap(ActionLogger.command(ChildProcess.make("icacls", [...args])), ({ exitCode }) =>
		exitCode === 0
			? Effect.void
			: Effect.fail(
					PlatformError.systemError({
						_tag: "PermissionDenied",
						module: "Checkout",
						method: "icacls",
						pathOrDescriptor: args[0],
						description: `icacls exited ${exitCode}`,
					}),
				),
	);

/**
 * Writes checkout's v6+ credential layout for `settings`, as its
 * `configureAuth` does, and returns what was written with the environment the
 * rest of the run's git must see.
 *
 * @remarks
 * The token and its `x-access-token` base64 are masked before any git runs.
 * The extraheader goes into `$RUNNER_TEMP/git-credentials-<uuid>.config` as a
 * placeholder written by `git config -f`, then the placeholder is replaced
 * through `FileSystem`, so the credential never reaches a command line; the
 * repository's `.git/config` holds only the `includeIf` entries naming the
 * file. An SSH key lands under `RUNNER_TEMP` with mode `0600` (and `icacls`
 * on Windows), beside checkout's known-hosts file, and `GIT_SSH_COMMAND` is in
 * `runEnv`; `core.sshCommand` is persisted only under `"job"`. A temporary
 * global config holds `safe.directory` (and later the submodule auth) and is
 * in `runEnv` as `GIT_CONFIG_GLOBAL`. Any previous credential layout is
 * removed first.
 *
 * Pass `existing.temporaryGlobalConfig` when the caller already made the
 * temporary global config (and wrote `safe.directory` into it), as checkout
 * does before it prepares an existing directory; it is then used as is.
 *
 * @internal
 */
export const configure = (
	settings: Settings,
	git: GitShape,
	existing?: { readonly temporaryGlobalConfig?: string },
): Effect.Effect<
	{ readonly record: CredentialRecord; readonly runEnv: Record<string, string> },
	CredentialError,
	| ActionEnvironment
	| ActionOutputs
	| FileSystem.FileSystem
	| Path.Path
	| SecureRandom.SecureRandom
	| ChildProcessSpawner.ChildProcessSpawner
> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const random = yield* SecureRandom.SecureRandom;
		const runnerTemp = yield* env.get("RUNNER_TEMP");
		const workspace = yield* env.get("GITHUB_WORKSPACE");
		const origin = serverOrigin(settings.serverUrl);
		const repositoryPath = settings.path;

		// Mask every secret before any git runs.
		let basicCredential = Option.none<string>();
		const token = tokenOf(settings);
		if (Option.isSome(token)) {
			const plaintext = yield* Secret.forRunnerFile(token.value);
			const encoded = Base64.encode(`x-access-token:${plaintext}`);
			yield* Secret.mask(Redacted.make(encoded));
			basicCredential = Option.some(encoded);
		}
		const sshKey =
			settings.auth._tag === "Ssh"
				? Option.some(yield* Secret.forRunnerFile(settings.auth.key))
				: Option.none<string>();

		const runEnv: Record<string, string> = {};
		let globalConfig = Option.none<string>();
		if (existing?.temporaryGlobalConfig !== undefined) {
			globalConfig = Option.some(existing.temporaryGlobalConfig);
			runEnv.GIT_CONFIG_GLOBAL = existing.temporaryGlobalConfig;
		} else if (settings.safeDirectory || settings.submodules) {
			const file = yield* temporaryGlobalConfig(yield* homeDirectory(env), runnerTemp);
			globalConfig = Option.some(file);
			runEnv.GIT_CONFIG_GLOBAL = file;
			if (settings.safeDirectory) {
				yield* git.configAdd(path.dirname(file), "safe.directory", repositoryPath, { file });
			}
		}

		const base = CredentialRecord.make({
			repositoryPath,
			origin,
			credentialsFile: Option.none(),
			sshKeyPath: Option.none(),
			knownHostsPath: Option.none(),
			temporaryGlobalConfig: Option.none(),
			safeDirectory: settings.safeDirectory,
			submodules: false,
		});

		const write = Effect.gen(function* () {
			// Remove possible previous values, as checkout does.
			yield* removeLayout(base, git);

			let sshKeyPath = Option.none<string>();
			let knownHostsPath = Option.none<string>();
			if (Option.isSome(sshKey)) {
				const id = yield* random.uuidV4();
				const keyPath = path.join(runnerTemp, id);
				yield* fs.makeDirectory(runnerTemp, { recursive: true });
				yield* fs.writeFileString(keyPath, `${sshKey.value.trim()}\n`, { mode: 0o600 });
				yield* fs.chmod(keyPath, 0o600);
				if (yield* isWindowsRunner(env)) {
					const domain = yield* env.get("USERDOMAIN");
					const user = yield* env.get("USERNAME");
					yield* icacls([keyPath, "/grant:r", `${domain}\\${user}:F`]);
					yield* icacls([keyPath, "/inheritance:r"]);
				}

				const home = yield* homeDirectory(env);
				const userKnownHostsPath = Option.map(home, (dir) => path.join(dir, ".ssh", "known_hosts"));
				const userKnownHosts =
					Option.isSome(userKnownHostsPath) && (yield* fs.exists(userKnownHostsPath.value))
						? yield* fs.readFileString(userKnownHostsPath.value)
						: "";
				let knownHosts = "";
				if (userKnownHosts && Option.isSome(userKnownHostsPath)) {
					const from = userKnownHostsPath.value;
					knownHosts += `# Begin from ${from}\n${userKnownHosts}\n# End from ${from}\n`;
				}
				if (settings.auth._tag === "Ssh" && settings.auth.knownHosts) {
					knownHosts += `# Begin from input known hosts\n${settings.auth.knownHosts}\n# end from input known hosts\n`;
				}
				knownHosts += `# Begin implicitly added github.com\n${KNOWN_GITHUB_HOST}\n# End implicitly added github.com\n`;
				const hostsPath = path.join(runnerTemp, `${id}_known_hosts`);
				yield* fs.writeFileString(hostsPath, knownHosts);

				sshKeyPath = Option.some(keyPath);
				knownHostsPath = Option.some(hostsPath);
				runEnv.GIT_SSH_COMMAND = sshCommand(keyPath, hostsPath, sshStrict(settings), "run");
				if (settings.credentials === "job") {
					yield* git.configSet(
						repositoryPath,
						SSH_COMMAND_KEY,
						sshCommand(keyPath, hostsPath, sshStrict(settings), "persisted"),
					);
				}
			}

			let credentialsFile = Option.none<string>();
			if (Option.isSome(basicCredential)) {
				const file = path.join(runnerTemp, `git-credentials-${yield* random.uuidV4()}.config`);
				yield* Effect.logDebug(`Credentials config path: ${file}`);
				// The placeholder goes through git, the credential through the filesystem: a process
				// command line is commonly captured by audit logging.
				yield* git.configSet(runnerTemp, extraheaderKey(origin), TOKEN_PLACEHOLDER, { file });
				const content = yield* fs.readFileString(file);
				const at = content.indexOf(TOKEN_PLACEHOLDER);
				if (at < 0 || at !== content.lastIndexOf(TOKEN_PLACEHOLDER)) {
					return yield* Effect.die(new Error(`Unable to replace auth placeholder in ${file}`));
				}
				yield* fs.writeFileString(
					file,
					content.replace(TOKEN_PLACEHOLDER, `AUTHORIZATION: basic ${basicCredential.value}`),
				);
				credentialsFile = Option.some(file);

				for (const entry of includeIfKeys({
					gitDir: path.join(repositoryPath, ".git"),
					workspace,
					credentialsFile: file,
				})) {
					yield* git.configSet(repositoryPath, entry.key, entry.value);
				}
			}

			return CredentialRecord.make({
				...base,
				credentialsFile,
				sshKeyPath,
				knownHostsPath,
				temporaryGlobalConfig: globalConfig,
				submodules: settings.submodules,
			});
		});

		const record = yield* Git.withRunOptions(write, { env: { ...runEnv } });
		return { record, runEnv };
	});

/**
 * Writes the submodule auth into the temporary global config before a
 * submodule update, as checkout's `configureGlobalAuth` does: an
 * `include.path` naming the credentials file and, for a token, the
 * SSH-to-HTTPS `insteadOf` values.
 *
 * @remarks
 * A separate step rather than part of {@link configure}: while the global
 * config includes the credentials file, the repository reads the extraheader
 * twice (through its `includeIf` and through the global include), so it is
 * written only after the repository's own fetch, as checkout writes it. A
 * no-op when {@link configure} made no temporary global config.
 *
 * @internal
 */
export const configureGlobalAuth = (
	settings: Settings,
	record: CredentialRecord,
	git: GitShape,
): Effect.Effect<void, CredentialError, ActionEnvironment | Path.Path> =>
	Effect.gen(function* () {
		if (Option.isNone(record.temporaryGlobalConfig)) return;
		const env = yield* ActionEnvironment;
		const path = yield* Path.Path;
		const file = record.temporaryGlobalConfig.value;
		const cwd = path.dirname(file);
		if (Option.isSome(record.credentialsFile)) {
			yield* git.configSet(cwd, "include.path", record.credentialsFile.value, { file });
		}
		yield* unsetPresent(git, cwd, file, [insteadOfKey(record.origin)]);
		if (settings.auth._tag === "Token") {
			for (const value of yield* insteadOfValues(env, settings.serverUrl)) {
				yield* git.configAdd(cwd, insteadOfKey(record.origin), value, { file });
			}
		}
	});

/** Each submodule's absolute git directory, from `git submodule foreach`. */
const submoduleGitDirs = (
	git: GitShape,
	repositoryPath: string,
	recursive: boolean,
): Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError> =>
	Effect.map(git.submoduleForeach(repositoryPath, "git rev-parse --absolute-git-dir", { recursive }), (output) =>
		output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("Entering '")),
	);

/**
 * Persists the credentials into each submodule after `submodule update`, as
 * checkout's `configureSubmoduleAuth` does: the `includeIf` entries in each
 * submodule's config, then `core.sshCommand` (under `"job"`) for an SSH key or
 * the `insteadOf` values for a token.
 *
 * @remarks
 * A no-op under `"none"`, whose credentials do not outlive the call.
 *
 * @internal
 */
export const configureSubmodules = (
	settings: Settings,
	record: CredentialRecord,
	git: GitShape,
): Effect.Effect<void, CredentialError, ActionEnvironment | Path.Path> =>
	Effect.gen(function* () {
		if (settings.credentials === "none") return;
		const env = yield* ActionEnvironment;
		const path = yield* Path.Path;
		const workspace = yield* env.get("GITHUB_WORKSPACE");
		const key = insteadOfKey(record.origin);
		const values = yield* insteadOfValues(env, settings.serverUrl);
		for (const gitDir of yield* submoduleGitDirs(git, record.repositoryPath, settings.nestedSubmodules)) {
			const file = path.join(gitDir, "config");
			yield* unsetPresent(git, record.repositoryPath, file, [key]);
			if (Option.isSome(record.credentialsFile)) {
				for (const entry of includeIfKeys({
					gitDir,
					workspace,
					credentialsFile: record.credentialsFile.value,
					worktrees: false,
				})) {
					yield* git.configSet(record.repositoryPath, entry.key, entry.value, { file });
				}
			}
			if (Option.isSome(record.sshKeyPath) && Option.isSome(record.knownHostsPath)) {
				if (settings.credentials === "job") {
					const command = sshCommand(
						record.sshKeyPath.value,
						record.knownHostsPath.value,
						sshStrict(settings),
						"persisted",
					);
					yield* git.configSet(record.repositoryPath, SSH_COMMAND_KEY, command, { file });
				}
			} else {
				for (const value of values) {
					yield* git.configAdd(record.repositoryPath, key, value, { file });
				}
			}
		}
	});

/** Unsets every key in `keys` that `file` (or the local config) holds; absent keys are skipped. */
const unsetPresent = (
	git: GitShape,
	cwd: string,
	file: string | undefined,
	keys: ReadonlyArray<string>,
): Effect.Effect<void, GitCommandError | NotARepositoryError | UnknownRefError> =>
	Effect.gen(function* () {
		const entries = yield* git.configList(cwd, file === undefined ? { scope: "local" } : { file });
		const present = new Set(entries.map((entry) => entry.key.toLowerCase()));
		for (const key of keys) {
			if (present.has(key.toLowerCase())) {
				yield* git.configUnset(cwd, key, { ...(file === undefined ? {} : { file }), all: true });
			}
		}
	});

/**
 * Removes the `includeIf.gitdir:` values naming a `git-credentials-<uuid>.config`
 * file from one config, keeping any other value of the same key, and returns
 * the files they named.
 */
const removeIncludeIfCredentials = (
	git: GitShape,
	cwd: string,
	file: string | undefined,
): Effect.Effect<ReadonlyArray<string>, GitCommandError | NotARepositoryError | UnknownRefError> =>
	Effect.gen(function* () {
		const target = file === undefined ? {} : { file };
		const entries = yield* git.configList(cwd, file === undefined ? { scope: "local" } : { file });
		const byKey = new Map<string, Array<string>>();
		for (const entry of entries) {
			const lower = entry.key.toLowerCase();
			if (!lower.startsWith("includeif.gitdir:") || !lower.endsWith(".path")) continue;
			byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry.value]);
		}
		const found: Array<string> = [];
		for (const [key, values] of byKey) {
			const matching = values.filter((value) => CREDENTIALS_FILE.test(value));
			if (matching.length === 0) continue;
			found.push(...matching);
			yield* git.configUnset(cwd, key, { ...target, all: true });
			for (const value of values.filter((value) => !CREDENTIALS_FILE.test(value))) {
				yield* git.configAdd(cwd, key, value, target);
			}
		}
		return found;
	});

/** Runs one removal step; a failure logs a warning and the removal continues. */
const bestEffort = <E, R>(description: string, effect: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
	Effect.catch(effect, (error) =>
		Effect.logWarning(`Failed to remove ${description}: ${error instanceof Error ? error.message : String(error)}`),
	);

/**
 * Whether `candidate` lies strictly inside `root`, both resolved first, so
 * neither a sibling sharing the prefix (`<root>-other`) nor a `..` escape
 * passes. `root` itself does not pass: nothing here may delete `RUNNER_TEMP`.
 */
const strictlyInside = (path: Path.Path, root: string, candidate: string): boolean => {
	const base = path.resolve(root);
	const target = path.resolve(candidate);
	return target !== base && target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
};

/**
 * Removes one file under `RUNNER_TEMP`, best-effort; a path outside it, or no
 * `RUNNER_TEMP`, is skipped with a debug line.
 */
const removeUnderTemp = (
	runnerTemp: Option.Option<string>,
	description: string,
	target: string,
	options?: { readonly recursive?: boolean },
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (Option.isNone(runnerTemp) || !strictlyInside(path, runnerTemp.value, target)) {
			yield* Effect.logDebug(`Skipping removal of ${description} '${target}' - not under RUNNER_TEMP`);
			return;
		}
		yield* Effect.logInfo(`Removing ${description} '${target}'`);
		yield* bestEffort(
			`${description} '${target}'`,
			fs.remove(target, { force: true, ...(options?.recursive ? { recursive: true } : {}) }),
		);
	});

/**
 * The removal itself, run with whatever global config the caller has in
 * force: every git step of {@link remove} and of {@link configure}'s
 * pre-cleanup, which supplies its own temporary global config. Leaves the
 * temporary global config alone.
 */
const removeLayout = (
	record: CredentialRecord,
	git: GitShape,
): Effect.Effect<void, never, ActionEnvironment | FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const path = yield* Path.Path;
		const runnerTemp = yield* env.getOptional("RUNNER_TEMP");
		const repo = record.repositoryPath;
		const configKeys = [SSH_COMMAND_KEY, extraheaderKey(record.origin)];

		if (Option.isSome(record.sshKeyPath)) {
			yield* removeUnderTemp(runnerTemp, "SSH key", record.sshKeyPath.value);
		}
		if (Option.isSome(record.knownHostsPath)) {
			yield* removeUnderTemp(runnerTemp, "SSH known hosts", record.knownHostsPath.value);
		}

		const credentialFiles = new Set<string>(Option.toArray(record.credentialsFile));
		const collect = (cwd: string, file: string | undefined) =>
			Effect.map(removeIncludeIfCredentials(git, cwd, file), (found) => {
				for (const value of found) credentialFiles.add(value);
			});

		yield* bestEffort("the repository's credential config", unsetPresent(git, repo, undefined, configKeys));
		yield* bestEffort("the repository's includeIf entries", collect(repo, undefined));

		// Every submodule, recursively, whatever the record says: an earlier run's checkout may have
		// left credentials in submodules this one never fetched, as checkout's removeAuth assumes.
		const gitDirs = yield* submoduleGitDirs(git, repo, true).pipe(
			Effect.catch((error) =>
				Effect.as(Effect.logWarning(`Failed to list submodules: ${error.message}`), [] as ReadonlyArray<string>),
			),
		);
		for (const gitDir of gitDirs) {
			const file = path.join(gitDir, "config");
			yield* bestEffort(
				`the credential config of '${gitDir}'`,
				unsetPresent(git, repo, file, [...configKeys, insteadOfKey(record.origin)]),
			);
			yield* bestEffort(`the includeIf entries of '${gitDir}'`, collect(repo, file));
		}

		for (const file of credentialFiles) {
			yield* removeUnderTemp(runnerTemp, "credentials config", file);
		}
	});

/**
 * Removes everything {@link configure}, {@link configureGlobalAuth} and
 * {@link configureSubmodules} wrote, as checkout's `removeAuth` does.
 *
 * @remarks
 * The SSH files; `core.sshCommand`, the extraheader and the `includeIf.gitdir:`
 * values naming a `git-credentials-<uuid>.config` file, in the repository and
 * every submodule, recursively; the submodules' `insteadOf` values, which
 * checkout leaves behind; each named credentials file; and the temporary
 * global config's directory. A file is deleted only when it resolves strictly
 * inside `RUNNER_TEMP`.
 *
 * Every git step runs with `GIT_CONFIG_GLOBAL` set: the record's temporary
 * global config when it still has one, otherwise (when the record marked the
 * repository a `safe.directory`) a fresh one holding `safe.directory`, deleted
 * afterwards, as checkout's post step does, so a repository owned by another
 * user (a container job) is still cleaned. Best-effort throughout: each
 * failure logs a warning and the rest still runs, so this never fails.
 *
 * @internal
 */
export const remove = (
	record: CredentialRecord,
	git: GitShape,
): Effect.Effect<void, never, ActionEnvironment | FileSystem.FileSystem | Path.Path | SecureRandom.SecureRandom> =>
	Effect.gen(function* () {
		const env = yield* ActionEnvironment;
		const path = yield* Path.Path;
		const runnerTemp = yield* env.getOptional("RUNNER_TEMP");

		let globalConfig = record.temporaryGlobalConfig;
		let fresh = Option.none<string>();
		if (Option.isNone(globalConfig) && record.safeDirectory && Option.isSome(runnerTemp)) {
			const created = Effect.gen(function* () {
				const file = yield* temporaryGlobalConfig(yield* homeDirectory(env), runnerTemp.value);
				yield* git.configAdd(path.dirname(file), "safe.directory", record.repositoryPath, { file });
				return file;
			});
			fresh = yield* created.pipe(
				Effect.map(Option.some),
				Effect.catch((error) =>
					Effect.as(
						Effect.logWarning(`Failed to create a temporary global config for safe.directory: ${error.message}`),
						Option.none<string>(),
					),
				),
			);
			globalConfig = fresh;
		}

		yield* Option.match(globalConfig, {
			onNone: () => removeLayout(record, git),
			onSome: (file) => Git.withRunOptions(removeLayout(record, git), { env: { GIT_CONFIG_GLOBAL: file } }),
		});

		for (const file of [...Option.toArray(record.temporaryGlobalConfig), ...Option.toArray(fresh)]) {
			yield* removeUnderTemp(runnerTemp, "temporary global config", path.dirname(file), { recursive: true });
		}
	});
