import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Option, PlatformError } from "effect";
import { TestClock } from "effect/testing";
import { Git, GitCommandError, LsTreeEntry, NotARepositoryError, UnknownRefError } from "../src/Git.js";
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
					// All three sources share the cwd-relative base: --relative on the diffs,
					// plain ls-files (which is cwd-relative by default).
					assert.isTrue(diffs.every((args) => args.includes("--relative")));
					assert.strictEqual(lsFiles.length, 1);
					assert.isFalse(lsFiles[0]?.includes("--relative"));
					assert.isFalse(lsFiles[0]?.includes("--full-name"));
				}),
		);

		it.effect(
			"relative:false — NEITHER diff carries --relative and ls-files gets --full-name (all three repo-root-relative)",
			() =>
				Effect.gen(function* () {
					const { diffs, lsFiles } = yield* argvOf({ relative: false });
					assert.strictEqual(diffs.length, 2);
					// All three sources share the repo-root base: no --relative on the diffs,
					// --full-name on ls-files (which would otherwise be cwd-relative).
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
});
