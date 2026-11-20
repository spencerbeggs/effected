// Proves the Checkout-support surface of the Git service (init, version,
// configAdd, ...) against a REAL git binary and a real filesystem. Later tasks
// extend this file.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { ChildProcess } from "effect/process";
import { Git } from "../../src/Git.js";
import { GitVersion } from "../../src/GitVersion.js";
import { runCollected } from "../../src/internal/run.js";

const TestLayer = Git.layer.pipe(Layer.provideMerge(NodeServices.layer));

const hasLfs = (() => {
	try {
		execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

const run = <A, E>(effect: Effect.Effect<A, E, Git | ChildProcessSpawner.ChildProcessSpawner>) =>
	effect.pipe(Effect.provide(TestLayer));

const FIXTURE_ENV = { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" } as const;

const runFixtureGit = (
	cwd: string,
	args: ReadonlyArray<string>,
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
	runCollected(ChildProcess.setCwd(ChildProcess.make("git", args, { env: FIXTURE_ENV, extendEnv: true }), cwd)).pipe(
		Effect.orDie,
		Effect.flatMap((result) =>
			result.exitCode === 0
				? Effect.succeed(result.stdout)
				: Effect.die(new Error(`fixture git ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr}`)),
		),
	);

// Keep host git config out of every spawn so the assertions see only fixtures.
const HOST_CONFIG_KEYS = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"] as const;
const hostConfig = new Map<string, string | undefined>();

beforeAll(() => {
	for (const key of HOST_CONFIG_KEYS) {
		hostConfig.set(key, process.env[key]);
		process.env[key] = "/dev/null";
	}
});

afterAll(() => {
	for (const key of HOST_CONFIG_KEYS) {
		const previous = hostConfig.get(key);
		if (previous === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = previous;
		}
	}
});

describe("Git checkout surface — repository setup", () => {
	let root: string;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "effected-git-checkout-"));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("init with sha256 produces a sha256 repository", async () => {
		const out = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					yield* git.init(root, "sha", { objectFormat: "sha256", initialBranch: "trunk" });
					return yield* runFixtureGit(join(root, "sha"), ["rev-parse", "--show-object-format"]);
				}),
			),
		);
		assert.strictEqual(out.trim(), "sha256");
	});

	it("configAdd twice yields two values from configGetAll", async () => {
		const values = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					yield* git.init(root, "multi");
					const dir = join(root, "multi");
					yield* git.configAdd(dir, "test.multi", "one");
					yield* git.configAdd(dir, "test.multi", "two");
					return yield* git.configGetAll(dir, "test.multi");
				}),
			),
		);
		assert.deepStrictEqual(values, ["one", "two"]);
	});

	it("version parses the installed git", async () => {
		const version = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.version(root);
				}),
			),
		);
		assert.isTrue(version instanceof GitVersion);
		assert.isTrue(version.major >= 2);
	});
});

describe("Git checkout surface — fetch, checkout and cleanup forms", () => {
	let root: string;
	let bare: string;
	let work: string;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "effected-git-forms-"));
		bare = join(root, "remote.git");
		const seed = join(root, "seed");
		await Effect.runPromise(
			run(
				Effect.gen(function* () {
					yield* runFixtureGit(root, ["init", "--bare", "--initial-branch=main", bare]);
					yield* runFixtureGit(root, ["init", "--initial-branch=main", seed]);
					yield* runFixtureGit(seed, ["config", "user.email", "t@example.com"]);
					yield* runFixtureGit(seed, ["config", "user.name", "T"]);
					yield* runFixtureGit(seed, ["commit", "--allow-empty", "-m", "one"]);
					yield* runFixtureGit(seed, ["branch", "feature/x"]);
					yield* runFixtureGit(seed, ["tag", "v1"]);
					yield* runFixtureGit(seed, ["push", bare, "main", "feature/x", "v1"]);
					yield* runFixtureGit(bare, ["update-ref", "refs/pull/1/merge", "main"]);
					yield* runFixtureGit(root, ["init", "--initial-branch=other", "work"]);
					work = join(root, "work");
					yield* runFixtureGit(work, ["config", "user.email", "t@example.com"]);
					yield* runFixtureGit(work, ["config", "user.name", "T"]);
					yield* runFixtureGit(work, ["remote", "add", "origin", `file://${bare}`]);
				}),
			),
		);
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("fetchRefspecs materialises a pull ref, then checkout -B and the cleanup forms work", async () => {
		const result = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					yield* git.fetchRefspecs(work, {
						refspecs: [
							"+refs/pull/1/merge:refs/remotes/pull/1/merge",
							"+refs/heads/main:refs/remotes/origin/main",
							"+refs/heads/feature/x:refs/remotes/origin/feature/x",
						],
						noTags: true,
						protocolVersion: 2,
					});
					const pull = yield* runFixtureGit(work, ["rev-parse", "--verify", "refs/remotes/pull/1/merge"]);
					yield* git.checkout(work, "refs/remotes/origin/main", { force: true, branch: "main" });
					const head = yield* runFixtureGit(work, ["rev-parse", "--abbrev-ref", "HEAD"]);
					yield* runFixtureGit(work, ["init", "nested"]);
					yield* git.clean(work, { nested: true, directories: true, ignored: true });
					const nested = yield* runFixtureGit(work, ["status", "--porcelain", "--ignored"]);
					yield* git.branchDelete(work, "origin/feature/x", { remote: true });
					const remaining = yield* runFixtureGit(work, ["branch", "-r"]);
					return { pull: pull.trim(), head: head.trim(), nested, remaining };
				}),
			),
		);
		assert.match(result.pull, /^[0-9a-f]{40}$/);
		assert.strictEqual(result.head, "main");
		assert.strictEqual(result.nested.trim(), "");
		assert.notInclude(result.remaining, "feature/x");
		assert.include(result.remaining, "origin/main");
	});

	it("refuses an empty refspec list, an option-like refspec, and branch with detach", async () => {
		const outcomes = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					const a = yield* Effect.flip(git.fetchRefspecs(work, { refspecs: [] }));
					const b = yield* Effect.flip(git.fetchRefspecs(work, { refspecs: ["--upload-pack=x"] }));
					const c = yield* Effect.flip(git.checkout(work, "main", { branch: "b", detach: true }));
					return [a, b, c];
				}),
			),
		);
		for (const error of outcomes) {
			assert.strictEqual(error._tag, "GitCommandError");
			assert.strictEqual((error as { kind: string }).kind, "refused");
		}
	});

	it("remoteHead returns the HEAD symref target, and none when the remote has no HEAD", async () => {
		const [some, none] = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					const empty = join(root, "empty.git");
					yield* runFixtureGit(root, ["init", "--bare", "--initial-branch=main", empty]);
					return [
						yield* git.remoteHead(work, `file://${bare}`),
						yield* git.remoteHead(work, `file://${empty}`),
					] as const;
				}),
			),
		);
		assert.deepStrictEqual(some, Option.some("refs/heads/main"));
		assert.isTrue(Option.isNone(none));
	});

	it("sparseCheckoutDisable restores every file after sparseCheckoutSet", async () => {
		const files = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					const dir = join(root, "sparse");
					yield* runFixtureGit(root, ["init", "--initial-branch=main", dir]);
					yield* runFixtureGit(dir, ["config", "user.email", "t@example.com"]);
					yield* runFixtureGit(dir, ["config", "user.name", "T"]);
					yield* Effect.promise(async () => {
						const { mkdir, writeFile } = await import("node:fs/promises");
						await mkdir(join(dir, "a"));
						await mkdir(join(dir, "b"));
						await writeFile(join(dir, "a", "f.txt"), "a");
						await writeFile(join(dir, "b", "g.txt"), "b");
					});
					yield* runFixtureGit(dir, ["add", "."]);
					yield* runFixtureGit(dir, ["commit", "-m", "x"]);
					yield* git.sparseCheckoutSet(dir, ["a"], { cone: true });
					const hiddenWhileSparse = !(yield* Effect.promise(async () => {
						const { existsSync } = await import("node:fs");
						return existsSync(join(dir, "b", "g.txt"));
					}));
					yield* runFixtureGit(dir, ["config", "--local", "extensions.worktreeConfig", "true"]);
					yield* git.sparseCheckoutDisable(dir);
					const worktreeConfig = yield* git.configGet(dir, "extensions.worktreeConfig", { scope: "local" });
					const after = yield* Effect.promise(async () => {
						const { existsSync } = await import("node:fs");
						return existsSync(join(dir, "b", "g.txt"));
					});
					return { hiddenWhileSparse, worktreeConfig, after };
				}),
			),
		);
		assert.isTrue(files.hiddenWhileSparse);
		assert.isTrue(Option.isNone(files.worktreeConfig));
		assert.isTrue(files.after);
	});

	it.skipIf(!hasLfs)("lfsInstall --local writes the filter.lfs keys", async () => {
		const lfs = await Effect.runPromise(
			run(
				Effect.gen(function* () {
					const git = yield* Git;
					const dir = join(root, "lfs");
					yield* runFixtureGit(root, ["init", "--initial-branch=main", dir]);
					yield* git.lfsInstall(dir, { local: true });
					const value = yield* git.configGet(dir, "filter.lfs.clean", { scope: "local" });
					return Option.isSome(value);
				}),
			),
		);
		assert.isTrue(lfs);
	});
});
