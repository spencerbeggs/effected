// Proves Git.commitsThatAdd against real repositories and against its oracle,
// @changesets/git's getCommitsThatAddFiles, run on the same repositories.
//
// The shallow cases clone a local repository with `git clone --depth 1
// file://...`, so the deepen path runs a real `git fetch --deepen` with no
// network. Deepening changes the clone, so every shallow case clones afresh.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommitsThatAddFiles } from "@changesets/git";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { Git, GitCommandError, NotARepositoryError, ShallowHistoryError } from "../../src/Git.js";

const TestLayer = Git.layer.pipe(Layer.provideMerge(NodeServices.layer));

const FIXTURE_ENV = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };

/** One raw fixture `git` call; throws (failing the hook or test) on a non-zero exit. */
const fixtureGit = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", args, { cwd, env: FIXTURE_ENV, encoding: "utf8" }).trim();

let root: string;
let source: string;
let cloneCount = 0;
/** sha of each fixture commit, by its subject. */
const sha: Record<string, string> = {};

/** A fresh `--depth 1` clone of the source repository. */
const shallowClone = (): string => {
	cloneCount += 1;
	const target = join(root, `clone-${cloneCount}`);
	fixtureGit(root, ["clone", "--quiet", "--depth", "1", `file://${source}`, target]);
	assert.strictEqual(fixtureGit(target, ["rev-parse", "--is-shallow-repository"]), "true");
	return target;
};

const commitsThatAdd = (
	cwd: string,
	paths: ReadonlyArray<string>,
	options?: Parameters<Git["Service"]["commitsThatAdd"]>[2],
) =>
	Effect.gen(function* () {
		const git = yield* Git;
		return yield* git.commitsThatAdd(cwd, paths, options);
	}).pipe(Effect.provide(TestLayer));

const oracle = (cwd: string, paths: ReadonlyArray<string>) =>
	Effect.promise(() => getCommitsThatAddFiles([...paths], { cwd }));

const asUndefined = (results: ReadonlyArray<Option.Option<string>>) => results.map(Option.getOrUndefined);

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "effected-git-commits-that-add-"));
	source = join(root, "source");
	execFileSync("git", ["init", "--quiet", "-b", "main", source], { env: FIXTURE_ENV });
	fixtureGit(source, ["config", "user.name", "Fixture"]);
	fixtureGit(source, ["config", "user.email", "fixture@example.com"]);
	fixtureGit(source, ["config", "commit.gpgsign", "false"]);
	const commit = async (subject: string, write: () => Promise<void>) => {
		await write();
		fixtureGit(source, ["add", "-A"]);
		fixtureGit(source, ["commit", "--quiet", "-m", subject]);
		sha[subject] = fixtureGit(source, ["rev-parse", "HEAD"]);
	};
	await commit("add-a", () => writeFile(join(source, "a.md"), "first file, the root commit\n"));
	for (let index = 1; index <= 6; index += 1) {
		await commit(`filler-${index}`, () => writeFile(join(source, "filler.txt"), `${index}\n`));
	}
	await commit("add-spaced", () => writeFile(join(source, "with space.md"), "a path with a space\n"));
	await commit("rename-a", async () => {
		fixtureGit(source, ["mv", "a.md", "b.md"]);
	});
	await commit("add-c", () => writeFile(join(source, "c.md"), "added at the tip\n"));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Git.commitsThatAdd in a complete repository", () => {
	it.effect("resolves several paths in one call, aligned with the input and equal to the oracle", () =>
		Effect.gen(function* () {
			const paths = ["c.md", "with space.md", "never-added.md", "b.md"];
			const ours = yield* commitsThatAdd(source, paths);
			assert.deepStrictEqual(asUndefined(ours), [sha["add-c"], sha["add-spaced"], undefined, sha["add-a"]]);
			assert.deepStrictEqual(asUndefined(ours), yield* oracle(source, paths));
		}),
	);

	it.effect("follows a renamed file back to the commit that added it under its first name", () =>
		Effect.gen(function* () {
			const ours = yield* commitsThatAdd(source, ["b.md"]);
			assert.deepStrictEqual(ours, [Option.some(sha["add-a"] as string)]);
			assert.deepStrictEqual(asUndefined(ours), yield* oracle(source, ["b.md"]));
		}),
	);

	it.effect("a path never added is Option.none, as the oracle's undefined", () =>
		Effect.gen(function* () {
			const ours = yield* commitsThatAdd(source, ["never-added.md", "-dash.md"]);
			assert.deepStrictEqual(ours, [Option.none(), Option.none()]);
			// The oracle runs only the plain path: it passes no `--`, so a
			// dash-leading path would reach git as an option.
			assert.deepStrictEqual(asUndefined(ours.slice(0, 1)), yield* oracle(source, ["never-added.md"]));
		}),
	);

	it.effect("a path no longer in the working tree still resolves, where the oracle answers undefined", () =>
		Effect.gen(function* () {
			// The deliberate divergence: upstream passes no `--`, so git rejects a
			// path absent from the working tree as an ambiguous argument.
			assert.deepStrictEqual(yield* commitsThatAdd(source, ["a.md"]), [Option.some(sha["add-a"] as string)]);
			assert.deepStrictEqual(yield* oracle(source, ["a.md"]), [undefined]);
		}),
	);

	it.effect("a repeated path answers every position", () =>
		Effect.gen(function* () {
			const ours = yield* commitsThatAdd(source, ["c.md", "c.md"]);
			assert.deepStrictEqual(asUndefined(ours), [sha["add-c"], sha["add-c"]]);
		}),
	);

	it.effect("outside a repository fails with NotARepositoryError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(commitsThatAdd(root, ["c.md"]));
			assert.instanceOf(error, NotARepositoryError);
		}),
	);
});

describe("Git.commitsThatAdd in a shallow clone", () => {
	it.effect("without deepen, fails with ShallowHistoryError instead of crediting the boundary commit", () =>
		Effect.gen(function* () {
			const clone = shallowClone();
			const error = yield* Effect.flip(commitsThatAdd(clone, ["b.md", "never-added.md", "c.md"]));
			assert.instanceOf(error, ShallowHistoryError);
			if (!(error instanceof ShallowHistoryError)) return;
			assert.deepStrictEqual(error.paths, ["b.md", "c.md"]);
			assert.strictEqual(error.rounds, 0);
			// Nothing was fetched: the clone is exactly as shallow as before.
			assert.strictEqual(fixtureGit(clone, ["rev-parse", "--is-shallow-repository"]), "true");
			assert.strictEqual(fixtureGit(clone, ["rev-list", "--count", "HEAD"]), "1");
		}),
	);

	it.effect("a path never added resolves to none in a shallow clone without deepening", () =>
		Effect.gen(function* () {
			const clone = shallowClone();
			assert.deepStrictEqual(yield* commitsThatAdd(clone, ["never-added.md"]), [Option.none()]);
		}),
	);

	it.effect("with deepen, walks back round by round and agrees with the oracle on its own clone", () =>
		Effect.gen(function* () {
			const paths = ["c.md", "b.md", "with space.md", "never-added.md"];
			const ours = yield* commitsThatAdd(shallowClone(), paths, { deepen: { by: 2 } });
			assert.deepStrictEqual(asUndefined(ours), [sha["add-c"], sha["add-a"], sha["add-spaced"], undefined]);
			assert.deepStrictEqual(asUndefined(ours), yield* oracle(shallowClone(), paths));
		}),
	);

	it.effect("stops once the tip's own add resolves, without deepening to the root", () =>
		Effect.gen(function* () {
			const clone = shallowClone();
			const ours = yield* commitsThatAdd(clone, ["c.md"], { deepen: { by: 1 } });
			assert.deepStrictEqual(asUndefined(ours), [sha["add-c"]]);
			// One round gave HEAD its parent, which was enough.
			assert.strictEqual(fixtureGit(clone, ["rev-list", "--count", "HEAD"]), "2");
			assert.strictEqual(fixtureGit(clone, ["rev-parse", "--is-shallow-repository"]), "true");
		}),
	);

	it.effect("fails with ShallowHistoryError once maxRounds rounds have run", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(commitsThatAdd(shallowClone(), ["b.md"], { deepen: { by: 1, maxRounds: 2 } }));
			assert.instanceOf(error, ShallowHistoryError);
			if (!(error instanceof ShallowHistoryError)) return;
			assert.deepStrictEqual(error.paths, ["b.md"]);
			assert.strictEqual(error.rounds, 2);
		}),
	);

	it.effect("refuses a non-positive deepen step before spawning anything", () =>
		Effect.gen(function* () {
			const clone = shallowClone();
			for (const deepen of [{ by: 0 }, { by: 1.5 }, { maxRounds: 0 }, { by: Number.NaN }]) {
				const error = yield* Effect.flip(commitsThatAdd(clone, ["b.md"], { deepen }));
				assert.instanceOf(error, GitCommandError);
				if (!(error instanceof GitCommandError)) return;
				assert.strictEqual(error.kind, "refused");
			}
			assert.strictEqual(fixtureGit(clone, ["rev-list", "--count", "HEAD"]), "1");
		}),
	);

	it.effect("a failed deepen fetch surfaces as GitCommandError", () =>
		Effect.gen(function* () {
			const clone = shallowClone();
			const error = yield* Effect.flip(commitsThatAdd(clone, ["b.md"], { deepen: { remote: "no-such-remote" } }));
			assert.instanceOf(error, GitCommandError);
		}),
	);
});
