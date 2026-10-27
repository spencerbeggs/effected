import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";
import { Git, GitCommandError, NotARepositoryError, TreeIdentity, UpstreamBranch } from "../src/Git.js";
import { GitCommand } from "../src/GitCommand.js";
import type { ScriptResult } from "./fixtures.js";
import { scripted } from "./fixtures.js";

const cwd = "/repo";

/** Runs `program` against `Git.layer` over a scripted spawner, with an empty ConfigProvider (no host env). */
const run = <A, E>(program: Effect.Effect<A, E, Git>, byArgs: (args: ReadonlyArray<string>) => ScriptResult) =>
	program.pipe(
		Effect.provide(Git.layer),
		Effect.provide(scripted(byArgs)),
		Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
	);

const argsOf = (invocation: { readonly command: unknown }): ReadonlyArray<string> =>
	(invocation.command as { readonly args: ReadonlyArray<string> }).args;

const treeIdentity = Effect.flatMap(Git, (git) => git.treeIdentity(cwd));
const upstream = Effect.flatMap(Git, (git) => git.upstream(cwd));

const NOT_A_REPO = { stderr: "fatal: not a git repository (or any of the parent directories): .git\n", exit: 128 };

describe("Git.treeIdentity", () => {
	it.effect("parses the toplevel and common dir from one spawn", () =>
		Effect.gen(function* () {
			const result = yield* run(treeIdentity, (args) => {
				assert.deepStrictEqual(args, argsOf(GitCommand.treeIdentity()));
				return { stdout: "/private/repo\n/private/repo/.git\n" };
			});
			assert.deepStrictEqual(
				result,
				Option.some(TreeIdentity.make({ toplevel: "/private/repo", commonDir: "/private/repo/.git" })),
			);
		}),
	);

	it.effect("keeps a trailing space on either path and accepts CRLF line ends", () =>
		Effect.gen(function* () {
			const spaced = yield* run(treeIdentity, () => ({ stdout: "/r/a \n/r/a /.git \n" }));
			assert.deepStrictEqual(spaced, Option.some(TreeIdentity.make({ toplevel: "/r/a ", commonDir: "/r/a /.git " })));
			const crlf = yield* run(treeIdentity, () => ({ stdout: "C:/r\r\nC:/r/.git\r\n" }));
			assert.deepStrictEqual(crlf, Option.some(TreeIdentity.make({ toplevel: "C:/r", commonDir: "C:/r/.git" })));
		}),
	);

	it.effect("is Option.none outside a repository", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* run(treeIdentity, () => NOT_A_REPO), Option.none());
		}),
	);

	it.effect("is Option.none with no working tree (the 'tree' classify row)", () =>
		Effect.gen(function* () {
			const result = yield* run(treeIdentity, () => ({
				stderr: "fatal: this operation must be run in a work tree\n",
				exit: 128,
			}));
			assert.deepStrictEqual(result, Option.none());
		}),
	);

	it.effect("fails GitCommandError when an old git echoes --path-format as a third line", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(treeIdentity, () => ({ stdout: "/repo\n--path-format=absolute\n.git\n" })));
			assert.instanceOf(error, GitCommandError);
			assert.strictEqual(error.kind, "failed");
			assert.include(error.detail ?? "", "2.31");
		}),
	);

	// The line-count guard and the dash guard each catch the old-git echo on
	// their own, so each needs an input only it rejects.
	it.effect("the line-count guard alone: three lines, none dash-led", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(treeIdentity, () => ({ stdout: "/a\n/b\n/c\n" })));
			assert.instanceOf(error, GitCommandError);
		}),
	);

	it.effect("the dash guard alone: two lines, the second an echoed flag", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(treeIdentity, () => ({ stdout: "/repo\n--path-format=absolute\n" })));
			assert.instanceOf(error, GitCommandError);
		}),
	);

	it.effect("fails GitCommandError on a single-line answer", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(treeIdentity, () => ({ stdout: "/repo\n" })));
			assert.instanceOf(error, GitCommandError);
		}),
	);

	it.effect("fails GitCommandError on any other git failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(treeIdentity, () => ({ stderr: "fatal: something else\n", exit: 128 })));
			assert.instanceOf(error, GitCommandError);
		}),
	);

	it.effect("repoRoot keeps failing GitCommandError with no working tree: the row is scoped to treeIdentity", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.repoRoot(cwd)),
					() => ({
						stderr: "fatal: this operation must be run in a work tree\n",
						exit: 128,
					}),
				),
			);
			assert.instanceOf(error, GitCommandError);
		}),
	);
});

describe("TreeIdentity", () => {
	const main = TreeIdentity.make({ toplevel: "/r/main", commonDir: "/r/main/.git" });
	const sibling = TreeIdentity.make({ toplevel: "/r/wt", commonDir: "/r/main/.git" });
	const other = TreeIdentity.make({ toplevel: "/r/main", commonDir: "/elsewhere/.git" });

	it("relation distinguishes same tree, sibling worktree and different repository", () => {
		assert.strictEqual(TreeIdentity.relation(main, TreeIdentity.make({ ...main })), "same-tree");
		assert.strictEqual(TreeIdentity.relation(main, sibling), "sibling-worktree");
		assert.strictEqual(TreeIdentity.relation(main, other), "different-repo");
	});

	it("a shared toplevel with a different common dir is a different repository, not the same tree", () => {
		assert.strictEqual(TreeIdentity.relation(other, main), "different-repo");
	});

	it("relation is dual (data-last)", () => {
		assert.strictEqual(TreeIdentity.relation(sibling)(main), "sibling-worktree");
	});
});

describe("Git.upstream", () => {
	const FORMAT = "%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:track,nobracket)";

	/** Scripts `symbolic-ref` with `head` and `for-each-ref` with `record`, asserting the argv. */
	const twoStep =
		(head: ScriptResult, record: ScriptResult) =>
		(args: ReadonlyArray<string>): ScriptResult => {
			if (args[0] === "symbolic-ref") {
				assert.deepStrictEqual(args, ["symbolic-ref", "--quiet", "HEAD"]);
				return head;
			}
			assert.deepStrictEqual(args, ["for-each-ref", `--format=${FORMAT}`, "refs/heads/main"]);
			return record;
		};

	const HEAD = { stdout: "refs/heads/main\n" };
	const line = (track: string, ref = "refs/remotes/origin/main", name = "origin/main") =>
		`refs/heads/main\0${ref}\0${name}\0${track}\n`;

	const cases: ReadonlyArray<readonly [string, number, number]> = [
		["", 0, 0],
		["ahead 3", 3, 0],
		["behind 2", 0, 2],
		["ahead 3, behind 12", 3, 12],
	];
	for (const [track, ahead, behind] of cases) {
		it.effect(`parses tracking state ${JSON.stringify(track)}`, () =>
			Effect.gen(function* () {
				const result = yield* run(upstream, twoStep(HEAD, { stdout: line(track) }));
				assert.deepStrictEqual(
					result,
					Option.some(
						UpstreamBranch.make({ ref: "refs/remotes/origin/main", name: "origin/main", gone: false, ahead, behind }),
					),
				);
			}),
		);
	}

	it.effect("reports a gone upstream with zero counts", () =>
		Effect.gen(function* () {
			const result = yield* run(upstream, twoStep(HEAD, { stdout: line("gone") }));
			assert.deepStrictEqual(
				result,
				Option.some(
					UpstreamBranch.make({
						ref: "refs/remotes/origin/main",
						name: "origin/main",
						gone: true,
						ahead: 0,
						behind: 0,
					}),
				),
			);
		}),
	);

	it.effect("keeps only the exact branch record when the pattern also matches refs below it", () =>
		Effect.gen(function* () {
			const result = yield* run(
				upstream,
				twoStep(HEAD, {
					stdout: `refs/heads/main/x\0refs/remotes/origin/x\0origin/x\0\n${line("ahead 1")}`,
				}),
			);
			assert.strictEqual(Option.getOrThrow(result).name, "origin/main");
		}),
	);

	it.effect("is Option.none for a detached HEAD, without a second spawn", () =>
		Effect.gen(function* () {
			let spawns = 0;
			const result = yield* run(upstream, (args) => {
				spawns++;
				assert.strictEqual(args[0], "symbolic-ref");
				return { exit: 1 };
			});
			assert.deepStrictEqual(result, Option.none());
			assert.strictEqual(spawns, 1);
		}),
	);

	it.effect("is Option.none with no upstream configured, and for an unborn branch (no record)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* run(upstream, twoStep(HEAD, { stdout: "refs/heads/main\0\0\0\n" })), Option.none());
			assert.deepStrictEqual(yield* run(upstream, twoStep(HEAD, { stdout: "" })), Option.none());
		}),
	);

	it.effect("fails NotARepositoryError outside a repository", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(upstream, () => NOT_A_REPO));
			assert.instanceOf(error, NotARepositoryError);
		}),
	);

	it.effect("fails GitCommandError on a tracking state git's C locale never writes", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(upstream, twoStep(HEAD, { stdout: line("en avance de 1") })));
			assert.instanceOf(error, GitCommandError);
			const glued = yield* Effect.flip(run(upstream, twoStep(HEAD, { stdout: line("ahead 1behind 2") })));
			assert.instanceOf(glued, GitCommandError);
		}),
	);

	it.effect("a symbolic-ref that fails with stderr is a GitCommandError, not a detached HEAD", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(run(upstream, () => ({ stderr: "fatal: boom\n", exit: 1 })));
			assert.instanceOf(error, GitCommandError);
		}),
	);
});

describe("GitCommandError stderr masking", () => {
	it.effect("masks a credential git echoes, classifying on the raw stream", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.repoRoot(cwd)),
					() => ({
						stderr:
							"warning: url has no scheme: //u:tok3n@github.com/o/r/\nfatal: credential url cannot be parsed: //u:tok3n@github.com/o/r/\nfatal: '//u:tok3n@h/r' does not appear to be a git repository\n",
						exit: 128,
					}),
				),
			);
			assert.instanceOf(error, GitCommandError);
			assert.notInclude(error.stderr, "tok3n");
			assert.notInclude(error.message, "tok3n");
			assert.include(error.stderr, "fatal: credential url cannot be parsed: //<redacted>@github.com/o/r/");
			assert.include(error.stderr, "fatal: '//<redacted>@h/r' does not appear");
		}),
	);

	it.effect("leaves ordinary stderr byte-identical, including an scp remote", () =>
		Effect.gen(function* () {
			const stderr = "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n";
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.repoRoot(cwd)),
					() => ({ stderr, exit: 128 }),
				),
			);
			assert.instanceOf(error, GitCommandError);
			assert.strictEqual(error.stderr, stderr);
		}),
	);

	it.effect("still classifies on the raw stderr: not-a-repository survives the mask", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.upstream(cwd)),
					() => ({
						stderr: "fatal: not a git repository (or any of the parent directories): .git u:tok@h\n",
						exit: 128,
					}),
				),
			);
			assert.instanceOf(error, NotARepositoryError);
		}),
	);
});

describe("GitCommandError stderr: exact-string masking of the argv's own secrets", () => {
	// The shape masker splits tokens at whitespace and quotes, so a password
	// holding one escapes it. classify knows the raw argv: each secret URL's
	// credential text, and each whole-value secret, is masked by exact string.
	const lsRemoteFailure = (remote: string, echo: string) =>
		Effect.flip(
			run(
				Effect.flatMap(Git, (git) => git.lsRemote(cwd, remote)),
				(args) => (args[0] === "ls-remote" ? { stderr: echo, exit: 128 } : { exit: 1 }),
			),
		);

	for (const password of ["to'k3n", 'to"k3n', "to k3n", "to\tk3n"]) {
		it.effect(`masks a password holding ${JSON.stringify(password.replace("to", "").replace("k3n", ""))}`, () =>
			Effect.gen(function* () {
				const remote = `https:://u:${password}@github.com/o/r`;
				const error = yield* lsRemoteFailure(
					remote,
					`warning: url has no scheme: //u:${password}@github.com/o/r/\nfatal: credential url cannot be parsed: //u:${password}@github.com/o/r/\n`,
				);
				assert.instanceOf(error, GitCommandError);
				if (!(error instanceof GitCommandError)) return;
				for (const field of [error.stderr, error.message, JSON.stringify(error)]) {
					assert.notInclude(field, password);
					assert.notInclude(field, "k3n");
				}
				assert.include(error.stderr, "fatal: credential url cannot be parsed: //");
			}),
		);
	}

	it.effect("masks a whole-value secret (a config value) git echoes back", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.configSet(cwd, "http.extraHeader", "Authorization: x s3cr3t'v")),
					() => ({
						stderr: "error: invalid value 'Authorization: x s3cr3t'v' for http.extraHeader\n",
						exit: 1,
					}),
				),
			);
			assert.instanceOf(error, GitCommandError);
			if (!(error instanceof GitCommandError)) return;
			assert.notInclude(error.stderr, "s3cr3t");
			assert.include(error.stderr, "for http.extraHeader");
		}),
	);

	it.effect("never masks a secret shorter than three characters by exact string", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				run(
					Effect.flatMap(Git, (git) => git.configSet(cwd, "core.x", "on")),
					() => ({
						stderr: "error: something went wrong on line 1\n",
						exit: 1,
					}),
				),
			);
			assert.instanceOf(error, GitCommandError);
			if (!(error instanceof GitCommandError)) return;
			assert.strictEqual(error.stderr, "error: something went wrong on line 1\n");
		}),
	);
});
