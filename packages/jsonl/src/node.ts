/**
 * The Node backend for `@effected/jsonl`: {@link NodeJournalWatcher}, which
 * provides the root's `JournalWatcher` over `node:fs`, and {@link JournalFile},
 * synchronous cursor-resumed reads of a journal file for a consumer with no
 * Effect runtime.
 *
 * The root never imports `node:*`; this entry is the one place the package
 * touches a platform, and only a consumer that imports it pays for that.
 *
 * @packageDocumentation
 */

export type { JournalFileError, JournalRead, JournalReset } from "./JournalFile.js";
export { JournalCursor, JournalFile } from "./JournalFile.js";
export { NodeJournalWatcher } from "./NodeJournalWatcher.js";
