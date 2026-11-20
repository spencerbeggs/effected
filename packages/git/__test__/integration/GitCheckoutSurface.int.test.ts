// Proves the Checkout-support surface of the Git service (init, version,
// configAdd, ...) against a REAL git binary and a real filesystem. Later tasks
// extend this file.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { ChildProcess } from "effect/process";
import { Git } from "../../src/Git.js";
import { GitVersion } from "../../src/GitVersion.js";
import { runCollected } from "../../src/internal/run.js";

const TestLayer = Git.layer.pipe(Layer.provideMerge(NodeServices.layer));

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
