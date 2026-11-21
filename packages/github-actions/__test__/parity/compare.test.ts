// The parity harness's comparator, over real git: two checkouts of one `file://` remote into
// differently named directories, each with a credentials file of its own UUID, must snapshot
// equal; one changed `.git/config` key must be named by `diff`.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Option } from "effect";
import { ActionState } from "../../src/ActionState.js";
import { CredentialRecord } from "../../src/internal/checkout/credentials.js";
import { cleanSnapshot, credentialLeftovers, diff, diffClean, snapshot, tempLeftovers } from "./harness/src/compare.js";
import { fromFile, teeing } from "./harness/src/record.js";

const ENV = { ...process.env, LC_ALL: "C", GIT_ALLOW_PROTOCOL: "file" };
const git = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"-c",
			"init.defaultBranch=main",
			"-c",
			"protocol.file.allow=always",
			...args,
		],
		{ cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();

let root: string;
let remote: string;
let withSubRemote: string;

beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "parity-compare-")));
	const work = join(root, "work");
	await mkdir(work, { recursive: true });
	git(work, ["init", "-q"]);
	await writeFile(join(work, "README.md"), "readme\n");
	git(work, ["add", "."]);
	git(work, ["commit", "-q", "-m", "first"]);
	git(work, ["tag", "-a", "v1", "-m", "v1"]);
	remote = join(root, "remote.git");
	git(root, ["clone", "-q", "--bare", work, remote]);

	// A superproject with one submodule, for the clean comparison's submodule walk.
	const superWork = join(root, "super-work");
	await mkdir(superWork, { recursive: true });
	git(superWork, ["init", "-q"]);
	git(superWork, ["submodule", "add", "-q", `file://${remote}`, "lib"]);
	git(superWork, ["commit", "-q", "-m", "add lib"]);
	withSubRemote = join(root, "super.git");
	git(root, ["clone", "-q", "--bare", superWork, withSubRemote]);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A checkout in `name/` with a credentials file `git-credentials-<id>.config` wired by `includeIf`. */
const checkout = async (name: string, id: string, token: string): Promise<string> => {
	const dir = join(root, name);
	git(root, ["clone", "-q", `file://${remote}`, dir]);
	const creds = join(root, `git-credentials-${id}.config`);
	const header = Buffer.from(`x-access-token:${token}`).toString("base64");
	await writeFile(creds, `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${header}\n`);
	git(dir, ["config", "--local", `includeIf.gitdir:${join(dir, ".git")}/.path`, creds]);
	git(dir, ["config", "--local", "core.sshCommand", `ssh -i "${join(root, `git-credentials-${id}`)}"`]);
	return dir;
};

describe("parity comparator", () => {
	it.effect("snapshots two checkouts of one remote equal despite directory names, UUIDs and tokens", () =>
		Effect.gen(function* () {
			const a = yield* Effect.promise(() =>
				checkout("official", "11111111-1111-1111-1111-111111111111", "ghs_aaaaaaaaaaaa"),
			);
			const b = yield* Effect.promise(() =>
				checkout("kit", "22222222-2222-2222-2222-222222222222", "ghs_bbbbbbbbbbbb"),
			);
			const [sa, sb] = [yield* snapshot(a), yield* snapshot(b)];
			assert.deepStrictEqual(diff(sa, sb), []);
			assert.isTrue(sa.credentials.includes("<token>"));
			assert.isFalse(sa.credentials.includes("ghs_"));
			assert.isTrue(sa.files.includes("README.md"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("normalises the container includeIf keys, which name each checkout's workspace-relative path", () =>
		Effect.gen(function* () {
			const withContainerKeys = async (name: string, id: string) => {
				const dir = await checkout(name, id, "ghs_c");
				const creds = `/github/runner_temp/git-credentials-${id}.config`;
				git(dir, ["config", "--local", `includeIf.gitdir:/github/workspace/${name}/.git.path`, creds]);
				git(dir, ["config", "--local", `includeIf.gitdir:/github/workspace/${name}/.git/worktrees/*.path`, creds]);
				return dir;
			};
			const official = yield* Effect.promise(() =>
				withContainerKeys("c-official", "99999999-9999-9999-9999-999999999999"),
			);
			const kit = yield* Effect.promise(() => withContainerKeys("c-kit", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
			const a = yield* snapshot(official, "c-official");
			const b = yield* snapshot(kit, "c-kit");
			assert.deepStrictEqual(diff(a, b), []);
			assert.isTrue(
				a.config.some((line) => line.includes("gitdir:<container-dir>/.git/worktrees/*.path")),
				JSON.stringify(a.config),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("names a changed config key", () =>
		Effect.gen(function* () {
			const a = yield* Effect.promise(() => checkout("a2", "33333333-3333-3333-3333-333333333333", "ghs_x"));
			const b = yield* Effect.promise(() => checkout("b2", "44444444-4444-4444-4444-444444444444", "ghs_x"));
			git(b, ["config", "--local", "core.autocrlf", "true"]);
			const lines = diff(yield* snapshot(a), yield* snapshot(b));
			assert.isTrue(lines.some((line) => line.includes("core.autocrlf")));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("normalises the ssh program's path but reports a bare ssh against an absolute one", () =>
		Effect.gen(function* () {
			const a = yield* Effect.promise(() => checkout("ssh-a", "66666666-6666-6666-6666-666666666666", "ghs_z"));
			const b = yield* Effect.promise(() => checkout("ssh-b", "77777777-7777-7777-7777-777777777777", "ghs_z"));
			const c = yield* Effect.promise(() => checkout("ssh-c", "88888888-8888-8888-8888-888888888888", "ghs_z"));
			git(a, ["config", "--local", "core.sshCommand", '"/usr/bin/ssh" -i "$RUNNER_TEMP/a"']);
			git(b, ["config", "--local", "core.sshCommand", '"C:/Program Files/Git/usr/bin/ssh.exe" -i "$RUNNER_TEMP/b"']);
			assert.deepStrictEqual(diff(yield* snapshot(a), yield* snapshot(b)), []);
			// Bare against quoted absolute, and bare against an unquoted absolute path.
			git(c, ["config", "--local", "core.sshCommand", 'ssh -i "$RUNNER_TEMP/c"']);
			const bare = yield* snapshot(c);
			assert.isTrue(diff(yield* snapshot(a), bare).some((line) => line.toLowerCase().includes("core.sshcommand")));
			git(c, ["config", "--local", "core.sshCommand", '/usr/bin/ssh -i "$RUNNER_TEMP/c"']);
			const lines = diff(bare, yield* snapshot(c));
			assert.isTrue(
				lines.some((line) => line.toLowerCase().includes("core.sshcommand")),
				JSON.stringify(lines),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("redacts an extraheader token left in the local config", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => checkout("leak", "55555555-5555-5555-5555-555555555555", "ghs_y"));
			const header = Buffer.from("x-access-token:ghs_leaked").toString("base64");
			git(dir, ["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${header}`]);
			const snap = yield* snapshot(dir);
			const text = snap.config.join("\n");
			assert.isTrue(text.includes("basic <token>"));
			assert.isFalse(text.includes(header));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

/** A clone of the superproject in `name/`, its submodule checked out. */
const withSubmodule = (name: string): string => {
	const dir = join(root, name);
	git(root, ["clone", "-q", "--recurse-submodules", `file://${withSubRemote}`, dir]);
	return dir;
};

describe("parity comparator after cleanup", () => {
	it.effect("snapshots two cleaned checkouts with submodules equal and finds no leftovers", () =>
		Effect.gen(function* () {
			const a = yield* cleanSnapshot(withSubmodule("clean-official"));
			const b = yield* cleanSnapshot(withSubmodule("clean-kit"));
			assert.deepStrictEqual(Object.keys(b.configs).sort(), [".", "lib"]);
			assert.deepStrictEqual(diffClean(a, b), []);
			assert.deepStrictEqual(credentialLeftovers("kit", b), []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("names credential config left in the repository or a submodule, and the side that left it", () =>
		Effect.gen(function* () {
			const official = withSubmodule("left-official");
			const kit = withSubmodule("left-kit");
			const header = Buffer.from("x-access-token:ghs_left").toString("base64");
			git(kit, [
				"config",
				"--local",
				`includeIf.gitdir:${join(kit, ".git")}.path`,
				join(root, "git-credentials-x.config"),
			]);
			git(join(kit, "lib"), ["config", "--local", "url.https://github.com/.insteadOf", "git@github.com:"]);
			git(join(kit, "lib"), [
				"config",
				"--local",
				"http.https://github.com/.extraheader",
				`AUTHORIZATION: basic ${header}`,
			]);
			git(join(kit, "lib"), ["config", "--local", "core.sshCommand", 'ssh -i "$RUNNER_TEMP/k"']);
			const a = yield* cleanSnapshot(official);
			const b = yield* cleanSnapshot(kit);
			const leftovers = credentialLeftovers("kit", b);
			assert.strictEqual(leftovers.length, 4, JSON.stringify(leftovers));
			assert.isTrue(leftovers.some((line) => line.startsWith("kit .: includeif.gitdir:")));
			assert.isTrue(leftovers.some((line) => line.startsWith("kit lib: url.https://github.com/.insteadof=")));
			assert.isTrue(leftovers.some((line) => line.startsWith("kit lib: core.sshcommand=")));
			// The token never reaches a line bound for the summary.
			assert.isFalse(leftovers.join("\n").includes(header));
			assert.deepStrictEqual(credentialLeftovers("official", a), []);
			const lines = diffClean(a, b);
			assert.isTrue(lines.some((line) => line.startsWith("config lib: only in kit: url.")));
			assert.isTrue(lines.some((line) => line.startsWith("config .: only in kit: includeif.")));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("names a submodule only one side checked out", () =>
		Effect.gen(function* () {
			const a = yield* cleanSnapshot(withSubmodule("sub-official"));
			const plain = join(root, "sub-kit");
			git(root, ["clone", "-q", `file://${withSubRemote}`, plain]);
			const lines = diffClean(a, yield* cleanSnapshot(plain));
			assert.include(lines, "repositories: only in official: lib");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("parity RUNNER_TEMP leftovers", () => {
	const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
	it.effect("names credentials files, SSH keys, known hosts and temporary homes, not the runner's step scripts", () =>
		tempLeftovers("/temp").pipe(
			Effect.map((names) =>
				assert.deepStrictEqual(names, [ID, `${ID}_known_hosts`, `git-credentials-${ID}.config`].sort()),
			),
			Effect.provide(
				MemoryFileSystem.layerWith({
					[`/temp/git-credentials-${ID}.config`]: "",
					[`/temp/${ID}`]: "key",
					[`/temp/${ID}_known_hosts`]: "",
					[`/temp/${ID}.sh`]: "echo",
					"/temp/effected-parity-state.json": "{}",
					"/temp/_runner_file_commands/set_output": "",
				}),
			),
		),
	);
});

describe("parity state record", () => {
	const record = CredentialRecord.make({
		repositoryPath: "/ws/kit",
		origin: "https://github.com",
		credentialsFile: Option.some("/temp/git-credentials-1.config"),
		sshKeyPath: Option.none(),
		knownHostsPath: Option.none(),
		temporaryGlobalConfig: Option.none(),
		safeDirectory: true,
		submodules: false,
	});

	it.effect("reads back what the checkout step saved, as the post entry would", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const saved: Array<string> = [];
			const real = ActionState.makeTest({ save: (key) => Effect.sync(() => void saved.push(key)) });
			yield* teeing(real, fs, "/temp/state.json").save("effected-checkout", record, CredentialRecord);
			assert.deepStrictEqual(saved, ["effected-checkout"]);
			const state = fromFile(fs, "/temp/state.json");
			const read = yield* state.getOptional("effected-checkout", CredentialRecord);
			assert.deepStrictEqual(read, Option.some(record));
			assert.isTrue(Option.isNone(yield* state.getOptional("other", CredentialRecord)));
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "/temp": MemoryFileSystem.directory() }))),
	);

	it.effect("reads nothing when the checkout step saved nothing", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const read = yield* fromFile(fs, "/temp/absent.json").getOptional("effected-checkout", CredentialRecord);
			assert.isTrue(Option.isNone(read));
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "/temp": MemoryFileSystem.directory() }))),
	);
});
