// Proves Git.withRunOptions against a REAL git: `config` reaches git as
// GIT_CONFIG_COUNT entries and `env` can redirect the global config file.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { Git } from "../../src/Git.js";

const TestLayer = Git.layer.pipe(Layer.provideMerge(NodeServices.layer));

let root = "";
let repo = "";

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "git-run-options-"));
	repo = join(root, "repo");
	execFileSync("git", ["init", "-q", repo]);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Git.withRunOptions (real git)", () => {
	it.effect("config reaches git as a config entry", () =>
		Effect.gen(function* () {
			const git = yield* Git;
			const value = yield* Git.withRunOptions(git.configGet(repo, "x.y"), { config: { "x.y": "z" } });
			assert.deepStrictEqual(value, Option.some("z"));
		}).pipe(Effect.provide(TestLayer)),
	);

	it.effect("GIT_CONFIG_GLOBAL redirects which file the global scope reads", () =>
		Effect.gen(function* () {
			const git = yield* Git;
			const file = join(root, "global.gitconfig");
			execFileSync("git", ["config", "--file", file, "x.g", "from-file"]);
			const scoped = yield* Git.withRunOptions(git.configGet(repo, "x.g", { scope: "global" }), {
				env: { GIT_CONFIG_GLOBAL: file },
			});
			assert.deepStrictEqual(scoped, Option.some("from-file"));
			const outside = yield* git.configGet(repo, "x.g", { scope: "global" });
			assert.deepStrictEqual(outside, Option.none());
		}).pipe(Effect.provide(TestLayer)),
	);
});
