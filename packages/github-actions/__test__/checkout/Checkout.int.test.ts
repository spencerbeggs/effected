// Real git and a real filesystem: the whole checkout sequence against local
// `file://` bare remotes. The remotes are built once; every test checks out
// into its own mkdtemp workspace with its own RUNNER_TEMP and HOME.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, afterEach, assert, beforeAll, describe, it } from "@effect/vitest";
import type { GitShape } from "@effected/git";
import { Git, GitCommandError } from "@effected/git";
import type { GitHubClientShape } from "@effected/github";
import { GitHubClient, GitHubError } from "@effected/github";
import type { Duration } from "effect";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Redacted, Schedule } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { ActionEnvironment } from "../../src/ActionEnvironment.js";
import { ActionLogger } from "../../src/ActionLogger.js";
import { ActionOutputs } from "../../src/ActionOutputs.js";
import { ActionState, ActionStateError } from "../../src/ActionState.js";
import type { CheckoutDefaultBranchError, CheckoutOptions } from "../../src/Checkout.js";
import { Checkout } from "../../src/Checkout.js";
import { CredentialRecord } from "../../src/internal/checkout/credentials.js";
import { CheckoutApiClient, CheckoutRetry } from "../../src/internal/checkout/source.js";

// git 2.38+ refuses a `file://` submodule remote unless the environment allows it. `Git` spawns over the
// process environment, so this reaches every spawn in this file; it is restored when the file ends.
let previousAllowProtocol: string | undefined;
beforeAll(() => {
	previousAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
	process.env.GIT_ALLOW_PROTOCOL = "file";
});
afterAll(() => {
	if (previousAllowProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
	else process.env.GIT_ALLOW_PROTOCOL = previousAllowProtocol;
});

const WINDOWS = process.platform === "win32";
const TOKEN = "ghs_0123456789abcdefTOKEN";
const FIXTURE_ENV = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "file" };

const fixtureGit = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"-c",
			"protocol.file.allow=always",
			"-c",
			"init.defaultBranch=main",
			// Some fixture steps run inside a bare repository, which `safe.bareRepository=explicit` refuses.
			"-c",
			"safe.bareRepository=all",
			...args,
		],
		{ cwd, env: FIXTURE_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();

interface Remotes {
	readonly root: string;
	readonly url: string;
	readonly otherUrl: string;
	readonly first: string;
	readonly second: string;
	readonly feature: string;
	readonly pull: string;
	readonly withSub: string;
	readonly libTip: string;
}

let remotes: Remotes;

beforeAll(async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "checkout-remotes-")));
	const commit = async (repo: string, file: string, content: string, message: string) => {
		await mkdir(join(repo, file, ".."), { recursive: true });
		await writeFile(join(repo, file), content);
		fixtureGit(repo, ["add", "--", file]);
		fixtureGit(repo, ["commit", "-q", "-m", message]);
		return fixtureGit(repo, ["rev-parse", "HEAD"]);
	};

	// The submodule's remote.
	const libWork = join(root, "lib-work");
	await mkdir(libWork, { recursive: true });
	fixtureGit(libWork, ["init", "-q"]);
	const libTip = await commit(libWork, "lib.txt", "lib\n", "lib");
	const libBare = join(root, "lib.git");
	fixtureGit(root, ["clone", "-q", "--bare", libWork, libBare]);

	const work = join(root, "work");
	await mkdir(work, { recursive: true });
	fixtureGit(work, ["init", "-q"]);
	await writeFile(join(work, "README.md"), "readme\n");
	await mkdir(join(work, "src"), { recursive: true });
	await writeFile(join(work, "src", "a.txt"), "a\n");
	await mkdir(join(work, "docs"), { recursive: true });
	await writeFile(join(work, "docs", "b.txt"), "b\n");
	fixtureGit(work, ["add", "."]);
	fixtureGit(work, ["commit", "-q", "-m", "first"]);
	const first = fixtureGit(work, ["rev-parse", "HEAD"]);
	fixtureGit(work, ["tag", "-a", "v1", "-m", "v1"]);

	fixtureGit(work, ["checkout", "-q", "-b", "feature/x"]);
	const feature = await commit(work, "feature.txt", "feature\n", "feature");
	fixtureGit(work, ["checkout", "-q", "main"]);

	fixtureGit(work, ["checkout", "-q", "-b", "pr"]);
	const pull = await commit(work, "pr.txt", "pr\n", "Merge pr into main");
	fixtureGit(work, ["checkout", "-q", "main"]);

	fixtureGit(work, ["checkout", "-q", "-b", "with-sub"]);
	fixtureGit(work, ["submodule", "add", "-q", `file://${libBare}`, "lib"]);
	fixtureGit(work, ["commit", "-q", "-m", "add submodule"]);
	const withSub = fixtureGit(work, ["rev-parse", "HEAD"]);
	fixtureGit(work, ["checkout", "-q", "main"]);

	const second = await commit(work, "second.txt", "second\n", "second");

	const bare = join(root, "remote.git");
	fixtureGit(root, ["clone", "-q", "--bare", work, bare]);
	fixtureGit(bare, ["update-ref", "refs/pull/1/merge", pull]);
	fixtureGit(bare, ["config", "uploadpack.allowFilter", "true"]);

	const otherWork = join(root, "other-work");
	await mkdir(otherWork, { recursive: true });
	fixtureGit(otherWork, ["init", "-q"]);
	await commit(otherWork, "other.txt", "other\n", "other");
	const otherBare = join(root, "other.git");
	fixtureGit(root, ["clone", "-q", "--bare", otherWork, otherBare]);
	// A wiki's default branch is master when the API cannot find the wiki; the remote's HEAD names it too.
	fixtureGit(otherBare, ["update-ref", "refs/heads/master", "refs/heads/main"]);
	fixtureGit(otherBare, ["symbolic-ref", "HEAD", "refs/heads/master"]);

	remotes = {
		root,
		url: `file://${bare}`,
		otherUrl: `file://${otherBare}`,
		first,
		second,
		feature,
		pull,
		withSub,
		libTip,
	};
});

afterAll(async () => {
	await rm(remotes.root, { recursive: true, force: true });
});

interface Workspace {
	readonly root: string;
	readonly workspace: string;
	readonly runnerTemp: string;
	readonly home: string;
	readonly saved: Array<{ readonly key: string; readonly value: unknown }>;
}

const roots: Array<string> = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const workspace = async (): Promise<Workspace> => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "checkout-ws-")));
	roots.push(root);
	const ws = { root, workspace: join(root, "ws"), runnerTemp: join(root, "temp"), home: join(root, "home"), saved: [] };
	for (const dir of [ws.workspace, ws.runnerTemp, ws.home]) await mkdir(dir, { recursive: true });
	return ws;
};

interface Faults {
	readonly git?: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner>;
	readonly state?: Layer.Layer<ActionState>;
	/** The client built from the checkout's own token; the object format lookup answers 404 by default. */
	readonly api?: Partial<GitHubClientShape>;
	/** An ambient `GitHubClient` in the program. */
	readonly ambient?: Partial<GitHubClientShape>;
	/** Records each token-built client's options. */
	readonly builds?: Array<{ readonly token: string; readonly baseUrl: string }>;
}

const noHashAlgorithm: Partial<GitHubClientShape> = {
	requestDecoded: () => Effect.fail(GitHubError.notFound("hash-algorithm", "the repository")),
};

const layerFor = (w: Workspace, faults: Faults = {}) =>
	Layer.mergeAll(
		faults.git ?? Git.layer,
		ActionEnvironment.layerTest(
			{
				RUNNER_TEMP: w.runnerTemp,
				GITHUB_WORKSPACE: w.workspace,
				HOME: w.home,
				GITHUB_REPOSITORY: "own/repo",
				GITHUB_REPOSITORY_OWNER: "own",
				RUNNER_OS: WINDOWS ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
				USERDOMAIN: process.env.USERDOMAIN ?? "",
				USERNAME: process.env.USERNAME ?? "",
			},
			{},
		),
		ActionOutputs.recording().layer,
		faults.state ??
			ActionState.layerTest({
				save: (key, value) => Effect.sync(() => void w.saved.push({ key, value })),
			}),
		ActionLogger.layerSilent,
		Layer.succeed(CheckoutApiClient, (options) =>
			Effect.sync(() => {
				faults.builds?.push({ token: Redacted.value(options.token), baseUrl: options.baseUrl });
				return GitHubClient.makeTest({ ...noHashAlgorithm, ...faults.api });
			}),
		),
		faults.ambient === undefined ? Layer.empty : GitHubClient.layerTest(faults.ambient),
		NodeCrypto.layerSecureRandom,
	).pipe(Layer.provideMerge(NodeServices.layer));

const base = (over: Partial<CheckoutOptions> = {}): CheckoutOptions => ({
	repository: { owner: "own", name: "repo" },
	ref: { _tag: "Branch", name: "main" },
	path: "repo",
	auth: { _tag: "Token", token: Redacted.make(TOKEN) },
	remoteUrl: remotes.url,
	...over,
});

const checkout = (w: Workspace, options: CheckoutOptions, faults: Faults = {}) =>
	Effect.scoped(Checkout.checkout(options)).pipe(
		Effect.provideService(CheckoutRetry, Schedule.recurs(0)),
		Effect.provide(layerFor(w, faults)),
	);

/** The real `Git`, except that writing the first `includeIf` entry fails: after the credentials file exists. */
const includeIfFails: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
	Git,
	Effect.map(
		Git.useSync((git) => git),
		(real) => ({
			...real,
			configSet: (cwd: string, key: string, value: string, options?: { readonly file?: string }) =>
				key.startsWith("includeIf.")
					? Effect.fail(
							new GitCommandError({ kind: "failed", args: ["config", key], cwd, exitCode: 1, stderr: "injected" }),
						)
					: real.configSet(cwd, key, value, options),
		}),
	),
).pipe(Layer.provide(Git.layer));

const repoOf = (w: Workspace) => join(w.workspace, "repo");
const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);
const credentialFiles = async (w: Workspace) =>
	(await readdir(w.runnerTemp)).filter((name) => /^git-credentials-.*\.config$/.test(name));

const ok = async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isFailure(exit)) assert.fail(String(exit.cause));
	return (exit as Exit.Success<A, E>).value;
};

const failureTag = async <A, E>(effect: Effect.Effect<A, E, never>): Promise<string> => {
	const exit = await Effect.runPromiseExit(effect);
	assert.isTrue(Exit.isFailure(exit), "expected a failure");
	const failure = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;
	return (failure as { _tag?: string } | undefined)?._tag ?? String(exit);
};

describe("Checkout.checkout against a file:// remote", () => {
	it("checks out a branch shallowly", async () => {
		const w = await workspace();
		const result = await ok(checkout(w, base({ credentials: "none" })));
		const repo = repoOf(w);
		assert.strictEqual(fixtureGit(repo, ["rev-parse", "HEAD"]), remotes.second);
		assert.strictEqual(fixtureGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
		assert.isTrue(await exists(join(repo, ".git", "shallow")));
		assert.strictEqual(result.ref, "refs/heads/main");
		assert.strictEqual(result.commit, remotes.second);
		assert.strictEqual(result.path, repo);
		assert.deepStrictEqual(result.repository, { owner: "own", name: "repo" });
	});

	it("checks out an annotated tag detached", async () => {
		const w = await workspace();
		const result = await ok(checkout(w, base({ ref: { _tag: "Tag", name: "v1" }, credentials: "none" })));
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "HEAD"]), remotes.first);
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
		assert.strictEqual(result.ref, "refs/tags/v1");
	});

	it("checks out a bare commit", async () => {
		const w = await workspace();
		const result = await ok(checkout(w, base({ ref: { _tag: "Commit", sha: remotes.first }, credentials: "none" })));
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "HEAD"]), remotes.first);
		assert.strictEqual(result.ref, "");
		assert.strictEqual(result.commit, remotes.first);
	});

	it("checks out a pull request merge ref", async () => {
		const w = await workspace();
		const result = await ok(
			checkout(w, base({ ref: { _tag: "PullRequest", number: 1, kind: "merge" }, credentials: "none" })),
		);
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "HEAD"]), remotes.pull);
		assert.strictEqual(result.ref, "refs/pull/1/merge");
	});

	it("resolves an unqualified ref through the remote-tracking branch", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ ref: { _tag: "Ref", ref: "feature/x" }, credentials: "none" })));
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "HEAD"]), remotes.feature);
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "--abbrev-ref", "HEAD"]), "feature/x");
	});

	it("fails CheckoutRefNotFoundError for an unknown unqualified ref", async () => {
		const w = await workspace();
		assert.strictEqual(
			await failureTag(checkout(w, base({ ref: { _tag: "Ref", ref: "nope" }, credentials: "none" }))),
			"CheckoutRefNotFoundError",
		);
	});

	it("fails CheckoutRefNotFoundError for an unknown branch", async () => {
		const w = await workspace();
		assert.strictEqual(
			await failureTag(checkout(w, base({ ref: { _tag: "Branch", name: "missing" }, credentials: "none" }))),
			"CheckoutRefNotFoundError",
		);
	});

	it("fails CheckoutCommitMismatchError when a tag no longer points at the pinned commit", async () => {
		const w = await workspace();
		assert.strictEqual(
			await failureTag(
				checkout(w, base({ ref: { _tag: "Tag", name: "v1", commit: remotes.second }, credentials: "none" })),
			),
			"CheckoutCommitMismatchError",
		);
	});

	it("fetches the full history and the tags with depth full", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ depth: "full", credentials: "none" })));
		const repo = repoOf(w);
		assert.isFalse(await exists(join(repo, ".git", "shallow")));
		assert.strictEqual(fixtureGit(repo, ["rev-list", "--count", "HEAD"]), "2");
		assert.strictEqual(fixtureGit(repo, ["tag", "--list"]), "v1");
	});

	it("leaves only the cone and the root files in a sparse checkout", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ sparse: { patterns: ["src"] }, credentials: "none" })));
		const entries = (await readdir(repoOf(w))).filter((name) => name !== ".git").sort();
		assert.deepStrictEqual(entries, ["README.md", "second.txt", "src"]);
	});

	it("populates submodules recursively", async () => {
		const w = await workspace();
		await ok(
			checkout(w, base({ ref: { _tag: "Branch", name: "with-sub" }, submodules: "recursive", credentials: "none" })),
		);
		assert.strictEqual(await readFile(join(repoOf(w), "lib", "lib.txt"), "utf8"), "lib\n");
		assert.strictEqual(fixtureGit(join(repoOf(w), "lib"), ["rev-parse", "HEAD"]), remotes.libTip);
	});
});

describe("an existing directory", () => {
	it("reuses a repository of the same remote, deleting local branches and untracked files", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ credentials: "none" })));
		const repo = repoOf(w);
		await writeFile(join(repo, "untracked.txt"), "x\n");
		await writeFile(join(repo, ".git", "marker"), "kept when reused\n");
		fixtureGit(repo, ["branch", "local"]);

		await ok(checkout(w, base({ credentials: "none" })));
		assert.isTrue(await exists(join(repo, ".git", "marker")), "the repository was reused");
		assert.isFalse(await exists(join(repo, "untracked.txt")));
		assert.strictEqual(fixtureGit(repo, ["branch", "--list", "local"]), "");
		assert.strictEqual(fixtureGit(repo, ["rev-parse", "HEAD"]), remotes.second);
	});

	it("empties the directory and starts a fresh repository for a different remote", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ credentials: "none" })));
		const repo = repoOf(w);
		await writeFile(join(repo, ".git", "marker"), "gone when replaced\n");

		await ok(checkout(w, base({ remoteUrl: remotes.otherUrl, credentials: "none" })));
		assert.isFalse(await exists(join(repo, ".git", "marker")));
		assert.isFalse(await exists(join(repo, "README.md")));
		assert.isTrue(await exists(join(repo, "other.txt")));
		assert.throws(() => fixtureGit(repo, ["cat-file", "-e", remotes.second]));
	});
});

describe("credential lifetimes", () => {
	const includeIf = async (w: Workspace) =>
		(await readFile(join(repoOf(w), ".git", "config"), "utf8")).includes("includeIf");

	it('"none" leaves no credentials file and no includeIf when it returns', async () => {
		const w = await workspace();
		await ok(checkout(w, base({ credentials: "none" })));
		assert.deepStrictEqual(await credentialFiles(w), []);
		assert.isFalse(await includeIf(w));
		assert.deepStrictEqual(w.saved, []);
	});

	it('"action" keeps the credentials until the scope closes', async () => {
		const w = await workspace();
		let during: { readonly files: number; readonly includeIf: boolean } | undefined;
		await ok(
			Effect.scoped(
				Effect.gen(function* () {
					yield* Checkout.checkout(base({ credentials: "action" }));
					during = yield* Effect.promise(async () => ({
						files: (await credentialFiles(w)).length,
						includeIf: await includeIf(w),
					}));
				}),
			).pipe(Effect.provideService(CheckoutRetry, Schedule.recurs(0)), Effect.provide(layerFor(w))),
		);
		assert.deepStrictEqual(during, { files: 1, includeIf: true });
		assert.deepStrictEqual(await credentialFiles(w), []);
		assert.isFalse(await includeIf(w));
	});

	it('"action" persists core.sshCommand for an SSH checkout until the scope closes', async () => {
		const w = await workspace();
		const auth = { _tag: "Ssh", key: Redacted.make("-----KEY-----\n"), token: Redacted.make(TOKEN) } as const;
		const sshCommand = () => {
			try {
				return fixtureGit(repoOf(w), ["config", "--local", "--get", "core.sshCommand"]);
			} catch {
				return undefined;
			}
		};
		let during: string | undefined;
		await ok(
			Effect.scoped(
				Effect.gen(function* () {
					yield* Checkout.checkout(base({ auth, credentials: "action" }));
					during = sshCommand();
				}),
			).pipe(Effect.provideService(CheckoutRetry, Schedule.recurs(0)), Effect.provide(layerFor(w))),
		);
		assert.isDefined(during);
		assert.include(during ?? "", "UserKnownHostsFile=");
		assert.isUndefined(sshCommand());
		assert.deepStrictEqual(await readdir(w.runnerTemp), []);
	});

	it('"action" removes the credentials when the checkout fails', async () => {
		const w = await workspace();
		assert.strictEqual(
			await failureTag(
				checkout(w, base({ ref: { _tag: "Tag", name: "v1", commit: remotes.second }, credentials: "action" })),
			),
			"CheckoutCommitMismatchError",
		);
		assert.deepStrictEqual(await credentialFiles(w), []);
		assert.isFalse(await includeIf(w));
	});

	it('"action" removes the credentials when the scope is interrupted after checkout returns', async () => {
		const w = await workspace();
		const observed = await ok(
			Effect.gen(function* () {
				const returned = yield* Deferred.make<void>();
				const fiber = yield* Effect.forkChild(
					Effect.scoped(
						Effect.andThen(
							Checkout.checkout(base({ credentials: "action" })),
							Effect.andThen(Deferred.succeed(returned, undefined), Effect.never),
						),
					),
				);
				yield* Deferred.await(returned);
				const before = yield* Effect.promise(() => credentialFiles(w));
				yield* Fiber.interrupt(fiber);
				return before.length;
			}).pipe(Effect.provideService(CheckoutRetry, Schedule.recurs(0)), Effect.provide(layerFor(w))),
		);
		assert.strictEqual(observed, 1);
		assert.deepStrictEqual(await credentialFiles(w), []);
		assert.isFalse(await includeIf(w));
	});

	it('"job" keeps the credentials, discards the temporary global config and saves the record', async () => {
		const w = await workspace();
		await ok(checkout(w, base({ credentials: "job" })));
		assert.lengthOf(await credentialFiles(w), 1);
		assert.isTrue(await includeIf(w));
		// Only the credentials file is left under RUNNER_TEMP: the temporary global config's directory is gone.
		assert.deepStrictEqual(await readdir(w.runnerTemp), await credentialFiles(w));
		assert.lengthOf(w.saved, 1);
		const saved = w.saved[0];
		assert.strictEqual(saved?.key, "effected-checkout");
		assert.instanceOf(saved?.value, CredentialRecord);
		const record = saved?.value as CredentialRecord;
		assert.strictEqual(record.repositoryPath, repoOf(w));
		assert.isTrue(Option.isSome(record.credentialsFile));
		assert.isTrue(Option.isNone(record.temporaryGlobalConfig));
		assert.isTrue(record.safeDirectory);
	});

	for (const credentials of ["none", "action", "job"] as const) {
		it(`"${credentials}" rolls back a configure that fails after writing the token and the SSH key`, async () => {
			const w = await workspace();
			const auth = { _tag: "Ssh", key: Redacted.make("-----KEY-----\n"), token: Redacted.make(TOKEN) } as const;
			assert.strictEqual(
				await failureTag(checkout(w, base({ auth, credentials }), { git: includeIfFails })),
				"GitCommandError",
			);
			// Nothing at all is left: no credentials file, no SSH key, no known hosts, no temporary global config.
			assert.deepStrictEqual(await readdir(w.runnerTemp), []);
			assert.deepStrictEqual(w.saved, []);
		});
	}

	it('a second "job" checkout of another path under the same stateKey is refused before it writes anything', async () => {
		const w = await workspace();
		const both = Effect.gen(function* () {
			yield* Effect.scoped(Checkout.checkout(base({ credentials: "job" })));
			// The same path again replaces the first checkout's credentials, so it may share the key.
			yield* Effect.scoped(Checkout.checkout(base({ credentials: "job" })));
			const before = yield* Effect.promise(() => readdir(w.runnerTemp));
			const error = yield* Effect.flip(Effect.scoped(Checkout.checkout(base({ credentials: "job", path: "other" }))));
			assert.deepStrictEqual(yield* Effect.promise(() => readdir(w.runnerTemp)), before);
			return error;
		}).pipe(Effect.provideService(CheckoutRetry, Schedule.recurs(0)), Effect.provide(layerFor(w)));
		const error = await ok(both);
		assert.strictEqual(error._tag, "CheckoutStateKeyInUseError");
		assert.strictEqual(w.saved.length, 2);
		assert.isFalse(await exists(join(w.workspace, "other", ".git")));
		// Its own key is fine.
		await ok(checkout(w, base({ credentials: "job", path: "other", stateKey: "other-checkout" })));
	});

	it('"job" removes the credentials when saving the record fails', async () => {
		const w = await workspace();
		const state = ActionState.layerTest({
			save: (key) => Effect.fail(new ActionStateError({ reason: "writeFailed", key })),
		});
		assert.strictEqual(await failureTag(checkout(w, base({ credentials: "job" }), { state })), "ActionStateError");
		assert.deepStrictEqual(await readdir(w.runnerTemp), []);
		assert.isFalse(await includeIf(w));
	});
});

/** `@effected/git`'s run options, read by their key, so a test sees the ceiling a spawn inherits. */
const RunOptions = Context.Reference<{ readonly timeout?: Duration.Input }>("@effected/git/GitRunOptions", {
	defaultValue: () => ({}),
});

/** The real `Git`, recording the timeout in force for a few of its non-network members. */
const recordingTimeouts = (
	seen: Map<string, Duration.Input | undefined>,
): Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Layer.effect(
		Git,
		Effect.map(
			Git.useSync((git) => git),
			(real): GitShape => {
				const record = <A, E>(name: string, effect: Effect.Effect<A, E>) =>
					Effect.flatMap(RunOptions, (options) => {
						seen.set(name, options.timeout);
						return effect;
					});
				return {
					...real,
					version: (...args) => record("version", real.version(...args)),
					sparseCheckoutDisable: (...args) => record("sparseCheckoutDisable", real.sparseCheckoutDisable(...args)),
					checkout: (...args) => record("checkout", real.checkout(...args)),
				};
			},
		),
	).pipe(Layer.provide(Git.layer));

const failureOf = async <A, E>(effect: Effect.Effect<A, E, never>): Promise<unknown> => {
	const exit = await Effect.runPromiseExit(effect);
	assert.isTrue(Exit.isFailure(exit), "expected a failure");
	return Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;
};

const defaultBranchIs = (name: string): Partial<GitHubClientShape> => ({
	request: (() => Effect.succeed({ default_branch: name })) as unknown as GitHubClientShape["request"],
});

/**
 * The options with no `remoteUrl`, so the checkout derives `https://github.com/<owner>/<name>` and asks the API for
 * the default branch, while the workspace's global config rewrites that URL to a local remote: the temporary
 * global config the checkout runs under is seeded from it.
 */
const viaDerivedUrl = async (w: Workspace, options: CheckoutOptions, remote: string): Promise<CheckoutOptions> => {
	const { remoteUrl: _ignored, ...derived } = options;
	const name = options.repository?.name ?? "repo";
	await writeFile(join(w.home, ".gitconfig"), `[url "${remote}"]\n\tinsteadOf = https://github.com/own/${name}\n`);
	return derived;
};

const ambientUnused: Partial<GitHubClientShape> = {
	request: (() => Effect.die("the ambient client was used")) as unknown as GitHubClientShape["request"],
	requestDecoded: (() => Effect.die("the ambient client was used")) as unknown as GitHubClientShape["requestDecoded"],
};

describe("the object format", () => {
	it("initializes with the detected sha1 even when git's own default is sha256", async () => {
		const w = await workspace();
		const program = checkout(w, base({ ref: { _tag: "Commit", sha: remotes.second }, credentials: "none" }));
		await ok(Git.withRunOptions(program, { env: { GIT_DEFAULT_HASH: "sha256" } }));
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "--show-object-format"]), "sha1");
		assert.strictEqual(fixtureGit(repoOf(w), ["rev-parse", "HEAD"]), remotes.second);
	});
});

describe("the step timeout", () => {
	it("runs every git step, not only the network ones, under the 30 minute ceiling", async () => {
		const w = await workspace();
		const seen = new Map<string, Duration.Input | undefined>();
		await ok(checkout(w, base({ credentials: "none" }), { git: recordingTimeouts(seen) }));
		assert.deepStrictEqual(Object.fromEntries(seen), {
			version: "30 minutes",
			sparseCheckoutDisable: "30 minutes",
			checkout: "30 minutes",
		});
	});
});

describe("the API client and the default branch", () => {
	it("builds the client from the checkout's own token and API base, ignoring an ambient one", async () => {
		const w = await workspace();
		const builds: Array<{ readonly token: string; readonly baseUrl: string }> = [];
		const options = await viaDerivedUrl(w, base({ ref: { _tag: "Default" }, credentials: "none" }), remotes.otherUrl);
		const result = await ok(
			checkout(w, options, {
				ambient: ambientUnused,
				api: defaultBranchIs("main"),
				builds,
			}),
		);
		// The API's answer, not the remote's HEAD (master).
		assert.strictEqual(result.ref, "refs/heads/main");
		assert.deepStrictEqual(builds, [{ token: TOKEN, baseUrl: "https://api.github.com" }]);
	});

	it("derives a GitHub Enterprise Server API base from serverUrl", async () => {
		const w = await workspace();
		const builds: Array<{ readonly token: string; readonly baseUrl: string }> = [];
		await ok(
			checkout(w, base({ serverUrl: "https://ghes.example.com", credentials: "none" }), {
				ambient: ambientUnused,
				builds,
			}),
		);
		assert.deepStrictEqual(builds, [{ token: TOKEN, baseUrl: "https://ghes.example.com/api/v3" }]);
	});

	it("uses the ambient client when the checkout has no token", async () => {
		const w = await workspace();
		const builds: Array<{ readonly token: string; readonly baseUrl: string }> = [];
		let asked = 0;
		const ambient: Partial<GitHubClientShape> = {
			requestDecoded: () =>
				Effect.suspend(() => {
					asked += 1;
					return Effect.fail(GitHubError.notFound("hash-algorithm", "the repository"));
				}),
		};
		const auth = { _tag: "Ssh", key: Redacted.make("-----KEY-----\n") } as const;
		await ok(checkout(w, base({ auth, credentials: "none" }), { ambient, builds }));
		assert.strictEqual(asked, 1);
		assert.deepStrictEqual(builds, []);
	});

	it("falls back to master for a wiki the API does not find", async () => {
		const w = await workspace();
		const api: Partial<GitHubClientShape> = {
			request: (() =>
				Effect.fail(
					GitHubError.notFound("GET /repos/{owner}/{repo}", "the repository"),
				)) as unknown as GitHubClientShape["request"],
		};
		const options = await viaDerivedUrl(
			w,
			base({ repository: { owner: "own", name: "repo.wiki" }, ref: { _tag: "Default" }, credentials: "none" }),
			remotes.otherUrl,
		);
		const result = await ok(checkout(w, options, { api }));
		assert.strictEqual(result.ref, "refs/heads/master");
	});

	it("with remoteUrl set, takes the default branch from the remote's HEAD, not the API", async () => {
		const w = await workspace();
		const result = await ok(
			checkout(w, base({ ref: { _tag: "Default" }, remoteUrl: remotes.otherUrl, credentials: "none" }), {
				api: defaultBranchIs("main"),
			}),
		);
		assert.strictEqual(result.ref, "refs/heads/master");
	});

	it("fails CheckoutDefaultBranchError carrying the API's reason, with no token in it", async () => {
		const w = await workspace();
		const api: Partial<GitHubClientShape> = {
			request: (() =>
				Effect.fail(
					new GitHubError({
						kind: "unauthorized",
						operation: "GET /repos/{owner}/{repo}",
						reason: `Bad credentials for ${TOKEN}`,
						status: 401,
					}),
				)) as unknown as GitHubClientShape["request"],
		};
		const options = await viaDerivedUrl(w, base({ ref: { _tag: "Default" } }), remotes.url);
		const error = (await failureOf(checkout(w, options, { api }))) as CheckoutDefaultBranchError;
		assert.strictEqual(error._tag, "CheckoutDefaultBranchError");
		assert.include(error.detail, "(401)");
		assert.include(error.detail, "Bad credentials");
		assert.include(error.message, error.detail);
		assert.notInclude(error.message, TOKEN);
	});
});
