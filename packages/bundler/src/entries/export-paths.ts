/**
 * Maps each build entry to its `package.json` export key: the key whose target is the entry's source, else `.`
 * for `index` and `./<name>` for the rest.
 *
 * @public
 */
export function deriveExportPaths(
	entries: Record<string, string>,
	exportsMap: Record<string, string> | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	const sourceToKey = new Map<string, string>();
	if (exportsMap) for (const [key, src] of Object.entries(exportsMap)) sourceToKey.set(src, key);
	for (const [entryName, src] of Object.entries(entries)) {
		out[entryName] = sourceToKey.get(src) ?? (entryName === "index" ? "." : `./${entryName}`);
	}
	return out;
}
