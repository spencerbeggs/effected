import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { descendSync } from "@effected/walker";
import { nodeWalkerSyncOps } from "@effected/walker/node-sync";
import { Result } from "effect";
import { findRelativeSpecifiers } from "../dts/relative-imports.js";
import type { AmbientDtsEntry } from "../entries/ambient-dts.js";
import { ConfigValidationError } from "../errors.js";

/** Every file at any depth, dotfiles included. */
const EVERY_FILE = Result.getOrThrow(GlobPattern.compileResult("**", GlobPatternOptions.make({ dot: true })));

/**
 * Every file path under `dir`, relative to it (POSIX separators, sorted). Nothing is pruned, so a
 * `public/.well-known/` or `public/node_modules/` asset still copies; symlinked directories are not entered.
 */
function listFilesRel(dir: string): ReadonlyArray<string> {
	return Result.getOrThrow(descendSync(EVERY_FILE, { cwd: resolve(dir), prune: [], ...nodeWalkerSyncOps }));
}

/** True when both files exist with identical size and bytes. Size is checked first so the byte read is skipped for the common changed case. */
function sameBytes(a: string, b: string): boolean {
	if (statSync(a).size !== statSync(b).size) return false;
	return readFileSync(a).equals(readFileSync(b));
}

/** Throw the standard public-asset collision error for a destination-relative path. */
function throwPublicCollision(rel: string): never {
	throw new ConfigValidationError({
		path: `public/${rel}`,
		reason: `public asset "${rel}" collides with a built output at the package root — rename or remove it`,
	});
}

/**
 * Copy the CONTENTS of `sourceDir` into `outDir`, additively.
 *
 * Each `sourceDir/<rel>` copies to `outDir/<rel>` — only the `public/` directory itself is dropped;
 * the substructure under it is preserved (`public/tsconfig/ecma.json` becomes `<pkg>/tsconfig/ecma.json`,
 * NOT `<pkg>/ecma.json`). The published manifest mirrors this drop via `transformExports`, which strips
 * a leading `public/` from export values. This function NEVER deletes: `outDir` is the shared package
 * root that the JS/dts passes own, so deleting "files not in source" would wipe the build product.
 * Stale-asset pruning on a non-clean rebuild is therefore out of scope (a full build's `clean: true` handles it).
 *
 * Collision guard: when a destination already exists, identical bytes mean a prior copy of the same
 * asset (skipped); anything else — differing bytes, a directory where a file is needed, or a file
 * where a parent directory is needed — means a built output occupies that path, so it throws
 * {@link ConfigValidationError} rather than clobbering it or surfacing a raw fs error.
 * @public
 */
export function copyPublicDir(sourceDir: string, outDir: string): void {
	if (!existsSync(sourceDir)) return;
	for (const rel of listFilesRel(sourceDir)) {
		const src = join(sourceDir, rel);
		const dst = join(outDir, rel);
		if (existsSync(dst)) {
			// A built output occupies this path. Only an identical FILE is a prior copy to skip; a
			// directory at dst is a collision — and statSync(dst) on a directory would make sameBytes
			// throw EISDIR, so gate on isFile() before the byte compare.
			if (statSync(dst).isFile() && sameBytes(src, dst)) continue;
			throwPublicCollision(rel);
		}
		// A parent segment of dst may itself be an existing built FILE (e.g. public/foo/bar against a
		// built `foo` file), which makes mkdir/copy throw a raw ENOTDIR/EEXIST. Normalize into the guard.
		try {
			mkdirSync(dirname(dst), { recursive: true });
			copyFileSync(src, dst);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOTDIR" || code === "EEXIST" || code === "EISDIR") throwPublicCollision(rel);
			throw err;
		}
	}
}

/** @public */
export interface CopyAmbientDtsOptions {
	/** The ambient exports to copy (from `extractAmbientDts`). */
	readonly ambient: ReadonlyArray<AmbientDtsEntry>;
	/** Package root the `source` paths are relative to. */
	readonly srcCwd: string;
	/** The built package dir to copy into (e.g. `dist/prod/npm/pkg`). */
	readonly outDir: string;
}

/**
 * Copy each ambient `.d.ts` export's source verbatim into `outDir/<outName>`, byte-stable (an
 * unchanged file keeps its timestamp). The copy is NOT compiled or bundled, so the build owns two
 * fast-fail checks: the source must exist, and it must be self-contained — a relative
 * import/export/reference would not resolve once the file is flattened to the package root.
 *
 * Throws {@link ConfigValidationError} on a missing source or any relative specifier.
 * @public
 */
export function copyAmbientDts(options: CopyAmbientDtsOptions): void {
	for (const a of options.ambient) {
		const src = join(options.srcCwd, a.source);
		if (!existsSync(src)) {
			throw new ConfigValidationError({
				path: `exports."${a.exportKey}"`,
				reason: `ambient .d.ts source not found: ${a.source}`,
			});
		}
		const relativeSpecifiers = findRelativeSpecifiers(readFileSync(src, "utf-8"), a.source);
		if (relativeSpecifiers.length > 0) {
			throw new ConfigValidationError({
				path: `exports."${a.exportKey}"`,
				reason: `ambient .d.ts "${a.source}" has relative import(s) [${relativeSpecifiers.join(", ")}] that cannot resolve after a verbatim copy — use bare package specifiers or self-contained declare module/global blocks`,
			});
		}
		const dst = join(options.outDir, a.outName);
		if (!existsSync(dst) || !sameBytes(src, dst)) {
			mkdirSync(dirname(dst), { recursive: true });
			copyFileSync(src, dst);
		}
	}
}
