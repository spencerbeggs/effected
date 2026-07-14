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
});
