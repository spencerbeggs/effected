import { GlobPattern } from "@effected/glob";
import { Result } from "effect";

/** A bare package name, `name` or `@scope/name`, with no subpath and no glob syntax. */
const PACKAGE_NAME = /^(?:@[^/*?{}[\]!]+\/)?[^/@*?{}[\]!][^/*?{}[\]!]*$/;

/** Any character that makes an entry a glob rather than a literal specifier. */
const GLOB_SYNTAX = /[*?{}[\]!]/;

/**
 * The patterns tsdown's `deps.alwaysBundle` is given for a `bundle` list.
 *
 * @remarks
 * tsdown matches an import specifier against each entry exactly or as a glob, so `effect` alone would inline
 * `import "effect"` and leave `import "effect/Schema"` external. A bare package name here means the package: it is
 * widened to the name and every subpath under it. A glob is widened the same way, since its `*` stops at `/` and
 * `@effected/*` would otherwise leave `import "@effected/cli/main"` external while {@link bundlesPackage} prunes
 * `@effected/cli`; one already ending `/**`, or a negation, is passed as written. A subpath entry is passed as written.
 *
 * @internal
 */
export const bundlePatterns = (entries: ReadonlyArray<string>): ReadonlyArray<string> =>
	entries.flatMap((entry) =>
		PACKAGE_NAME.test(entry) || (GLOB_SYNTAX.test(entry) && !entry.startsWith("!") && !entry.endsWith("/**"))
			? [entry, `${entry}/**`]
			: [entry],
	);

/**
 * Whether a `bundle` list inlines the package `name` as a whole: an entry naming it, or a glob matching it.
 *
 * @internal
 */
export const bundlesPackage = (name: string, entries: ReadonlyArray<string>): boolean =>
	entries.some((entry) => {
		if (entry === name) return true;
		if (PACKAGE_NAME.test(entry)) return false;
		const compiled = GlobPattern.compileResult(entry);
		return Result.isSuccess(compiled) && compiled.success.matches(name);
	});

/**
 * Whether every partition of a build inlines the package `name`: the base `bundle` list and each override's.
 *
 * @remarks
 * An override with no `bundle` of its own bundles nothing by force, so a package it imports stays a dependency.
 * Only a package inlined everywhere can leave the emitted manifest.
 *
 * @internal
 */
export const bundledEverywhere =
	(
		base: ReadonlyArray<string> | undefined,
		overrides: ReadonlyArray<{ readonly bundle?: ReadonlyArray<string> | undefined }>,
	) =>
	(name: string): boolean =>
		bundlesPackage(name, base ?? []) &&
		overrides.every((override) => override.bundle !== undefined && bundlesPackage(name, override.bundle));

/**
 * Removes from `dependencies` and `optionalDependencies` every package the build inlined, so an install never fetches
 * what the published files already hold. `peerDependencies` are kept: a peer of an inlined package is the author's
 * statement that the host provides it, such as the types a declaration file still imports.
 *
 * @internal
 */
export const pruneBundled = (
	pkg: Readonly<Record<string, unknown>>,
	isBundled: (name: string) => boolean,
): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...pkg };
	for (const field of ["dependencies", "optionalDependencies"] as const) {
		const deps = out[field];
		if (typeof deps !== "object" || deps === null) continue;
		const kept = Object.fromEntries(Object.entries(deps).filter(([name]) => !isBundled(name)));
		if (Object.keys(kept).length === 0) delete out[field];
		else out[field] = kept;
	}
	return out;
};
