// A pure parser for a gitfile: the `.git` FILE a linked worktree or a
// submodule has in place of a `.git` directory, holding one line,
// `gitdir: <path>`.
//
// The rules are git's own (setup.c read_gitfile_gently), probed against git
// 2.56 with `git rev-parse --git-dir` over hand-written gitfiles:
//
//   - The text must begin with exactly `gitdir: ` — lowercase, one space. A
//     missing space, a tab, an uppercase `GITDIR`, a leading blank line or a
//     byte-order mark are all "invalid gitfile format".
//   - Every trailing `\n` and `\r` is removed, and nothing else: leading and
//     trailing spaces belong to the path (`gitdir:  x` points at ` x`), and
//     so does an embedded newline.
//   - Nothing left after the prefix is "no path in gitfile".
//   - git reads the path as a C string, so a NUL ends it.

import { Effect, Result, Schema } from "effect";

const PREFIX = "gitdir: ";

/**
 * A text that git would refuse as a gitfile.
 *
 * @remarks
 * `code` mirrors git's own diagnosis: `"InvalidFormat"` when the text does not
 * begin with exactly `gitdir: ` (git: "invalid gitfile format"), `"NoPath"`
 * when nothing follows it (git: "no path in gitfile").
 *
 * @public
 */
export class GitFileParseError extends Schema.TaggedError<GitFileParseError>()("GitFileParseError", {
	/** Which of git's two refusals applies. */
	code: Schema.Literals(["InvalidFormat", "NoPath"]),
}) {
	override get message(): string {
		return this.code === "InvalidFormat"
			? "Not a gitfile: the text does not begin with `gitdir: `"
			: "Not a gitfile: no path follows `gitdir: `";
	}
}

/**
 * A parsed gitfile: the `.git` file of a linked worktree or a submodule,
 * pointing at the repository directory git uses for it.
 *
 * @remarks
 * Pure: it reads text, never the filesystem, and spawns nothing, so it fits a
 * code path that must not run git. `gitdir` is the pointer exactly as written,
 * relative or absolute. git resolves a relative one against the directory
 * holding the `.git` file; resolving it, and any confinement check on where
 * it points, is the caller's.
 *
 * @example
 * ```ts
 * import { GitFile } from "@effected/git";
 * import { Result } from "effect";
 *
 * const parsed = GitFile.parseResult("gitdir: ../.git/worktrees/feature\n");
 * if (Result.isSuccess(parsed)) console.log(parsed.success.gitdir);
 * // => ../.git/worktrees/feature
 * ```
 *
 * @public
 */
export class GitFile extends Schema.Class<GitFile>("GitFile")({
	/** The repository directory the gitfile points at, as written. */
	gitdir: Schema.String,
}) {
	/**
	 * Parses a gitfile's text by git's rules.
	 *
	 * @remarks
	 * Only trailing `\n` and `\r` characters are removed; spaces around the
	 * path are part of it, as they are to git. A NUL ends the path, as it does
	 * for git, which reads the file as a C string; if that leaves nothing, the
	 * text fails as `"NoPath"`.
	 */
	static parseResult(text: string): Result.Result<GitFile, GitFileParseError> {
		if (!text.startsWith(PREFIX)) return Result.fail(GitFileParseError.make({ code: "InvalidFormat" }));
		let end = text.length;
		while (end > PREFIX.length && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
		let gitdir = text.slice(PREFIX.length, end);
		const nul = gitdir.indexOf("\0");
		if (nul !== -1) gitdir = gitdir.slice(0, nul);
		if (gitdir === "") return Result.fail(GitFileParseError.make({ code: "NoPath" }));
		return Result.succeed(GitFile.make({ gitdir }));
	}

	/**
	 * {@link GitFile.parseResult} as an `Effect`, under a named span.
	 */
	static readonly parse = Effect.fn("GitFile.parse")((text: string) => Effect.fromResult(GitFile.parseResult(text)));
}
