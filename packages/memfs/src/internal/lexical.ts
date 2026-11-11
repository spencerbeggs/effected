// KIT EXTENSION (errno fidelity, #1284). node's JS `fs.realpath` and
// `fs.realpathSync` — what the platform adapter and the kit's Node bindings
// call — fold the path lexically (`path.resolve`) before resolving a single
// link, so `file/..` is the directory holding `file`, `link/..` the directory
// holding `link`, and a missing parent of a `..` is never visited. The
// kernel's `realpathSync.native` does NOT: it resolves `..` physically
// (`link/..` is the link target's parent, `missing/..` is ENOENT), and is not
// the reference here.
// Every other path-taking operation walks the path as given, where a `.` or
// `..` after a non-directory is ENOTDIR. The engine's `realPath` and the
// ports' `realPath` share this one fold so the two cannot disagree.

/**
 * `path` with `.`, `..` and repeated or trailing separators folded lexically,
 * as `path.posix.resolve` from the virtual root folds them. A path the
 * resolver must reject (empty, or holding a NUL byte) is returned untouched so
 * it still fails there.
 *
 * @internal
 */
export const lexicallyNormalized = (path: string): string => {
	if (path.length === 0 || path.includes("\0")) return path;
	const parts: Array<string> = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};
