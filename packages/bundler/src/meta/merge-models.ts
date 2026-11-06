/** Rewrite every nested member canonicalReference that starts with originalPrefix to use newPrefix. Skips the EntryPoint node itself. */
function rewriteCanonicalReferences(node: unknown, originalPrefix: string, newPrefix: string): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) rewriteCanonicalReferences(item, originalPrefix, newPrefix);
		return;
	}
	const obj = node as Record<string, unknown>;
	if (typeof obj.canonicalReference === "string" && obj.kind !== "EntryPoint") {
		const ref = obj.canonicalReference;
		if (ref.startsWith(originalPrefix)) {
			obj.canonicalReference = ref.replace(originalPrefix, newPrefix);
		}
	}
	if (Array.isArray(obj.members)) {
		for (const member of obj.members) rewriteCanonicalReferences(member, originalPrefix, newPrefix);
	}
}

/** Merge per-entry API models into one Package model. Each input is a Package with one EntryPoint; the output keeps the main entry (".") canonical and rewrites sub-entries to `${packageName}/${subpath}!`. */
export function mergeApiModels(options: {
	perEntryModels: Map<string, Record<string, unknown>>;
	packageName: string;
	exportPaths: Record<string, string>;
}): Record<string, unknown> {
	const { perEntryModels, packageName, exportPaths } = options;
	if (perEntryModels.size === 0) throw new Error("Cannot merge zero API models");

	const firstModel = perEntryModels.values().next().value as Record<string, unknown>;
	const merged = JSON.parse(JSON.stringify(firstModel)) as Record<string, unknown>;

	const entryPointMembers: unknown[] = [];
	for (const [entryName, model] of perEntryModels) {
		const entryPoints = model.members as unknown[];
		if (!entryPoints || entryPoints.length === 0) continue;
		const entryPoint = JSON.parse(JSON.stringify(entryPoints[0])) as Record<string, unknown>;

		const exportPath = exportPaths[entryName] ?? (entryName === "index" ? "." : `./${entryName}`);
		const isMainEntry = exportPath === ".";
		if (isMainEntry) {
			entryPointMembers.unshift(entryPoint);
		} else {
			const subpath = exportPath.replace(/^\.\//, "");
			const originalPrefix = `${packageName}!`;
			const newPrefix = `${packageName}/${subpath}!`;
			entryPoint.canonicalReference = newPrefix;
			entryPoint.name = subpath;
			rewriteCanonicalReferences(entryPoint, originalPrefix, newPrefix);
			entryPointMembers.push(entryPoint);
		}
	}
	merged.members = entryPointMembers;
	return merged;
}
