// Real git and a real filesystem: checkout's credential layout written into a
// fresh repository, read back through git's own include resolution, then
// removed. Each test builds its own mkdtemp root (workspace, RUNNER_TEMP, HOME).

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import type { GitShape } from "@effected/git";
import { Git } from "@effected/git";
import { Effect, Layer, Option, Redacted } from "effect";
import { Base64 } from "effect/encoding";
import { ActionEnvironment } from "../../src/ActionEnvironment.js";
import { ActionOutputs } from "../../src/ActionOutputs.js";
import type { CheckoutAuth } from "../../src/Checkout.js";
import {
	CredentialRecord,
	configure,
	configureGlobalAuth,
	configureSubmodules,
	remove,
} from "../../src/internal/checkout/credentials.js";
import type { Settings } from "../../src/internal/checkout/settings.js";

const WINDOWS = process.platform === "win32";
const TOKEN = "ghs_0123456789abcdefTOKEN";
const BASIC = Base64.encode(`x-access-token:${TOKEN}`);
const FIXTURE_ENV = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "file" };

const fixtureGit = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], {
		cwd,
		env: FIXTURE_ENV,
		encoding: "utf8",
	});

interface Fixture {
	readonly root: string;
	readonly workspace: string;
	readonly repo: string;
	readonly runnerTemp: string;
	readonly home: string;
}

const roots: Array<string> = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const fixture = async (): Promise<Fixture> => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "checkout-credentials-")));
	roots.push(root);
	const workspace = join(root, "ws");
	const repo = join(workspace, "repo");
	const runnerTemp = join(root, "temp");
	const home = join(root, "home");
	for (const dir of [repo, runnerTemp, home]) await mkdir(dir, { recursive: true });
	fixtureGit(repo, ["init", "-q"]);
	return { root, workspace, repo, runnerTemp, home };
};

const settingsFor = (f: Fixture, over: Partial<Settings> = {}): Settings => ({
	owner: "own",
	name: "repo",
	path: f.repo,
	ref: "refs/heads/main",
	commit: "",
	isWorkflowRepository: true,
	clean: true,
	depth: 1,
	fetchTags: false,
	filter: Option.none(),
	sparse: Option.none(),
	lfs: false,
	submodules: false,
	nestedSubmodules: false,
	auth: { _tag: "Token", token: Redacted.make(TOKEN) },
	credentials: "job",
	safeDirectory: true,
	serverUrl: "https://github.com",
	remoteUrl: Option.none(),
	allowUnsafePrCheckout: false,
	stateKey: "effected-checkout",
	...over,
});

const layerFor = (f: Fixture, outputs: Layer.Layer<ActionOutputs>, env: Readonly<Record<string, string>> = {}) =>
	Layer.mergeAll(
		Git.layer,
		ActionEnvironment.layerTest(
			{
				RUNNER_TEMP: f.runnerTemp,
				GITHUB_WORKSPACE: f.workspace,
				HOME: f.home,
				RUNNER_OS: WINDOWS ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
				USERDOMAIN: process.env.USERDOMAIN ?? "",
				USERNAME: process.env.USERNAME ?? "",
				...env,
			},
			{ repository: { owner: { id: 4242 } } },
		),
		outputs,
		NodeCrypto.layerSecureRandom,
	).pipe(Layer.provideMerge(NodeServices.layer));

const localConfig = (repo: string) => readFile(join(repo, ".git", "config"), "utf8");

describe("configure and remove with a token", () => {
	it("keeps the token out of .git/config, serves it through the include, and removes every trace", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const masksAtFirstGit: Array<number> = [];
		const program = Effect.gen(function* () {
			const real = yield* Git;
			const git = new Proxy(real, {
				get: (target, key, receiver) => {
					const member = Reflect.get(target, key, receiver);
					return typeof member === "function"
						? (...args: Array<unknown>) => {
								masksAtFirstGit.push(recording.entries().length);
								return member(...args);
							}
						: member;
				},
			}) as GitShape;
			const { record, runEnv } = yield* configure(settingsFor(f), git);

			const config = yield* Effect.promise(() => localConfig(f.repo));
			assert.notInclude(config, TOKEN);
			assert.notInclude(config, BASIC);
			assert.include(config, "[includeIf");

			const credentialsFile = Option.getOrThrow(record.credentialsFile);
			assert.match(credentialsFile, /git-credentials-[0-9a-f-]{36}\.config$/);
			const credentials = yield* Effect.promise(() => readFile(credentialsFile, "utf8"));
			assert.include(credentials, '[http "https://github.com/"]');
			assert.include(credentials, `extraheader = AUTHORIZATION: basic ${BASIC}`);

			const header = yield* real.configGet(f.repo, "http.https://github.com/.extraheader");
			assert.deepStrictEqual(header, Option.some(`AUTHORIZATION: basic ${BASIC}`));

			const globalConfig = Option.getOrThrow(record.temporaryGlobalConfig);
			assert.strictEqual(runEnv.GIT_CONFIG_GLOBAL, globalConfig);
			assert.include(yield* Effect.promise(() => readFile(globalConfig, "utf8")), `[safe]\n\tdirectory = ${f.repo}`);

			yield* remove(record, real);

			const after = yield* Effect.promise(() => localConfig(f.repo));
			assert.notInclude(after, "includeIf");
			assert.notInclude(after, "extraheader");
			const gone = yield* Effect.promise(() =>
				stat(credentialsFile).then(
					() => false,
					() => true,
				),
			);
			assert.isTrue(gone);
			const globalGone = yield* Effect.promise(() =>
				stat(globalConfig).then(
					() => false,
					() => true,
				),
			);
			assert.isTrue(globalGone);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));

		const secrets = recording
			.entries()
			.filter((entry) => entry.member === "setSecret")
			.map((entry) => entry.value);
		assert.include(secrets, TOKEN);
		assert.include(secrets, BASIC);
		assert.isAtLeast(masksAtFirstGit[0] ?? 0, 2);
	});

	it("remove never fails, even for a repository that no longer exists", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			const { record } = yield* configure(settingsFor(f), git);
			yield* Effect.promise(() => rm(f.repo, { recursive: true, force: true }));
			yield* remove(record, git);
			const gone = yield* Effect.promise(() =>
				stat(Option.getOrThrow(record.credentialsFile)).then(
					() => false,
					() => true,
				),
			);
			assert.isTrue(gone);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));
	});
});

describe("configure with an SSH key", () => {
	const ssh: CheckoutAuth = { _tag: "Ssh", key: Redacted.make("-----KEY-----\n") };

	it("writes a 0600 key, checkout's known hosts and core.sshCommand under job", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			const { record, runEnv } = yield* configure(settingsFor(f, { auth: ssh }), git);
			const keyPath = Option.getOrThrow(record.sshKeyPath);
			const knownHostsPath = Option.getOrThrow(record.knownHostsPath);
			assert.strictEqual(yield* Effect.promise(() => readFile(keyPath, "utf8")), "-----KEY-----\n");
			if (!WINDOWS) {
				const { mode } = yield* Effect.promise(() => stat(keyPath));
				assert.strictEqual(mode & 0o777, 0o600);
			}
			const knownHosts = yield* Effect.promise(() => readFile(knownHostsPath, "utf8"));
			assert.include(knownHosts, "# Begin implicitly added github.com\ngithub.com ssh-rsa AAAAB3NzaC1yc2E");
			assert.include(runEnv.GIT_SSH_COMMAND ?? "", "-o StrictHostKeyChecking=yes -o CheckHostIP=no");
			assert.include(runEnv.GIT_SSH_COMMAND ?? "", "UserKnownHostsFile=");
			assert.isTrue(Option.isNone(record.credentialsFile));
			const sshCommand = yield* git.configGet(f.repo, "core.sshCommand", { scope: "local" });
			assert.isTrue(Option.isSome(sshCommand));

			yield* remove(record, git);
			assert.isTrue(Option.isNone(yield* git.configGet(f.repo, "core.sshCommand", { scope: "local" })));
			const keyGone = yield* Effect.promise(() =>
				stat(keyPath).then(
					() => false,
					() => true,
				),
			);
			assert.isTrue(keyGone);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));
	});

	it("runs and persists ssh by its absolute path from PATH, quoted, as checkout does", async () => {
		const f = await fixture();
		const empty = join(f.root, "empty-bin");
		const bin = join(f.root, "my bin");
		await mkdir(empty, { recursive: true });
		await mkdir(bin, { recursive: true });
		const program = join(bin, WINDOWS ? "ssh.exe" : "ssh");
		await writeFile(program, "");
		const recording = ActionOutputs.recording();
		const run = Effect.gen(function* () {
			const git = yield* Git;
			const { record, runEnv } = yield* configure(settingsFor(f, { auth: ssh }), git);
			const id = basename(Option.getOrThrow(record.sshKeyPath));
			assert.isTrue((runEnv.GIT_SSH_COMMAND ?? "").startsWith(`"${program}" -i "`), runEnv.GIT_SSH_COMMAND);
			const persisted = yield* git.configGet(f.repo, "core.sshCommand", { scope: "local" });
			assert.deepStrictEqual(
				persisted,
				Option.some(
					`"${program}" -i "$RUNNER_TEMP/${id}" -o StrictHostKeyChecking=yes -o CheckHostIP=no -o "UserKnownHostsFile=$RUNNER_TEMP/${id}_known_hosts"`,
				),
			);
			yield* remove(record, git);
		});
		const delimiter = WINDOWS ? ";" : ":";
		await Effect.runPromise(
			run.pipe(Effect.provide(layerFor(f, recording.layer, { PATH: [empty, bin].join(delimiter) }))),
		);
	});

	it("falls back to a bare ssh when PATH has none", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const run = Effect.gen(function* () {
			const git = yield* Git;
			const { record, runEnv } = yield* configure(settingsFor(f, { auth: ssh }), git);
			assert.isTrue((runEnv.GIT_SSH_COMMAND ?? "").startsWith('ssh -i "'), runEnv.GIT_SSH_COMMAND);
			const persisted = Option.getOrThrow(yield* git.configGet(f.repo, "core.sshCommand", { scope: "local" }));
			assert.isTrue(persisted.startsWith('ssh -i "$RUNNER_TEMP/'), persisted);
			yield* remove(record, git);
		});
		await Effect.runPromise(run.pipe(Effect.provide(layerFor(f, recording.layer, { PATH: join(f.root, "nothing") }))));
	});

	it("does not persist core.sshCommand under action", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			const { runEnv } = yield* configure(settingsFor(f, { auth: ssh, credentials: "action" }), git);
			assert.isDefined(runEnv.GIT_SSH_COMMAND);
			assert.isTrue(Option.isNone(yield* git.configGet(f.repo, "core.sshCommand", { scope: "local" })));
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));
	});
});

describe("submodules", () => {
	it("persists includeIf and insteadOf in each submodule and removes both", async () => {
		const f = await fixture();
		const library = join(f.root, "library");
		await mkdir(library);
		fixtureGit(library, ["init", "-q"]);
		await writeFile(join(library, "a.txt"), "a\n");
		fixtureGit(library, ["add", "a.txt"]);
		fixtureGit(library, ["commit", "-q", "-m", "a"]);
		fixtureGit(f.repo, ["submodule", "add", "-q", library, "sub"]);
		const subConfig = join(f.repo, ".git", "modules", "sub", "config");

		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			const settings = settingsFor(f, { submodules: true });
			const { record, runEnv } = yield* configure(settings, git);
			yield* configureGlobalAuth(settings, record, git);
			const globalConfig = yield* Effect.promise(() => readFile(runEnv.GIT_CONFIG_GLOBAL ?? "", "utf8"));
			assert.include(globalConfig, "insteadOf = git@github.com:");
			assert.include(globalConfig, "insteadOf = org-4242@github.com:");
			assert.include(globalConfig, Option.getOrThrow(record.credentialsFile));

			yield* configureSubmodules(settings, record, git);
			const configured = yield* Effect.promise(() => readFile(subConfig, "utf8"));
			assert.include(configured, "[includeIf");
			assert.include(configured, "insteadOf = git@github.com:");
			assert.notInclude(configured, BASIC);

			yield* remove(record, git);
			const removed = yield* Effect.promise(() => readFile(subConfig, "utf8"));
			assert.notInclude(removed, "includeIf");
			assert.notInclude(removed, "insteadOf");
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));
	});
});

describe("remove under a repository git may consider unsafe", () => {
	it("runs every git step with a fresh temporary global config holding safe.directory, then deletes it", async () => {
		const f = await fixture();
		const recording = ActionOutputs.recording();
		const observed: Array<boolean> = [];
		const program = Effect.gen(function* () {
			const real = yield* Git;
			const { record } = yield* configure(settingsFor(f), real);
			// The post step's record: the run's own temporary global config is already gone.
			yield* Effect.promise(() =>
				rm(dirname(Option.getOrThrow(record.temporaryGlobalConfig)), { recursive: true, force: true }),
			);
			const postRecord = CredentialRecord.make({ ...record, temporaryGlobalConfig: Option.none() });
			// Before each git step, ask git what global config it sees under the same ambient run options.
			const git = new Proxy(real, {
				get: (target, key, receiver) => {
					const member = Reflect.get(target, key, receiver);
					if (typeof member !== "function") return member;
					return (...args: Array<unknown>) =>
						// Only git steps in the repository: the fresh config's own `-f` write runs in RUNNER_TEMP.
						args[0] !== f.repo
							? member(...args)
							: Effect.andThen(
									// A failed probe (no global config to read) records `false` and never stops the step.
									Effect.map(
										Effect.orElseSucceed(target.configList(f.runnerTemp, { scope: "global" }), () => []),
										(entries) => {
											observed.push(entries.some((entry) => entry.key === "safe.directory" && entry.value === f.repo));
										},
									),
									member(...args),
								);
				},
			}) as GitShape;
			yield* remove(postRecord, git);

			assert.isAbove(observed.length, 0);
			assert.isTrue(observed.every(Boolean));
			const after = yield* Effect.promise(() => localConfig(f.repo));
			assert.notInclude(after, "includeIf");
			assert.deepStrictEqual(yield* Effect.promise(() => readdir(f.runnerTemp)), []);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));
	});
});

describe("remove deletes only what lies inside RUNNER_TEMP", () => {
	it("keeps a sibling sharing the prefix and a .. escape, for credentials, SSH files and the global config", async () => {
		const f = await fixture();
		const sibling = `${f.runnerTemp}-other`;
		const outside = join(f.root, "outside");
		for (const dir of [sibling, outside, join(outside, "cfg")]) await mkdir(dir, { recursive: true });
		const siblingFile = join(sibling, "git-credentials-1111.config");
		const escapeFile = join(outside, "git-credentials-2222.config");
		const escapeKey = join(outside, "key");
		const escapeHosts = join(outside, "key_known_hosts");
		const escapeGlobal = join(outside, "cfg", ".gitconfig");
		for (const file of [siblingFile, escapeFile, escapeKey, escapeHosts, escapeGlobal]) await writeFile(file, "x\n");
		const viaDotDot = (file: string) => join(f.runnerTemp, "..", "outside", file);

		// A stale includeIf naming the sibling-prefix file, as an earlier run might have left.
		fixtureGit(f.repo, ["config", "includeIf.gitdir:/elsewhere/.git.path", siblingFile]);

		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			const record = CredentialRecord.make({
				repositoryPath: f.repo,
				origin: "https://github.com",
				credentialsFile: Option.some(`${f.runnerTemp}/../outside/git-credentials-2222.config`),
				sshKeyPath: Option.some(viaDotDot("key")),
				knownHostsPath: Option.some(viaDotDot("key_known_hosts")),
				temporaryGlobalConfig: Option.some(viaDotDot(join("cfg", ".gitconfig"))),
				safeDirectory: false,
				submodules: false,
			});
			yield* remove(record, git);
			assert.notInclude(yield* Effect.promise(() => localConfig(f.repo)), "includeIf");
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));

		for (const file of [siblingFile, escapeFile, escapeKey, escapeHosts, escapeGlobal]) {
			assert.isTrue(
				await stat(file).then(
					() => true,
					() => false,
				),
				`${file} must survive`,
			);
		}
	});
});

describe("configure's pre-cleanup", () => {
	it("cleans a stale submodule layout from an earlier run even when this checkout has no submodules", async () => {
		const f = await fixture();
		const library = join(f.root, "library");
		await mkdir(library);
		fixtureGit(library, ["init", "-q"]);
		await writeFile(join(library, "a.txt"), "a\n");
		fixtureGit(library, ["add", "a.txt"]);
		fixtureGit(library, ["commit", "-q", "-m", "a"]);
		fixtureGit(f.repo, ["submodule", "add", "-q", library, "sub"]);
		const subConfig = join(f.repo, ".git", "modules", "sub", "config");
		fixtureGit(f.repo, [
			"config",
			"-f",
			subConfig,
			"includeIf.gitdir:/old/.git.path",
			"/old/git-credentials-1234.config",
		]);
		fixtureGit(f.repo, ["config", "-f", subConfig, "core.sshCommand", "ssh -i old"]);

		const recording = ActionOutputs.recording();
		const program = Effect.gen(function* () {
			const git = yield* Git;
			yield* configure(settingsFor(f, { submodules: false }), git);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerFor(f, recording.layer))));

		const cleaned = await readFile(subConfig, "utf8");
		assert.notInclude(cleaned, "includeIf");
		assert.notInclude(cleaned, "sshCommand");
	});
});
