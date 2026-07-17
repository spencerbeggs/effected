/**
 * Typed git introspection over Effect's ChildProcessSpawner.
 *
 * Read a repository's state at any ref without checking it out, plus a
 * clearly-marked mutating tier — checkout, fetch, submodule management,
 * sparse-checkout, config writes and staging — that changes it.
 *
 * @packageDocumentation
 */

export {
	CommitInfo,
	Git,
	GitCommandError,
	type GitShape,
	LsTreeEntry,
	NameStatusEntry,
	NotARepositoryError,
	StatusEntry,
	UnknownRefError,
} from "./Git.js";
export { GitCommand } from "./GitCommand.js";
