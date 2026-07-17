import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, PlatformError, Result } from "effect";
import { TestClock } from "effect/testing";
import {
	Git,
	GitCommandError,
	LsTreeEntry,
	NameStatusEntry,
	NotARepositoryError,
	StatusEntry,
	UnknownRefError,
} from "../src/Git.js";
import type { ScriptResult } from "./fixtures.js";
import { scripted } from "./fixtures.js";

const cwd = "/repo";

/** Runs `program` (which requires `Git`) against `Git.layer` over a scripted spawner. */
const run = <A, E>(program: Effect.Effect<A, E, Git>, byArgs: (args: ReadonlyArray<string>) => ScriptResult) =>
	program.pipe(Effect.provide(Git.layer), Effect.provide(scripted(byArgs)));

describe("Git", () => {
	describe("show", () => {
		it.effect("returns Option.some(contents) on a successful run — happy path", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.show(cwd, "HEAD", "package.json");
				});
				const result = yield* run(program, () => ({ stdout: '{ "name": "pkg" }\n', exit: 0 }));
				assert.deepStrictEqual(result, Option.some('{ "name": "pkg" }\n'));
			}),
		);

		it.effect("absent-at-ref degrades to Option.none, never an error", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.show(cwd, "HEAD", "missing.txt");
				});
				const result = yield* run(program, () => ({
					stderr: "fatal: path 'missing.txt' does not exist in 'HEAD'\n",
					exit: 128,
				}));
				assert.deepStrictEqual(result, Option.none());
			}),
		);
	});

	describe("lsTree", () => {
		it.effect("parses -z NUL-split entries, including a path with a space and a path with a newline", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.lsTree(cwd, "HEAD");
				});
				const entries = [
					"100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\tfile with space.txt",
					"100644 blob 3f786850e387550fdab836ed7e6dc881de23001b\tline\none.txt",
				].join("\0");
				const result = yield* run(program, () => ({ stdout: `${entries}\0`, exit: 0 }));
				assert.deepStrictEqual(result, [
					LsTreeEntry.make({
						mode: "100644",
						type: "blob",
						oid: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
						path: "file with space.txt",
					}),
					LsTreeEntry.make({
						mode: "100644",
						type: "blob",
						oid: "3f786850e387550fdab836ed7e6dc881de23001b",
						path: "line\none.txt",
					}),
				]);
			}),
		);
	});

	describe("refExists", () => {
		it.effect("is true on a successful run", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.refExists(cwd, "HEAD");
				});
				const result = yield* run(program, () => ({ exit: 0 }));
				assert.isTrue(result);
			}),
		);

		it.effect("is false on a non-zero exit with empty stderr", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.refExists(cwd, "nonexistent");
				});
				const result = yield* run(program, () => ({ exit: 1 }));
				assert.isFalse(result);
			}),
		);

		it.effect("is false when git classifies the ref as unknown (Not a valid object name), never a defect", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.refExists(cwd, "feature-xyz");
				});
				const result = yield* run(program, () => ({
					stderr: "fatal: Not a valid object name feature-xyz\n",
					exit: 128,
				}));
				assert.isFalse(result);
			}),
		);
	});

	describe("mergeBase", () => {
		it.effect("returns the trimmed SHA", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.mergeBase(cwd, "main", "feat/git");
				});
				const result = yield* run(program, () => ({ stdout: "abc123\n", exit: 0 }));
				assert.strictEqual(result, "abc123");
			}),
		);
	});

	describe("revParse", () => {
		it.effect("returns the trimmed SHA", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				const result = yield* run(program, () => ({ stdout: "def456\n", exit: 0 }));
				assert.strictEqual(result, "def456");
			}),
		);
	});

	describe("changedFiles", () => {
		it.effect("parses -z NUL-split paths", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.changedFiles(cwd, { base: "main", head: "feat/git" });
				});
				const result = yield* run(program, () => ({ stdout: "a.ts\0b.ts\0", exit: 0 }));
				assert.deepStrictEqual(result, ["a.ts", "b.ts"]);
			}),
		);
	});

	describe("workingChanges", () => {
		// Routes the scripted spawner by argv: `--cached` is the staged query,
		// `ls-files` the untracked one, any other `diff` the unstaged one.
		const scriptWorkingTree = (byKind: {
			unstaged: string;
			staged: string;
			untracked: string;
		}): ((args: ReadonlyArray<string>) => ScriptResult) => {
			return (args) => {
				if (args[0] === "ls-files") return { stdout: byKind.untracked, exit: 0 };
				if (args.includes("--cached")) return { stdout: byKind.staged, exit: 0 };
				return { stdout: byKind.unstaged, exit: 0 };
			};
		};

		it.effect("unions unstaged, staged and untracked paths, deduplicated", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.workingChanges(cwd, { relative: true });
				});
				const result = yield* run(
					program,
					scriptWorkingTree({
						unstaged: "shared.ts\0unstaged.ts\0",
						staged: "shared.ts\0staged.ts\0",
						untracked: "untracked.ts\0",
					}),
				);
				// `shared.ts` appears in both the unstaged and staged runs — the union
				// must dedupe it to a single entry.
				assert.deepStrictEqual([...result].sort(), ["shared.ts", "staged.ts", "unstaged.ts", "untracked.ts"]);
			}),
		);

		// Captures the argv of every spawned command for one workingChanges run.
		const argvOf = (options: { readonly relative?: boolean }) =>
			Effect.gen(function* () {
				const seen: Array<ReadonlyArray<string>> = [];
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.workingChanges(cwd, options);
				});
				yield* run(program, (args) => {
					seen.push([...args]);
					return { stdout: "", exit: 0 };
				});
				return {
					diffs: seen.filter((args) => args[0] === "diff"),
					lsFiles: seen.filter((args) => args[0] === "ls-files"),
				};
			});

		it.effect(
			"relative:true — BOTH diffs carry --relative and ls-files is cwd-relative (no --relative, no --full-name)",
			() =>
				Effect.gen(function* () {
					const { diffs, lsFiles } = yield* argvOf({ relative: true });
					assert.strictEqual(diffs.length, 2);
					// All three sources share the cwd-relative base: --relative on the diffs
					// (and never --no-relative), plain ls-files (which is cwd-relative by default).
					assert.isTrue(diffs.every((args) => args.includes("--relative")));
					assert.isTrue(diffs.every((args) => !args.includes("--no-relative")));
					assert.strictEqual(lsFiles.length, 1);
					assert.isFalse(lsFiles[0]?.includes("--relative"));
					assert.isFalse(lsFiles[0]?.includes("--full-name"));
				}),
		);

		it.effect(
			"relative:false — BOTH diffs carry an explicit --no-relative and ls-files gets --full-name (all three repo-root-relative)",
			() =>
				Effect.gen(function* () {
					const { diffs, lsFiles } = yield* argvOf({ relative: false });
					assert.strictEqual(diffs.length, 2);
					// All three sources share the repo-root base: an EXPLICIT --no-relative on
					// the diffs (so an inherited diff.relative=true cannot make them
					// cwd-relative), and --full-name on ls-files (which would otherwise be
					// cwd-relative).
					assert.isTrue(diffs.every((args) => args.includes("--no-relative")));
					assert.isTrue(diffs.every((args) => !args.includes("--relative")));
					assert.strictEqual(lsFiles.length, 1);
					assert.isTrue(lsFiles[0]?.includes("--full-name"));
				}),
		);

		it.effect("surfaces NotARepositoryError when cwd is not a repository", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.workingChanges(cwd, {});
				});
				const failure = yield* Effect.flip(
					run(program, () => ({
						stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
						exit: 128,
					})),
				);
				assert.instanceOf(failure, NotARepositoryError);
			}),
		);
	});

	describe("checkout", () => {
		it.effect("returns void on a successful run", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.checkout(cwd, "feat/git");
				});
				const result = yield* run(program, () => ({ exit: 0 }));
				assert.isUndefined(result);
			}),
		);
	});

	describe("classification taxonomy", () => {
		it.effect("stderr 'not a git repository' yields NotARepositoryError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({
						stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
						exit: 128,
					})),
				);
				assert.instanceOf(failure, NotARepositoryError);
			}),
		);

		it.effect("stderr 'unknown revision' yields UnknownRefError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "nonexistent");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({
						stderr: "fatal: ambiguous argument 'nonexistent': unknown revision or path not in the working tree.\n",
						exit: 128,
					})),
				);
				assert.instanceOf(failure, UnknownRefError);
			}),
		);

		it.effect("stderr 'bad revision' yields UnknownRefError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.mergeBase(cwd, "main", "nonexistent");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({ stderr: "fatal: bad revision 'nonexistent'\n", exit: 128 })),
				);
				assert.instanceOf(failure, UnknownRefError);
			}),
		);

		it.effect("stderr 'Not a valid object name' yields UnknownRefError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "nonexistent");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({ stderr: "fatal: Not a valid object name nonexistent\n", exit: 128 })),
				);
				assert.instanceOf(failure, UnknownRefError);
			}),
		);

		it.effect("stderr 'invalid object name' yields UnknownRefError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.mergeBase(cwd, "main", "nonexistent");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({ stderr: "fatal: invalid object name 'nonexistent'.\n", exit: 128 })),
				);
				assert.instanceOf(failure, UnknownRefError);
			}),
		);

		it.effect("an unrecognized failure falls through to GitCommandError with exitCode/stderr intact", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				const failure = yield* Effect.flip(
					run(program, () => ({ stderr: "fatal: something unrecognized went wrong\n", exit: 2 })),
				);
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.strictEqual(failure.exitCode, 2);
					assert.strictEqual(failure.stderr, "fatal: something unrecognized went wrong\n");
				}
			}),
		);

		it.effect("a spawn-level PlatformError is absorbed into GitCommandError, never leaked raw", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				const failure = yield* Effect.flip(
					run(program, () => PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" })),
				);
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.strictEqual(failure.detail, "git is not installed (or the working directory does not exist)");
				}
			}),
		);

		it.effect("a non-NotFound spawn failure keeps the underlying diagnostic in detail", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				const failure = yield* Effect.flip(
					run(program, () =>
						PlatformError.systemError({
							_tag: "PermissionDenied",
							module: "ChildProcess",
							method: "spawn",
							description: "EACCES on git binary",
						}),
					),
				);
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.isDefined(failure.detail);
					assert.isTrue(failure.detail?.startsWith("spawn failed: PermissionDenied:"));
					assert.include(failure.detail ?? "", "EACCES on git binary");
				}
			}),
		);

		it.effect("a run that never completes fails with GitCommandError after the 30s ceiling", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "HEAD");
				});
				// The mock's exitCode effect is Effect.never — the operation only
				// resolves once Effect.timeoutOrElse's own duration elapses. Fork so
				// the current fiber can drive the virtual clock forward past it.
				const fiber = yield* Effect.forkChild(Effect.flip(run(program, () => ({ hang: true }))));
				yield* TestClock.adjust("31 seconds");
				const failure = yield* Fiber.join(fiber);
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.strictEqual(failure.detail, "timed out after 30s");
				}
			}),
		);
	});

	describe("option-injection guard", () => {
		// A spawner that fails the test if it is ever reached: the guard must
		// refuse option-like refs BEFORE any spawn. A throw here would surface as
		// a defect, and Effect.flip on a defect fails the test.
		const neverSpawn = (): ScriptResult => {
			throw new Error("spawned — the option-injection guard did not fire");
		};

		it.effect("checkout refuses a ref git would parse as an option, before spawning", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.checkout(cwd, "-b");
				});
				const failure = yield* Effect.flip(run(program, neverSpawn));
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.include(failure.detail ?? "", "parse as an option");
					assert.deepStrictEqual([...failure.args], ["-b"]);
				}
			}),
		);

		it.effect("show refuses an option-like ref before spawning", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.show(cwd, "--help", "package.json");
				});
				const failure = yield* Effect.flip(run(program, neverSpawn));
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.include(failure.detail ?? "", "parse as an option");
				}
			}),
		);

		it.effect("mergeBase guards BOTH refs — the second alone is refused too", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.mergeBase(cwd, "main", "--fork-point");
				});
				const failure = yield* Effect.flip(run(program, neverSpawn));
				assert.instanceOf(failure, GitCommandError);
				if (failure instanceof GitCommandError) {
					assert.deepStrictEqual([...failure.args], ["--fork-point"]);
				}
			}),
		);

		it.effect("changedFiles guards base and head", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.changedFiles(cwd, { base: "-Otrust", head: "HEAD" });
				});
				const failure = yield* Effect.flip(run(program, neverSpawn));
				assert.instanceOf(failure, GitCommandError);
			}),
		);

		it.effect("a dash INSIDE a ref is fine — only a leading dash is refused", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.revParse(cwd, "feat/point-in-time");
				});
				const sha = yield* run(program, () => ({ stdout: "a".repeat(40), exit: 0 }));
				assert.strictEqual(sha, "a".repeat(40));
			}),
		);
	});

	describe("nameStatus", () => {
		it.effect("parses plain, scored-rename and copy entries from -z output", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.nameStatus(cwd, { base: "abc123" });
				});
				const output = [
					"M",
					"a.txt",
					"D",
					"b.txt",
					"R100",
					"old name.txt",
					"new\nname.txt",
					"C75",
					"src.txt",
					"copy.txt",
					"A",
					"staged.txt",
				].join("\0");
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["diff", "--name-status", "-z", "--no-relative", "abc123"]);
					return { stdout: `${output}\0`, exit: 0 };
				});
				assert.deepStrictEqual(result, [
					NameStatusEntry.make({ status: "modified", path: "a.txt" }),
					NameStatusEntry.make({ status: "deleted", path: "b.txt" }),
					NameStatusEntry.make({ status: "renamed", path: "new\nname.txt", oldPath: "old name.txt" }),
					NameStatusEntry.make({ status: "copied", path: "copy.txt", oldPath: "src.txt" }),
					NameStatusEntry.make({ status: "added", path: "staged.txt" }),
				]);
			}),
		);

		it.effect("builds the base...head form when head is present", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.nameStatus(cwd, { base: "main", head: "feat/x" });
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["diff", "--name-status", "-z", "--no-relative", "main...feat/x"]);
					return { stdout: "", exit: 0 };
				});
				assert.deepStrictEqual(result, []);
			}),
		);

		it.effect("guards both refs against option-like values without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.nameStatus(cwd, { base: "main", head: "--output=/tmp/x" });
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("an unknown base surfaces as UnknownRefError labeled with the range", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.nameStatus(cwd, { base: "nope", head: "HEAD" });
				});
				const exit = yield* Effect.exit(
					run(program, () => ({ stderr: "fatal: bad revision 'nope...HEAD'\n", exit: 128 })),
				);
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					const found = Cause.findFail(exit.cause);
					assert.isTrue(Result.isSuccess(found));
					if (Result.isSuccess(found)) {
						assert.instanceOf(found.success.error, UnknownRefError);
						assert.strictEqual((found.success.error as UnknownRefError).ref, "nope...HEAD");
					}
				}
			}),
		);
	});

	describe("working-tree primitives (promoted)", () => {
		it.effect("unstagedChanges runs the bare name-only diff and NUL-splits", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.unstagedChanges(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["diff", "--name-only", "-z", "--no-relative"]);
					return { stdout: "a.txt\0b with space.txt\0", exit: 0 };
				});
				assert.deepStrictEqual(result, ["a.txt", "b with space.txt"]);
			}),
		);

		it.effect("stagedChanges passes --cached", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.stagedChanges(cwd, { relative: true });
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["diff", "--name-only", "-z", "--relative", "--cached"]);
					return { stdout: "staged.txt\0", exit: 0 };
				});
				assert.deepStrictEqual(result, ["staged.txt"]);
			}),
		);

		it.effect("untrackedFiles runs ls-files with --full-name when not relative", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.untrackedFiles(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["ls-files", "--others", "--exclude-standard", "-z", "--full-name"]);
					return { stdout: "new.txt\0", exit: 0 };
				});
				assert.deepStrictEqual(result, ["new.txt"]);
			}),
		);
	});

	describe("lsTree pathspec", () => {
		it.effect("appends the pathspec behind -- and still parses entries", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.lsTree(cwd, "HEAD", { pathspec: [".changeset"] });
				});
				const entry = "100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\t.changeset/a.md";
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["ls-tree", "-r", "-z", "HEAD", "--", ".changeset"]);
					return { stdout: `${entry}\0`, exit: 0 };
				});
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0]?.path, ".changeset/a.md");
			}),
		);
	});

	describe("defaultBranch", () => {
		it.effect("strips the remote prefix from the symbolic-ref answer", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.defaultBranch(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
					return { stdout: "origin/main\n", exit: 0 };
				});
				assert.deepStrictEqual(result, Option.some("main"));
			}),
		);

		it.effect("an unset origin/HEAD (exit 1, silent) degrades to Option.none", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.defaultBranch(cwd);
				});
				const result = yield* run(program, () => ({ exit: 1 }));
				assert.deepStrictEqual(result, Option.none());
			}),
		);

		it.effect("exit 1 WITH stderr is still a failure, not none", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.defaultBranch(cwd);
				});
				const exit = yield* Effect.exit(run(program, () => ({ stderr: "fatal: something else\n", exit: 1 })));
				assert.isTrue(Exit.isFailure(exit));
			}),
		);
	});

	describe("currentBranch", () => {
		it.effect("returns the branch name", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.currentBranch(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["rev-parse", "--abbrev-ref", "HEAD"]);
					return { stdout: "feat/git-updates\n", exit: 0 };
				});
				assert.deepStrictEqual(result, Option.some("feat/git-updates"));
			}),
		);

		it.effect("a detached HEAD (literal 'HEAD' answer) degrades to Option.none", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.currentBranch(cwd);
				});
				const result = yield* run(program, () => ({ stdout: "HEAD\n", exit: 0 }));
				assert.deepStrictEqual(result, Option.none());
			}),
		);
	});

	describe("repoRoot", () => {
		it.effect("returns the trimmed toplevel path", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.repoRoot(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["rev-parse", "--show-toplevel"]);
					return { stdout: "/repo\n", exit: 0 };
				});
				assert.strictEqual(result, "/repo");
			}),
		);
	});

	describe("configGet", () => {
		it.effect("returns the trimmed value", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configGet(cwd, "user.signingkey");
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["config", "--get", "user.signingkey"]);
					return { stdout: "ABC123\n", exit: 0 };
				});
				assert.deepStrictEqual(result, Option.some("ABC123"));
			}),
		);

		it.effect("an unset key (exit 1, silent) degrades to Option.none", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configGet(cwd, "user.signingkey");
				});
				const result = yield* run(program, () => ({ exit: 1 }));
				assert.deepStrictEqual(result, Option.none());
			}),
		);

		it.effect("guards an option-like key without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configGet(cwd, "--global");
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);
	});

	describe("remoteUrl", () => {
		it.effect("returns the trimmed URL", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.remoteUrl(cwd);
				});
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["remote", "get-url", "origin"]);
					return { stdout: "git@github.com:o/r.git\n", exit: 0 };
				});
				assert.deepStrictEqual(result, Option.some("git@github.com:o/r.git"));
			}),
		);

		it.effect("a missing remote degrades to Option.none", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.remoteUrl(cwd, { remote: "upstream" });
				});
				const result = yield* run(program, () => ({ stderr: "error: No such remote 'upstream'\n", exit: 2 }));
				assert.deepStrictEqual(result, Option.none());
			}),
		);
	});

	describe("commitInfo", () => {
		it.effect("splits the NUL-separated format and keeps the message untrimmed", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.commitInfo(cwd);
				});
				const sha = "f78d2940dca62faf93051f94c54d5c7c24d465a8";
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["log", "-1", "--format=%H%x00%G?%x00%B", "HEAD"]);
					return { stdout: `${sha}\0N\0feat: second commit\n\nbody line\n\n`, exit: 0 };
				});
				assert.strictEqual(result.sha, sha);
				assert.strictEqual(result.signatureStatus, "N");
				assert.strictEqual(result.message, "feat: second commit\n\nbody line\n\n");
			}),
		);

		it.effect("passes an explicit ref through, guarded", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.commitInfo(cwd, "--all");
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);
	});

	describe("status", () => {
		it.effect("parses XY codes, paths and the inverted rename order", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.status(cwd);
				});
				// R entries in porcelain -z order NEW path first, then ORIGINAL.
				const output = [
					"M  a.txt",
					"D  b.txt",
					"R  renamed.txt",
					"sub/c.txt",
					"A  staged.txt",
					"?? untracked.txt",
				].join("\0");
				const result = yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["status", "--porcelain", "-z"]);
					return { stdout: `${output}\0`, exit: 0 };
				});
				assert.deepStrictEqual(result, [
					StatusEntry.make({ x: "M", y: " ", path: "a.txt" }),
					StatusEntry.make({ x: "D", y: " ", path: "b.txt" }),
					StatusEntry.make({ x: "R", y: " ", path: "renamed.txt", origPath: "sub/c.txt" }),
					StatusEntry.make({ x: "A", y: " ", path: "staged.txt" }),
					StatusEntry.make({ x: "?", y: "?", path: "untracked.txt" }),
				]);
			}),
		);

		it.effect("a clean tree is an empty array", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.status(cwd);
				});
				const result = yield* run(program, () => ({ stdout: "", exit: 0 }));
				assert.deepStrictEqual(result, []);
			}),
		);
	});

	describe("mutating tier", () => {
		it.effect("checkout --detach passes the flag through", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.checkout(cwd, "FETCH_HEAD", { detach: true });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["checkout", "--detach", "FETCH_HEAD"]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("fetch composes depth, remote, tag keyword and ref — both guarded", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.fetch(cwd, { ref: "v1.0.0", depth: 1, tag: true });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["fetch", "--depth", "1", "origin", "tag", "v1.0.0"]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("fetch of a ref the remote does not have fails typed as UnknownRefError", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.fetch(cwd, { ref: "v9.9.9", tag: true });
				});
				const exit = yield* Effect.exit(
					run(program, () => ({ stderr: "fatal: couldn't find remote ref refs/tags/v9.9.9\n", exit: 128 })),
				);
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					// Cause.failureOption does not exist at beta.98 — findFail returns a Result.
					const found = Cause.findFail(exit.cause);
					assert.isTrue(Result.isSuccess(found) && found.success.error instanceof UnknownRefError);
				}
			}),
		);

		it.effect("submoduleUpdate composes init, depth and paths behind --", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.submoduleUpdate(cwd, { init: true, depth: 1, paths: [".repos/effect-smol"] });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["submodule", "update", "--init", "--depth", "1", "--", ".repos/effect-smol"]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("submoduleAdd places url and path behind --", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.submoduleAdd(cwd, { url: "https://example.com/r.git", path: ".repos/r", depth: 1 });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, [
						"submodule",
						"add",
						"--depth",
						"1",
						"--",
						"https://example.com/r.git",
						".repos/r",
					]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("sparseCheckoutSet is explicit about the cone flag and guards patterns", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.sparseCheckoutSet(cwd, ["packages/effect", "migration"], { cone: false });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["sparse-checkout", "set", "--no-cone", "packages/effect", "migration"]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("sparseCheckoutSet refuses an option-like pattern without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.sparseCheckoutSet(cwd, ["--cone-mode=evil"], { cone: false });
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("configSet writes into an explicit file and guards key, value and file", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configSet(cwd, "submodule.a.shallow", "true", { file: ".gitmodules" });
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["config", "-f", ".gitmodules", "submodule.a.shallow", "true"]);
					return { exit: 0 };
				});
			}),
		);

		it.effect("configSet refuses an option-like VALUE without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configSet(cwd, "alias.x", "--exec=evil");
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("configSet refuses an option-like KEY without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configSet(cwd, "--global", "true");
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("configSet refuses an option-like FILE without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.configSet(cwd, "alias.x", "true", { file: "--blob=evil" });
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("fetch refuses an option-like REMOTE without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.fetch(cwd, { ref: "main", remote: "--upload-pack=evil" });
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("fetch refuses an option-like REF without spawning", () =>
			Effect.gen(function* () {
				let spawned = false;
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.fetch(cwd, { ref: "--tags" });
				});
				const exit = yield* Effect.exit(
					run(program, () => {
						spawned = true;
						return { exit: 0 };
					}),
				);
				assert.isTrue(Exit.isFailure(exit));
				assert.isFalse(spawned);
			}),
		);

		it.effect("add stages paths behind -- so option-like paths are inert", () =>
			Effect.gen(function* () {
				const program = Effect.gen(function* () {
					const git = yield* Git;
					return yield* git.add(cwd, [".gitmodules", "-weird-but-legal-behind-dashdash"]);
				});
				yield* run(program, (args) => {
					assert.deepStrictEqual(args, ["add", "--", ".gitmodules", "-weird-but-legal-behind-dashdash"]);
					return { exit: 0 };
				});
			}),
		);
	});
});
