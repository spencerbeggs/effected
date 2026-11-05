/**
 * Atomic file and directory writes over core `FileSystem` and `Path`, both required
 * in `R`.
 *
 * {@link AtomicFile.write} replaces a file through a synced temp file and a
 * rename, so a crash leaves the old content or the new content and never a
 * truncated file. A link `realPath` cannot follow is the one exception: it is
 * written through directly. {@link AtomicDirectory.write} replaces a whole
 * on-disk directory by staging it in a sibling and renaming it into place.
 *
 * @packageDocumentation
 */

export { AtomicDirectory, AtomicDirectoryError, type AtomicDirectoryFiles } from "./AtomicDirectory.js";
export { AtomicFile } from "./AtomicFile.js";
