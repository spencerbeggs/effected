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

	it("checkout without options is unchanged", () => {
		assertGitCommand(GitCommand.checkout("main"), ["checkout", "main"]);
	});

	it("checkout --detach places the flag before the ref", () => {
		assertGitCommand(GitCommand.checkout("FETCH_HEAD", true), ["checkout", "--detach", "FETCH_HEAD"]);
	});

	it("fetch builds remote-then-ref, with optional depth and tag keyword", () => {
		assertGitCommand(GitCommand.fetch("origin", "main"), ["fetch", "origin", "main"]);
		assertGitCommand(GitCommand.fetch("origin", "v1.0.0", 1, true), [
			"fetch",
			"--depth",
			"1",
			"origin",
			"tag",
			"v1.0.0",
		]);
	});

	it("submoduleUpdate composes --init, --depth and a -- pathspec", () => {
		assertGitCommand(GitCommand.submoduleUpdate(), ["submodule", "update"]);
		assertGitCommand(GitCommand.submoduleUpdate(true, 1, [".repos/effect-smol"]), [
			"submodule",
			"update",
			"--init",
			"--depth",
			"1",
			"--",
			".repos/effect-smol",
		]);
	});

	it("submoduleAdd puts url and path behind a literal --", () => {
		assertGitCommand(GitCommand.submoduleAdd("https://example.com/r.git", ".repos/r", 1), [
			"submodule",
			"add",
			"--depth",
			"1",
			"--",
			"https://example.com/r.git",
			".repos/r",
		]);
	});

	it("sparseCheckoutSet passes the cone flag explicitly in both branches", () => {
		assertGitCommand(GitCommand.sparseCheckoutSet(["src", "docs"], false), [
			"sparse-checkout",
			"set",
			"--no-cone",
			"src",
			"docs",
		]);
		assertGitCommand(GitCommand.sparseCheckoutSet(["src"], true), ["sparse-checkout", "set", "--cone", "src"]);
	});

	it("configSet writes a key, optionally into an explicit file", () => {
		assertGitCommand(GitCommand.configSet("user.name", "Test"), ["config", "user.name", "Test"]);
		assertGitCommand(GitCommand.configSet("submodule.a.shallow", "true", ".gitmodules"), [
			"config",
			"-f",
			".gitmodules",
			"submodule.a.shallow",
			"true",
		]);
	});

	it("add stages paths behind a literal --", () => {
		assertGitCommand(GitCommand.add([".gitmodules", ".repos/r"]), ["add", "--", ".gitmodules", ".repos/r"]);
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

	it("nameStatus builds the working-tree-vs-ref form when head is omitted", () => {
		assertGitCommand(GitCommand.nameStatus("abc123", undefined), [
			"diff",
			"--name-status",
			"-z",
			"--no-relative",
			"abc123",
		]);
	});

	it("nameStatus builds the base...head form when head is present, honoring relative", () => {
		assertGitCommand(GitCommand.nameStatus("main", "feat/x", true), [
			"diff",
			"--name-status",
			"-z",
			"--relative",
			"main...feat/x",
		]);
	});

	it("lsTree without a pathspec is unchanged", () => {
		assertGitCommand(GitCommand.lsTree("HEAD"), ["ls-tree", "-r", "-z", "HEAD"]);
	});

	it("lsTree appends the pathspec behind a literal --", () => {
		assertGitCommand(GitCommand.lsTree("HEAD", [".changeset", "docs"]), [
			"ls-tree",
			"-r",
			"-z",
			"HEAD",
			"--",
			".changeset",
			"docs",
		]);
	});

	it("defaultBranch probes the remote's symbolic HEAD quietly", () => {
		assertGitCommand(GitCommand.defaultBranch(), ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
		assertGitCommand(GitCommand.defaultBranch("upstream"), [
			"symbolic-ref",
			"--quiet",
			"--short",
			"refs/remotes/upstream/HEAD",
		]);
	});

	it("currentBranch builds `git rev-parse --abbrev-ref HEAD`", () => {
		assertGitCommand(GitCommand.currentBranch(), ["rev-parse", "--abbrev-ref", "HEAD"]);
	});

	it("repoRoot builds `git rev-parse --show-toplevel`", () => {
		assertGitCommand(GitCommand.repoRoot(), ["rev-parse", "--show-toplevel"]);
	});

	it("commitInfo builds a NUL-separated single-commit log format", () => {
		assertGitCommand(GitCommand.commitInfo(), ["log", "-1", "--format=%H%x00%G?%x00%B", "HEAD"]);
		assertGitCommand(GitCommand.commitInfo("v1.0.0"), ["log", "-1", "--format=%H%x00%G?%x00%B", "v1.0.0"]);
	});

	it("configGet builds `git config --get <key>`", () => {
		assertGitCommand(GitCommand.configGet("user.signingkey"), ["config", "--get", "user.signingkey"]);
	});

	it("remoteUrl builds `git remote get-url <remote>`", () => {
		assertGitCommand(GitCommand.remoteUrl(), ["remote", "get-url", "origin"]);
	});

	it("status builds `git status --porcelain -z`", () => {
		assertGitCommand(GitCommand.status(), ["status", "--porcelain", "-z"]);
	});
});
