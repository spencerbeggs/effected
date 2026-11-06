/** Dependency map fields whose workspace-sibling versions get the optimistic bump. */
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Rewrite a meta `package.json` so the package's own `version` and any workspace-sibling
 * dependency version reflect their NEXT release version from `versions`. Pure: returns a new
 * object, never mutates the input. External/catalog-resolved deps (names absent from `versions`)
 * are left as-is.
 * @public
 */
export function rewriteMetaVersions(
	pkg: Record<string, unknown>,
	versions: ReadonlyMap<string, string>,
	selfName: string,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...pkg };
	const selfNext = versions.get(selfName);
	if (selfNext !== undefined) out.version = selfNext;
	for (const field of DEP_FIELDS) {
		const deps = pkg[field];
		if (deps === null || typeof deps !== "object") continue;
		const next: Record<string, string> = { ...(deps as Record<string, string>) };
		for (const depName of Object.keys(next)) {
			const v = versions.get(depName);
			if (v !== undefined) next[depName] = v;
		}
		out[field] = next;
	}
	return out;
}
