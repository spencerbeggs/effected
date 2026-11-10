import type { Result } from "effect";
import { workspaceMatcher } from "./internal/workspacePatterns.js";
import type { NpmWorkspacePatternsError } from "./NpmWorkspacePatternsError.js";

/**
 * npm's reading of a `workspaces` field: which directories it declares as
 * workspaces, decided the way `@npmcli/map-workspaces` 5 decides them.
 *
 * @remarks
 * The one home of npm's pattern rules in the kit, so every reader of an npm
 * `workspaces` field gives the same answer. `@effected/lockfiles` decides
 * which `package-lock.json` link rows are workspaces with it. The rules are
 * npm's, and they are not glob set semantics (`GlobSet`):
 *
 * - the declaration is the array itself, or the array under `packages`; any
 *   other value declares no workspaces, and a non-string entry is skipped;
 * - a run of leading `!` negates when it is odd and is dropped when even
 *   (`!!packages/a` is a positive), and one leading `./` or `/` is stripped;
 * - negations are ORDERED: a later positive that an earlier negation matches
 *   cancels it (`["packages/*", "!packages/a", "packages/a"]` keeps
 *   `packages/a`), and a positive a surviving negation matches is dropped;
 * - a positive matches directories, under glob's defaults (no `dot`), and a
 *   backslash in it is a separator, never an escape (`packages\a` is
 *   `packages/a`); a trailing `/.` run names the directory itself;
 * - a negation is an ignore, matched with `dot`, with or without a trailing
 *   `/` (`!packages/a/` ignores `packages/a`); anything under `node_modules`
 *   is always ignored.
 *
 * Every ceiling bounds the matcher's cost on a hostile field — at most 1,000
 * patterns, 32 wildcard patterns, 256 brace alternatives across them, and 256
 * characters for any pattern that is matched rather than looked up — and a
 * field past one fails as {@link NpmWorkspacePatternsError}, never read some
 * other way.
 *
 * @public
 */
export class NpmWorkspacePatterns {
	private constructor() {}

	/**
	 * Compile a `workspaces` field into a predicate over directories.
	 *
	 * @remarks
	 * Every pattern is compiled once, here; the predicate only matches, and it
	 * remembers each directory it has decided. A directory is a relative POSIX
	 * path, normalized as npm writes a lockfile's `resolved`: no `.` or empty
	 * segment, `..` only as a leading run, no trailing `/`. `""` (the root) is
	 * never a workspace.
	 *
	 * @param field - The `workspaces` value as found, of any shape.
	 * @returns The predicate, or the ceiling the field passed.
	 *
	 * @example
	 * ```ts
	 * import { NpmWorkspacePatterns } from "@effected/npm";
	 * import { Result } from "effect";
	 *
	 * const matcher = NpmWorkspacePatterns.matcherResult(["packages/*", "!packages/legacy"]);
	 * if (Result.isSuccess(matcher)) {
	 * 	matcher.success("packages/app"); // => true
	 * 	matcher.success("packages/legacy"); // => false
	 * }
	 * ```
	 */
	static matcherResult(field: unknown): Result.Result<(directory: string) => boolean, NpmWorkspacePatternsError> {
		return workspaceMatcher(field);
	}
}
