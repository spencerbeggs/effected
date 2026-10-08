/**
 * The Node backend for `@effected/jsonl`: {@link NodeJournalWatcher}, which
 * provides the root's `JournalWatcher` over `node:fs`.
 *
 * The root never imports `node:*`; this entry is the one place the package
 * touches a platform, and only a consumer that imports it pays for that.
 *
 * @packageDocumentation
 */

export { NodeJournalWatcher } from "./NodeJournalWatcher.js";
