// packages/bundler/src/passes/strip-maps.ts
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { descendSync } from "@effected/walker";
import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
import { Result } from "effect";

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
export function removeDeclarationMaps(pkgDir: string): string[] {
	// An absent dir walks to no matches, and an unreadable one is skipped, as the old walk's readdir catch did.
	// Symlinked directories are not entered (the old Dirent walk never did).
	const maps = Result.getOrThrow(
		descendSync(STRIPPABLE_MAPS, {
			cwd: resolve(pkgDir),
			prune: ["node_modules"],
			onUnreadable: "skip",
			...nodeWalkerSyncOps,
		}),
	);
	return maps.map((rel) => {
		const full = join(pkgDir, rel);
		rmSync(full, { force: true });
		return full;
	});
}
