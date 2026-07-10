/**
 * Upward path traversal as Effect primitives.
 *
 * Ascend a directory chain toward the filesystem root and return the first
 * candidate satisfying a predicate. Each probe absorbs its own failure, so one
 * unreadable ancestor never hides a valid match above it.
 *
 * @packageDocumentation
 */

export { type AscendOptions, Walker } from "./Walker.js";
