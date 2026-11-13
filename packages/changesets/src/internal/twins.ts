import { AmbiguousPackageError } from "../errors.js";

/**
 * The refusal every name-keyed reader of a plan shares: a pnpm plan, keyed by
 * directory, may hold two releases with one name (same-named projects, each
 * named by its `./` key), and a reader keyed by name would silently let one
 * overwrite the other. The first such name, with every directory releasing it.
 *
 * @internal
 */
export const twinReleases = (
	releases: ReadonlyArray<{ readonly name: string; readonly dir?: string }>,
): AmbiguousPackageError | undefined => {
	const dirs = new Map<string, Array<string>>();
	for (const release of releases) dirs.set(release.name, [...(dirs.get(release.name) ?? []), release.dir ?? ""]);
	for (const [name, list] of dirs) {
		if (list.length > 1) return new AmbiguousPackageError({ packageName: name, directories: list });
	}
	return undefined;
};
