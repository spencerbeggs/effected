import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";

import { GitCommand } from "../src/GitCommand.js";

const expectedEnv = { LC_ALL: "C" };

/**
 * Asserts the argv/env/extendEnv/no-cwd shape shared by every `GitCommand`
 * constructor.
 */
const assertGitCommand = (command: ChildProcess.Command, expectedArgs: ReadonlyArray<string>): void => {
	assert.isTrue(ChildProcess.isStandardCommand(command));
	if (!ChildProcess.isStandardCommand(command)) return;
	assert.strictEqual(command.command, "git");
	assert.deepStrictEqual(command.args, expectedArgs);
	assert.deepStrictEqual(command.options.env, expectedEnv);
	assert.strictEqual(command.options.extendEnv, true);
	assert.isUndefined(command.options.cwd);
};

describe("GitCommand", () => {
	it("show builds `git show <ref>:<path>`", () => {
		assertGitCommand(GitCommand.show("HEAD", "package.json"), ["show", "HEAD:package.json"]);
	});

	it("lsTree builds `git ls-tree -r -z <ref>`", () => {
		assertGitCommand(GitCommand.lsTree("HEAD"), ["ls-tree", "-r", "-z", "HEAD"]);
	});

	it("refExists builds `git cat-file -e <ref>`", () => {
		assertGitCommand(GitCommand.refExists("HEAD"), ["cat-file", "-e", "HEAD"]);
	});

	it("mergeBase builds `git merge-base <a> <b>`", () => {
		assertGitCommand(GitCommand.mergeBase("main", "feat/git"), ["merge-base", "main", "feat/git"]);
	});

	it("changedFiles builds `git diff --name-only -z --no-relative <base>...<head>`", () => {
		// --no-relative is explicit on the default branch so an inherited
		// diff.relative=true config cannot silently make the output cwd-relative.
		assertGitCommand(GitCommand.changedFiles("main", "feat/git"), [
			"diff",
			"--name-only",
			"-z",
			"--no-relative",
			"main...feat/git",
		]);
	});

	it("changedFiles with relative passes --relative before the range", () => {
		assertGitCommand(GitCommand.changedFiles("main", "feat/git", true), [
			"diff",
			"--name-only",
			"-z",
			"--relative",
			"main...feat/git",
		]);
	});

	it("unstagedChanges builds `git diff --name-only -z`, with an explicit --no-relative/--relative", () => {
		assertGitCommand(GitCommand.unstagedChanges(), ["diff", "--name-only", "-z", "--no-relative"]);
		assertGitCommand(GitCommand.unstagedChanges(true), ["diff", "--name-only", "-z", "--relative"]);
	});

	it("stagedChanges builds `git diff --name-only -z --cached`, with an explicit --no-relative/--relative", () => {
		assertGitCommand(GitCommand.stagedChanges(), ["diff", "--name-only", "-z", "--no-relative", "--cached"]);
		assertGitCommand(GitCommand.stagedChanges(true), ["diff", "--name-only", "-z", "--relative", "--cached"]);
	});

	it("untrackedFiles builds `git ls-files --others --exclude-standard -z`, adding --full-name when NOT relative", () => {
		// Default (repo-root-relative, matching the un-`--relative` diffs) carries
		// --full-name; the cwd-relative form (matching the --relative diffs) omits it.
		assertGitCommand(GitCommand.untrackedFiles(), ["ls-files", "--others", "--exclude-standard", "-z", "--full-name"]);
		assertGitCommand(GitCommand.untrackedFiles(true), ["ls-files", "--others", "--exclude-standard", "-z"]);
	});

	it("revParse builds `git rev-parse --verify <ref>`", () => {
		assertGitCommand(GitCommand.revParse("HEAD"), ["rev-parse", "--verify", "HEAD"]);
	});

	it("checkout builds `git checkout <ref>`", () => {
		assertGitCommand(GitCommand.checkout("feat/git"), ["checkout", "feat/git"]);
	});

	it("setCwd returns a NEW command and leaves the original untouched", () => {
		const original = GitCommand.show("HEAD", "package.json");
		const withCwd = ChildProcess.setCwd(original, "/repo");

		assert.notStrictEqual(withCwd, original);
		if (ChildProcess.isStandardCommand(original)) {
			assert.isUndefined(original.options.cwd);
		}
		if (ChildProcess.isStandardCommand(withCwd)) {
			assert.strictEqual(withCwd.options.cwd, "/repo");
		}
	});
});
