import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { ShellSegment } from "../src/index.js";
import { ShellCommand, ShellSyntax } from "../src/index.js";

const resolve = (
	input: string,
): { name: string | null; args: ReadonlyArray<string>; wrappers: ReadonlyArray<string> } => {
	const segment = ShellSyntax.parse(input).segments[0] as ShellSegment;
	const command = ShellCommand.fromSegment(segment);
	return { name: Option.getOrNull(command.name), args: command.args.map((a) => a.raw), wrappers: command.wrappers };
};

describe("ShellCommand.fromSegment", () => {
	it("reads a plain command", () => {
		assert.deepStrictEqual(resolve("git commit -m x"), { name: "git", args: ["commit", "-m", "x"], wrappers: [] });
	});

	it("reads a quoted command name through its literal", () => {
		assert.deepStrictEqual(resolve("'git' \"commit\""), { name: "git", args: ['"commit"'], wrappers: [] });
	});

	it("stops with no name at a word that is not literal, keeping it in args", () => {
		assert.deepStrictEqual(resolve("$GIT commit"), { name: null, args: ["$GIT", "commit"], wrappers: [] });
		assert.deepStrictEqual(resolve("g{it,} commit"), { name: null, args: ["g{it,}", "commit"], wrappers: [] });
		assert.deepStrictEqual(resolve("sudo $CMD x"), { name: null, args: ["$CMD", "x"], wrappers: ["sudo"] });
	});

	it("resolves an assignment-only or redirection-only segment to no name", () => {
		assert.deepStrictEqual(resolve("FOO=1"), { name: null, args: [], wrappers: [] });
		assert.deepStrictEqual(resolve("> out"), { name: null, args: [], wrappers: [] });
	});

	it("unwraps sudo with its option arguments and assignments", () => {
		assert.deepStrictEqual(resolve("sudo -u root -g wheel -E -- git push"), {
			name: "git",
			args: ["push"],
			wrappers: ["sudo"],
		});
		assert.deepStrictEqual(resolve("sudo -Eu root VAR=1 git push"), {
			name: "git",
			args: ["push"],
			wrappers: ["sudo"],
		});
		assert.deepStrictEqual(resolve("sudo -uroot git push"), { name: "git", args: ["push"], wrappers: ["sudo"] });
		assert.deepStrictEqual(resolve("sudo --user root --chdir=/tmp git push"), {
			name: "git",
			args: ["push"],
			wrappers: ["sudo"],
		});
		assert.deepStrictEqual(resolve("sudo -u $USER git push"), { name: "git", args: ["push"], wrappers: ["sudo"] });
	});

	it("unwraps env with -i, -, -u, -C and assignments, including expanding ones", () => {
		assert.deepStrictEqual(resolve("env -i - -u HOME -C /tmp A=1 B=$X git status"), {
			name: "git",
			args: ["status"],
			wrappers: ["env"],
		});
		assert.deepStrictEqual(resolve("env --unset HOME --unset=PATH git status"), {
			name: "git",
			args: ["status"],
			wrappers: ["env"],
		});
		assert.deepStrictEqual(resolve("env a-b=c git status"), { name: "git", args: ["status"], wrappers: ["env"] });
	});

	it("stops with no name at env -S, which splits a string into a command line", () => {
		assert.deepStrictEqual(resolve("env -S 'git push' x"), {
			name: null,
			args: ["-S", "'git push'", "x"],
			wrappers: ["env"],
		});
		assert.deepStrictEqual(resolve("env --split-string='git push'"), {
			name: null,
			args: ["--split-string='git push'"],
			wrappers: ["env"],
		});
	});

	it("unwraps command -p but not command -v or -V", () => {
		assert.deepStrictEqual(resolve("command -p git push"), { name: "git", args: ["push"], wrappers: ["command"] });
		assert.deepStrictEqual(resolve("command -v git"), { name: "command", args: ["-v", "git"], wrappers: [] });
		assert.deepStrictEqual(resolve("command -pV git"), { name: "command", args: ["-pV", "git"], wrappers: [] });
	});

	it("unwraps exec, nohup and time", () => {
		assert.deepStrictEqual(resolve("exec -cl -a name git push"), { name: "git", args: ["push"], wrappers: ["exec"] });
		assert.deepStrictEqual(resolve("nohup -- git push"), { name: "git", args: ["push"], wrappers: ["nohup"] });
		assert.deepStrictEqual(resolve("time -p -f %e -o out git push"), {
			name: "git",
			args: ["push"],
			wrappers: ["time"],
		});
	});

	it("chains wrappers, outermost first", () => {
		assert.deepStrictEqual(resolve("sudo env FOO=1 command nohup time git push"), {
			name: "git",
			args: ["push"],
			wrappers: ["sudo", "env", "command", "nohup", "time"],
		});
	});

	it("reports a wrapper with nothing after it as no name", () => {
		assert.deepStrictEqual(resolve("sudo -u"), { name: null, args: [], wrappers: ["sudo"] });
		assert.deepStrictEqual(resolve("env"), { name: null, args: [], wrappers: ["env"] });
	});

	it("does not unwrap commands outside the list", () => {
		assert.deepStrictEqual(resolve("nice -n 5 git push"), {
			name: "nice",
			args: ["-n", "5", "git", "push"],
			wrappers: [],
		});
		assert.deepStrictEqual(resolve("xargs git commit"), { name: "xargs", args: ["git", "commit"], wrappers: [] });
	});

	it("skips leading reserved words written bare, and only before any wrapper", () => {
		assert.deepStrictEqual(resolve("! git diff --quiet"), { name: "git", args: ["diff", "--quiet"], wrappers: [] });
		assert.deepStrictEqual(resolve("then do git push"), { name: "git", args: ["push"], wrappers: [] });
		assert.deepStrictEqual(resolve("'if' x"), { name: "if", args: ["x"], wrappers: [] });
		assert.deepStrictEqual(resolve("\\if x"), { name: "if", args: ["x"], wrappers: [] });
		assert.deepStrictEqual(resolve("sudo if x"), { name: "if", args: ["x"], wrappers: ["sudo"] });
		assert.deepStrictEqual(resolve("for x in a b"), { name: "for", args: ["x", "in", "a", "b"], wrappers: [] });
	});

	it("keeps the segment it resolved", () => {
		const segment = ShellSyntax.parse("sudo git push").segments[0] as ShellSegment;
		assert.strictEqual(ShellCommand.fromSegment(segment).segment, segment);
	});

	it("publishes its wrapper and reserved-word lists", () => {
		assert.deepStrictEqual(ShellCommand.wrapperNames, ["sudo", "env", "command", "exec", "nohup", "time"]);
		assert.include(ShellCommand.reservedWords, "then");
		assert.notInclude(ShellCommand.reservedWords, "for");
	});

	it("does not resolve an inherited Object.prototype member as a wrapper", () => {
		assert.deepStrictEqual(resolve("constructor x"), { name: "constructor", args: ["x"], wrappers: [] });
		assert.deepStrictEqual(resolve("__proto__ x"), { name: "__proto__", args: ["x"], wrappers: [] });
	});
});

describe("ShellScript.commands", () => {
	it("resolves one command per segment, in order", () => {
		const commands = ShellSyntax.parse("cd x && sudo git commit; FOO=1 env -i make").commands();
		assert.deepStrictEqual(
			commands.map((c) => [Option.getOrNull(c.name), c.wrappers]),
			[
				["cd", []],
				["git", ["sudo"]],
				["make", ["env"]],
			],
		);
	});
});
