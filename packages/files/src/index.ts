/**
 * Atomic single-file writes over core `FileSystem` and `Path`, both required
 * in `R`.
 *
 * {@link AtomicFile.write} replaces a file through a synced temp file and a
 * rename, so a crash leaves the old content or the new content and never a
 * truncated file.
 *
 * @packageDocumentation
 */

export { AtomicFile } from "./AtomicFile.js";
