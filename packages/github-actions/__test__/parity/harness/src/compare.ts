import { Effect, FileSystem, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** What two checkouts must agree on, with everything that legitimately differs normalised out. */
export interface Snapshot {
	readonly head: string;
	readonly refs: ReadonlyArray<string>;
	readonly config: ReadonlyArray<string>;
	readonly credentials: string;
	readonly files: ReadonlyArray<string>;
}

const forward = (value: string): string => value.replace(/\\/g, "/");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const lines = (value: string): ReadonlyArray<string> => value.split(/\r?\n/).filter((line) => line.length > 0);

/** The credentials file's name carries a UUID that differs per run. */
const CREDENTIALS_NAME = /git-credentials-[0-9a-f-]+/gi;

/**
 * The `ssh` program's path and the key and known-hosts paths differ by runner and temp directory, so only the quoted
 * path text is normalised: a bare `ssh` against checkout's quoted absolute one is still a difference.
 */
const normaliseSsh = (value: string): string =>
	value.replace(/^core\.sshcommand=.*$/i, (line) => line.replace(/"[^"]*"/g, '"<path>"'));

/**
 * Normalises a checkout's local config. The host directory becomes `<dir>`; with the checkout's workspace-relative
 * path, the container form of it (`/github/workspace/<relative>`, in the `includeIf` keys a container job reads) becomes
 * `<container-dir>`, so two checkouts in differently named directories compare equal.
 */
const normaliseConfig = (raw: string, dir: string, relative?: string): ReadonlyArray<string> => {
	const dirPattern = new RegExp(escapeRegExp(forward(dir)), "gi");
	const containerPattern =
		relative === undefined
			? undefined
			: new RegExp(
					`${escapeRegExp(`/github/workspace/${forward(relative).replace(/^\.\/|\/$/g, "")}`)}(?=/|\\.path|$)`,
					"gi",
				);
	return lines(forward(raw))
		.map((line) =>
			normaliseSsh(
				(containerPattern === undefined ? line : line.replace(containerPattern, "<container-dir>"))
					.replace(dirPattern, "<dir>")
					.replace(CREDENTIALS_NAME, "git-credentials-<id>")
					// A token left in the config must never reach the step summary.
					.replace(/(basic\s+)[A-Za-z0-9+/=]+/gi, "$1<token>"),
			),
		)
		.sort();
};

/**
 * Collects a checkout's HEAD, refs, normalised local config, redacted credentials and working tree files. `relative`
 * is the checkout's path relative to the workspace, which names it in the container `includeIf` keys.
 */
export const snapshot = (
	dir: string,
	relative?: string,
): Effect.Effect<Snapshot, unknown, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const git = (args: ReadonlyArray<string>) => spawner.string(ChildProcess.make("git", [...args], { cwd: dir }));

		const head = (yield* git(["rev-parse", "HEAD"])).trim();
		const refs = lines(yield* git(["for-each-ref", "--format=%(refname) %(objectname)"]));
		const rawConfig = yield* git(["config", "--local", "--list"]);
		const config = normaliseConfig(rawConfig, dir, relative);

		// The credentials file is named by the `includeIf` key, so the value is read back from the config.
		const include = lines(rawConfig).find((line) => /^includeif\.gitdir:.*\.path=/i.test(line));
		const credentialsPath =
			include === undefined ? undefined : include.slice(include.indexOf(".path=") + ".path=".length);
		const credentials =
			credentialsPath === undefined
				? "<none>"
				: yield* fs.readFileString(credentialsPath).pipe(
						Effect.map((text) => text.replace(/(basic\s+)[A-Za-z0-9+/=]+/g, "$1<token>")),
						Effect.catch(() => Effect.succeed("<unreadable>")),
					);

		const files: Array<string> = [];
		const walk = (relative: string): Effect.Effect<void, unknown> =>
			Effect.gen(function* () {
				const entries = yield* fs.readDirectory(relative === "" ? dir : path.join(dir, relative));
				for (const name of entries) {
					if (name === ".git") continue;
					const child = relative === "" ? name : `${relative}/${name}`;
					const info = yield* fs.stat(path.join(dir, child));
					if (info.type === "Directory") yield* walk(child);
					else files.push(child);
				}
			});
		yield* walk("");

		return { head, refs, config, credentials, files: files.sort() };
	});

/** What differs between two snapshots, one line each; empty when they agree. */
export const diff = (a: Snapshot, b: Snapshot): ReadonlyArray<string> => {
	const out: Array<string> = [];
	if (a.head !== b.head) out.push(`HEAD: ${a.head} != ${b.head}`);
	if (a.credentials !== b.credentials)
		out.push(`credentials: ${JSON.stringify(a.credentials)} != ${JSON.stringify(b.credentials)}`);
	const set = (label: string, left: ReadonlyArray<string>, right: ReadonlyArray<string>) => {
		const l = new Set(left);
		const r = new Set(right);
		for (const item of left) if (!r.has(item)) out.push(`${label}: only in official: ${item}`);
		for (const item of right) if (!l.has(item)) out.push(`${label}: only in kit: ${item}`);
	};
	set("refs", a.refs, b.refs);
	set("config", a.config, b.config);
	set("files", a.files, b.files);
	return out;
};

/** What a checkout leaves in its repository and submodules once its own cleanup has run. */
export interface CleanSnapshot {
	/** Each repository's normalised local config: `.` for the checkout itself, a submodule's display path otherwise. */
	readonly configs: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** The config a checkout writes for credentials, all of which its cleanup must remove. */
const CREDENTIAL_KEY = /^(?:includeif\.[^=]*|http\.[^=]*\.extraheader|core\.sshcommand|url\.[^=]*\.insteadof)=/i;

/** A credentials file, an SSH key, its known-hosts file or a temporary global config's directory under `RUNNER_TEMP`. */
const CREDENTIAL_TEMP =
	/^(?:git-credentials-[0-9a-f-]+\.config|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_known_hosts)?)$/i;

/**
 * Collects the normalised local config of a cleaned-up checkout and of every submodule it checked out, recursively.
 * `relative` is as {@link snapshot} takes it.
 */
export const cleanSnapshot = (
	dir: string,
	relative?: string,
): Effect.Effect<CleanSnapshot, unknown, ChildProcessSpawner.ChildProcessSpawner | Path.Path> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const path = yield* Path.Path;
		const git = (cwd: string, args: ReadonlyArray<string>) =>
			spawner.string(ChildProcess.make("git", [...args], { cwd }));
		// `git config --list` exits 1 on a config with no entries: an emptied submodule config is clean, not an error.
		const config = (cwd: string) =>
			git(cwd, ["config", "--local", "--list"]).pipe(Effect.catch(() => Effect.succeed("")));

		const configs: Record<string, ReadonlyArray<string>> = { ".": normaliseConfig(yield* config(dir), dir, relative) };
		const submodules = lines(
			yield* git(dir, ["submodule", "foreach", "--quiet", "--recursive", 'echo "$displaypath"']),
		);
		for (const sub of submodules) {
			const subDir = path.join(dir, sub);
			configs[forward(sub)] = normaliseConfig(yield* config(subDir), subDir);
		}
		return { configs };
	});

/** A submodule's SSH-to-HTTPS rewrite: the stock post step never removes it, and the kit's cleanup does. */
const SUBMODULE_INSTEADOF = /^url\.[^=]*\.insteadof=/i;

/**
 * Splits the stock action's cleaned-up snapshot into what it is held to and the one leftover it is known to leave: the
 * `url.<origin>/.insteadOf` values it writes into each submodule's config, which its post step never unsets. The kit
 * removes them, so the kit's snapshot is never split; every other leftover, on either side, still fails.
 */
export const withoutStockLeftovers = (
	clean: CleanSnapshot,
): { readonly held: CleanSnapshot; readonly exempt: ReadonlyArray<string> } => {
	const configs: Record<string, ReadonlyArray<string>> = {};
	const exempt: Array<string> = [];
	for (const [repo, config] of Object.entries(clean.configs)) {
		if (repo === ".") {
			configs[repo] = config;
			continue;
		}
		configs[repo] = config.filter((line) => !SUBMODULE_INSTEADOF.test(line));
		for (const line of config) if (SUBMODULE_INSTEADOF.test(line)) exempt.push(`official ${repo}: ${line}`);
	}
	return { held: { configs }, exempt };
};

/** The credential config a cleaned-up checkout still holds, one line each, labelled with its repository. */
export const credentialLeftovers = (label: string, clean: CleanSnapshot): ReadonlyArray<string> =>
	Object.entries(clean.configs).flatMap(([repo, config]) =>
		config.filter((line) => CREDENTIAL_KEY.test(line)).map((line) => `${label} ${repo}: ${line}`),
	);

/** The credential material still under `RUNNER_TEMP`, by name. */
export const tempLeftovers = (
	runnerTemp: string,
): Effect.Effect<ReadonlyArray<string>, unknown, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return (yield* fs.readDirectory(runnerTemp)).filter((name) => CREDENTIAL_TEMP.test(name)).sort();
	});

/** What differs between two cleaned-up checkouts, one line each; empty when they agree. */
export const diffClean = (a: CleanSnapshot, b: CleanSnapshot): ReadonlyArray<string> => {
	const out: Array<string> = [];
	const repos = [...new Set([...Object.keys(a.configs), ...Object.keys(b.configs)])].sort();
	for (const repo of repos) {
		const left = a.configs[repo];
		const right = b.configs[repo];
		if (left === undefined) {
			out.push(`repositories: only in kit: ${repo}`);
			continue;
		}
		if (right === undefined) {
			out.push(`repositories: only in official: ${repo}`);
			continue;
		}
		const l = new Set(left);
		const r = new Set(right);
		for (const item of left) if (!r.has(item)) out.push(`config ${repo}: only in official: ${item}`);
		for (const item of right) if (!l.has(item)) out.push(`config ${repo}: only in kit: ${item}`);
	}
	return out;
};
