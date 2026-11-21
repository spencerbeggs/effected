// `"job"` checkout followed by `Checkout.cleanup`, over real git and a real
// filesystem against local `file://` remotes. State is carried from the checkout
// to the cleanup by an `ActionState` double that stores what was saved.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, afterEach, assert, beforeAll, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { GitHubClient, GitHubError } from "@effected/github";
import { Deferred, Effect, Exit, Fiber, Layer, LogLevel, Logger, Option, Redacted, Schedule } from "effect";
import { ActionEnvironment } from "../../src/ActionEnvironment.js";
import { ActionLogger } from "../../src/ActionLogger.js";
import { ActionOutputs } from "../../src/ActionOutputs.js";
import { ActionState, ActionStateError } from "../../src/ActionState.js";
import type { CheckoutOptions } from "../../src/Checkout.js";
import { Checkout } from "../../src/Checkout.js";
import { CheckoutApiClient, CheckoutRetry } from "../../src/internal/checkout/source.js";

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
			...args,
		],
		{ cwd, env: FIXTURE_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();

let root: string;
let url: string;

beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "cleanup-remotes-")));
	const libWork = join(root, "lib-work");
	await mkdir(libWork, { recursive: true });
	fixtureGit(libWork, ["init", "-q"]);
	await writeFile(join(libWork, "lib.txt"), "lib\n");
	fixtureGit(libWork, ["add", "."]);
	fixtureGit(libWork, ["commit", "-q", "-m", "lib"]);
	const libBare = join(root, "lib.git");
	fixtureGit(root, ["clone", "-q", "--bare", libWork, libBare]);

	const work = join(root, "work");
	await mkdir(work, { recursive: true });
	fixtureGit(work, ["init", "-q"]);
	await writeFile(join(work, "README.md"), "readme\n");
	fixtureGit(work, ["add", "."]);
	fixtureGit(work, ["commit", "-q", "-m", "first"]);
	fixtureGit(work, ["tag", "-a", "v1", "-m", "v1"]);
	fixtureGit(work, ["submodule", "add", "-q", `file://${libBare}`, "lib"]);
	fixtureGit(work, ["commit", "-q", "-m", "add submodule"]);
	const bare = join(root, "remote.git");
	fixtureGit(root, ["clone", "-q", "--bare", work, bare]);
	url = `file://${bare}`;
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

interface Workspace {
	readonly root: string;
	readonly workspace: string;
	readonly runnerTemp: string;
	readonly home: string;
	/** What the checkout saved, served back to the cleanup. */
	readonly store: Map<string, unknown>;
}

const roots: Array<string> = [];
afterEach(async () => {
	for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const workspace = async (): Promise<Workspace> => {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "cleanup-ws-")));
	roots.push(dir);
	const w = {
		root: dir,
		workspace: join(dir, "ws"),
		runnerTemp: join(dir, "temp"),
		home: join(dir, "home"),
		store: new Map<string, unknown>(),
	};
	for (const d of [w.workspace, w.runnerTemp, w.home]) await mkdir(d, { recursive: true });
	return w;
};

/**
 * git 2.38+ refuses a `file://` submodule remote unless the environment allows it, so every git step under test runs
 * with `GIT_ALLOW_PROTOCOL=file` through its run options, which reach each spawned git and its children.
 */
const provideFor =
	(w: Workspace, state?: Layer.Layer<ActionState>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Git.withRunOptions(effect, { env: { GIT_ALLOW_PROTOCOL: "file" } }).pipe(Effect.provide(layerFor(w, state)));

const layerFor = (w: Workspace, state?: Layer.Layer<ActionState>) =>
	Layer.mergeAll(
		Git.layer,
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
		state ??
			ActionState.layerTest({
				save: (key, value, schema) => Effect.sync(() => void w.store.set(key, value)),
				getOptional: (key) => Effect.sync(() => Option.fromNullishOr(w.store.get(key) as never)),
			}),
		ActionLogger.layerSilent,
		// The client a checkout builds from its token: the object format lookup answers 404, and nothing reaches the network.
		Layer.succeed(CheckoutApiClient, () =>
			Effect.succeed(
				GitHubClient.makeTest({
					requestDecoded: () => Effect.fail(GitHubError.notFound("hash-algorithm", "the repository")),
				}),
			),
		),
		NodeCrypto.layerSecureRandom,
	).pipe(Layer.provideMerge(NodeServices.layer));

const base = (over: Partial<CheckoutOptions> = {}): CheckoutOptions => ({
	repository: { owner: "own", name: "repo" },
	ref: { _tag: "Branch", name: "main" },
	path: "repo",
	auth: { _tag: "Token", token: Redacted.make(TOKEN) },
	remoteUrl: url,
	credentials: "job",
	...over,
});

const checkout = (w: Workspace, options: CheckoutOptions) =>
	Effect.scoped(Checkout.checkout(options)).pipe(
		Effect.provideService(CheckoutRetry, Schedule.recurs(0)),
		provideFor(w),
	);

const cleanup = (w: Workspace, options?: { readonly stateKey?: string }, state?: Layer.Layer<ActionState>) =>
	Checkout.cleanup(options).pipe(provideFor(w, state));

const gitConfig = async (dir: string): Promise<string> => readFile(join(dir, ".git", "config"), "utf8");
const credentialFiles = async (w: Workspace) =>
	(await readdir(w.runnerTemp)).filter((name) => /^git-credentials-.*\.config$/.test(name));

const ok = async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isFailure(exit)) assert.fail(String(exit.cause));
	return (exit as Exit.Success<A, E>).value;
};

const assertClean = async (w: Workspace, ...dirs: ReadonlyArray<string>) => {
	assert.deepStrictEqual(await readdir(w.runnerTemp), []);
	for (const dir of dirs) {
		const config = await gitConfig(dir);
		for (const needle of ["includeIf", "extraheader", "sshCommand", "insteadOf"]) {
			assert.notInclude(config, needle, `${dir} still has ${needle}`);
		}
	}
};

describe("Checkout.cleanup", () => {
	it('removes everything a "job" checkout left, submodules included', async () => {
		const w = await workspace();
		await ok(checkout(w, base({ submodules: true })));
		const repo = join(w.workspace, "repo");
		assert.include(await gitConfig(repo), "includeIf");
		assert.lengthOf(await credentialFiles(w), 1);
		await ok(cleanup(w));
		await assertClean(w, repo);
		// The submodule's own git config (modules/lib) is clean too.
		const modules = join(repo, ".git", "modules", "lib", "config");
		assert.notInclude(await readFile(modules, "utf8"), "includeIf");
	});

	it('removes SSH files from a "job" checkout', async () => {
		const w = await workspace();
		const auth = { _tag: "Ssh", key: Redacted.make("-----KEY-----\n"), token: Redacted.make(TOKEN) } as const;
		await ok(checkout(w, base({ auth })));
		assert.isAbove((await readdir(w.runnerTemp)).length, 0);
		await ok(cleanup(w));
		await assertClean(w, join(w.workspace, "repo"));
	});

	it("leaves nothing after a checkout that failed with CheckoutCommitMismatchError", async () => {
		const w = await workspace();
		const exit = await Effect.runPromiseExit(
			checkout(w, base({ ref: { _tag: "Tag", name: "v1", commit: "0".repeat(40) } })),
		);
		assert.isTrue(Exit.isFailure(exit));
		assert.isTrue(w.store.has("effected-checkout"));
		assert.include(await gitConfig(join(w.workspace, "repo")), "includeIf");
		assert.lengthOf(await credentialFiles(w), 1);
		await ok(cleanup(w));
		await assertClean(w, join(w.workspace, "repo"));
	});

	it("is a no-op with no saved record", async () => {
		const w = await workspace();
		await writeFile(join(w.runnerTemp, "unrelated.txt"), "keep");
		await ok(cleanup(w));
		assert.deepStrictEqual(await readdir(w.runnerTemp), ["unrelated.txt"]);
	});

	it("cleans each of two checkouts by its own stateKey", async () => {
		const w = await workspace();
		await ok(checkout(w, base({ path: "a", stateKey: "one" })));
		await ok(checkout(w, base({ path: "b", stateKey: "two" })));
		assert.lengthOf(await credentialFiles(w), 2);
		await ok(cleanup(w, { stateKey: "one" }));
		assert.lengthOf(await credentialFiles(w), 1);
		assert.notInclude(await gitConfig(join(w.workspace, "a")), "includeIf");
		assert.include(await gitConfig(join(w.workspace, "b")), "includeIf");
		await ok(cleanup(w, { stateKey: "two" }));
		await assertClean(w, join(w.workspace, "a"), join(w.workspace, "b"));
	});

	it("never fails on a malformed record", async () => {
		const w = await workspace();
		const state = ActionState.layerTest({
			getOptional: (key) => Effect.fail(new ActionStateError({ reason: "malformed", key })),
		});
		await ok(cleanup(w, undefined, state));
	});

	it("never fails when the saved record's repository is gone", async () => {
		const w = await workspace();
		await ok(checkout(w, base()));
		assert.lengthOf(await credentialFiles(w), 1);
		await rm(join(w.workspace, "repo"), { recursive: true, force: true });
		// A post step whose workspace is gone must not annotate a green job with warnings.
		const warnings: Array<string> = [];
		const capture = Logger.make((entry) => {
			if (LogLevel.isGreaterThanOrEqualTo(entry.logLevel, "Warn")) warnings.push(String(entry.message));
		});
		// Inside the layer, whose silent ActionLogger installs no logger of its own.
		await ok(Checkout.cleanup().pipe(Effect.provide(Logger.layer([capture])), provideFor(w)));
		assert.deepStrictEqual(warnings, []);
		assert.deepStrictEqual(await readdir(w.runnerTemp), []);
	});

	it("does not touch the commit that was checked out", async () => {
		const w = await workspace();
		const result = await ok(checkout(w, base()));
		await ok(cleanup(w));
		assert.strictEqual(fixtureGit(join(w.workspace, "repo"), ["rev-parse", "HEAD"]), result.commit);
		assert.strictEqual(fixtureGit(join(w.workspace, "repo"), ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
	});

	it("finishes removing when its fiber is interrupted straight after starting", async () => {
		const w = await workspace();
		await ok(checkout(w, base()));
		assert.lengthOf(await credentialFiles(w), 1);
		await ok(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const state = ActionState.layerTest({
					getOptional: (key) =>
						Deferred.succeed(started, undefined).pipe(
							Effect.andThen(Effect.sleep("10 millis")),
							Effect.as(Option.fromNullishOr(w.store.get(key) as never)),
						),
				});
				const fiber = yield* Effect.forkChild(cleanup(w, undefined, state));
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
			}),
		);
		await assertClean(w, join(w.workspace, "repo"));
	});
});
