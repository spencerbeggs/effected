/**
 * Path traversal as Effect primitives.
 *
 * Upward: ascend a directory chain toward the filesystem root and return the
 * first candidate satisfying a predicate. Each probe absorbs its own failure,
 * so one unreadable ancestor never hides a valid match above it.
 *
 * Downward: descend from a compiled `@effected/glob` pattern's literal prefix
 * and return the matching file paths. Unlike the upward walk, an unreadable
 * subtree fails typed by default — a swallowed subtree is silently missing
 * membership, not a candidate that did not match.
 *
 * Confinement: `confineRelativeResult` (and its `Effect` twin
 * `confineRelative`) keeps an untrusted relative path, such as an archive
 * entry name, under a base directory, refusing absolute forms and `..`
 * escapes before any filesystem access.
 *
 * @packageDocumentation
 */

export {
	PathEscapeError,
	PathEscapeReason,
	confineRelative,
	confineRelativeResult,
} from "./Confine.js";
export {
	type DescendEntriesResult,
	type DescendEntry,
	DescendError,
	type DescendOptions,
	type DescendRecordOptions,
	type DescendResult,
	type UnreadableDirectory,
	descend,
	descendEntries,
} from "./Descend.js";
export {
	type DescendSyncOptions,
	type DescendSyncRecordOptions,
	type WalkerSyncFileSystem,
	type WalkerSyncOps,
	type WalkerSyncPath,
	type WalkerSyncStats,
	descendEntriesSync,
	descendSync,
} from "./DescendSync.js";
export { type CompileAndExpandOptions, GlobExpansionError, compileAndExpand } from "./Expand.js";
export { type AscendOptions, Walker } from "./Walker.js";
