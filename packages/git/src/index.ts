/**
 * Typed git introspection over Effect's ChildProcessSpawner.
 *
 * Read a repository's state at any ref without checking it out, plus checkout.
 *
 * @packageDocumentation
 */

export { Git, GitCommandError, LsTreeEntry, NotARepositoryError, UnknownRefError } from "./Git.js";
export { GitCommand } from "./GitCommand.js";
