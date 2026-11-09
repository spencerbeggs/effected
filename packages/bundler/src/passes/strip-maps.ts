// packages/bundler/src/passes/strip-maps.ts
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { DescendError } from "@effected/walker";
import { descend } from "@effected/walker";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";

/** `.d.ts.map` / `.d.cts.map` at any depth, dot-directories included. */
const STRIPPABLE_MAPS = Result.getOrThrow(
	GlobPattern.compileResult("**/*.d.{ts,cts}.map", GlobPatternOptions.make({ dot: true })),
);

/**
 * Remove declaration source-map files (`.d.ts.map` / `.d.cts.map`) from a built `pkg`
 * directory, returning the removed paths.
 *
 * The dts pass emits these next to each `.d.ts` (the resolved dts tsconfig sets
 * `declarationMap: true`) because API Extractor reads them during meta generation to
 * resolve original-source positions. But they are dead weight in a PUBLISHED package —
 * they reference `.ts` sources the tarball does not ship — and they leak local source
 * paths, so the prod build strips them AFTER meta generation has consumed them. The dev
 * build keeps them (it is never published, and `savvy build --target meta` reads them).
 *
 * Recurses, but skips `node_modules` so it does not traverse a self-contained bundle's
 * vendored tree — only the package's own emitted declarations carry maps worth stripping.
 * @public
 */
export const removeDeclarationMaps: (
	pkgDir: string,
) => Effect.Effect<
	ReadonlyArray<string>,
	DescendError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path
> = Effect.fnUntraced(function* (pkgDir) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	// An absent dir walks to no matches, and an unreadable one is skipped, as the old walk's readdir catch did.
	// Symlinked directories are not entered (the old Dirent walk never did).
	const root = path.resolve(pkgDir);
	const maps = yield* descend(STRIPPABLE_MAPS, { cwd: root, prune: ["node_modules"], onUnreadable: "skip" });
	const removed: Array<string> = [];
	for (const rel of maps) {
		// Removed through the resolved path, answered in the caller's spelling of the directory.
		yield* fs.remove(path.join(root, rel), { force: true });
		removed.push(path.join(pkgDir, rel));
	}
	return removed;
});
