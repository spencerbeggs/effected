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

/** The `ssh` program's path and the key and known-hosts paths differ by runner and temp directory. */
const normaliseSsh = (value: string): string =>
	value.replace(/^core\.sshcommand=.*$/i, (line) =>
		line.replace(/"[^"]*"/g, '"<path>"').replace(/^core\.sshcommand=\S*ssh(\.exe)?\b/i, "core.sshcommand=ssh"),
	);

const normaliseConfig = (raw: string, dir: string): ReadonlyArray<string> => {
	const dirPattern = new RegExp(escapeRegExp(forward(dir)), "gi");
	return lines(forward(raw))
		.map((line) =>
			normaliseSsh(
				line
					.replace(dirPattern, "<dir>")
					.replace(CREDENTIALS_NAME, "git-credentials-<id>")
					// A token left in the config must never reach the step summary.
					.replace(/(basic\s+)[A-Za-z0-9+/=]+/gi, "$1<token>"),
			),
		)
		.sort();
};

/** Collects a checkout's HEAD, refs, normalised local config, redacted credentials and working tree files. */
export const snapshot = (
	dir: string,
): Effect.Effect<Snapshot, unknown, ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const git = (args: ReadonlyArray<string>) => spawner.string(ChildProcess.make("git", [...args], { cwd: dir }));

		const head = (yield* git(["rev-parse", "HEAD"])).trim();
		const refs = lines(yield* git(["for-each-ref", "--format=%(refname) %(objectname)"]));
		const rawConfig = yield* git(["config", "--local", "--list"]);
		const config = normaliseConfig(rawConfig, dir);

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
