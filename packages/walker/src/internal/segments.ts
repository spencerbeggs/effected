/**
 * Resolve `.` and `..` lexically over path segments, never above the start.
 *
 * Empty and `.` segments are dropped, a `..` pops its parent, and a `..` with
 * nothing left to pop is a climb above the start: the answer is then
 * `undefined`. `og/../x` resolves to `["x"]`; `og/../../x` climbs. The caller
 * splits, because the separator set is the caller's: a glob pattern's
 * backslash is an escape, never a separator.
 */
export const resolveSegments = (segments: ReadonlyArray<string>): Array<string> | undefined => {
	const kept: Array<string> = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (kept.length === 0) return undefined;
			kept.pop();
			continue;
		}
		kept.push(segment);
	}
	return kept;
};
