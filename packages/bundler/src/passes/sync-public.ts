import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { DescendError } from "@effected/walker";
import { descend } from "@effected/walker";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";
import { findRelativeSpecifiers } from "../dts/relative-imports.js";
import type { AmbientDtsEntry } from "../entries/ambient-dts.js";
import { ConfigValidationError } from "../errors.js";
import { existsLikeNode } from "../internal/exists.js";

/** Every file at any depth, dotfiles included. */
const EVERY_FILE = Result.getOrThrow(GlobPattern.compileResult("**", GlobPatternOptions.make({ dot: true })));

/**
 * The failures of {@link copyPublicDir}: a collision, a walk failure, or an IO failure the guard does not own.
 *
 * @public
 */
export type CopyPublicDirError = ConfigValidationError | DescendError | PlatformError.PlatformError;

/** True when both files exist with identical size and bytes. Size is checked first so the byte read is skipped for the common changed case. */
const sameBytes = Effect.fnUntraced(function* (
	a: string,
	b: string,
): Effect.fn.Return<boolean, PlatformError.PlatformError, FileSystem.FileSystem> {
	const fs = yield* FileSystem.FileSystem;
	if ((yield* fs.stat(a)).size !== (yield* fs.stat(b)).size) return false;
	const left = yield* fs.readFile(a);
	const right = yield* fs.readFile(b);
	return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right);
});

/** The standard public-asset collision error for a destination-relative path. */
const publicCollision = (rel: string): ConfigValidationError =>
	new ConfigValidationError({
		path: `public/${rel}`,
		reason: `public asset "${rel}" collides with a built output at the package root — rename or remove it`,
	});

/**
 * `EEXIST`, `ENOTDIR` and `EISDIR`: a path segment the copy needs is occupied by the wrong kind of entry. A Node
 * backend reports `ENOTDIR` and `EISDIR` as `BadResource`, which also covers `ELOOP`; a symlink loop is no collision,
 * and fails as the IO error it is, as the old errno check let it.
 */
const isOccupied = (error: PlatformError.PlatformError): boolean => {
	if (error.reason._tag === "AlreadyExists") return true;
	if (error.reason._tag !== "BadResource") return false;
	const code = (error.reason.cause as { readonly code?: unknown } | undefined)?.code;
	return code !== "ELOOP";
};

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
export const copyPublicDir: (
	sourceDir: string,
	outDir: string,
) => Effect.Effect<void, CopyPublicDirError, FileSystem.FileSystem | Path.Path> = Effect.fnUntraced(function* (
	sourceDir: string,
	outDir: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (!(yield* existsLikeNode(sourceDir))) return;
	// Nothing is pruned, so a `public/.well-known/` or `public/node_modules/` asset still copies; symlinked
	// directories are not entered.
	const files = yield* descend(EVERY_FILE, { cwd: path.resolve(sourceDir), prune: [] });
	for (const rel of files) {
		const src = path.join(sourceDir, rel);
		const dst = path.join(outDir, rel);
		if (yield* existsLikeNode(dst)) {
			// A built output occupies this path. Only an identical FILE is a prior copy to skip; a
			// directory at dst is a collision, so gate on the type before the byte compare.
			if ((yield* fs.stat(dst)).type === "File" && (yield* sameBytes(src, dst))) continue;
			return yield* publicCollision(rel);
		}
		// A parent segment of dst may itself be an existing built FILE (e.g. public/foo/bar against a
		// built `foo` file), which makes mkdir/copy fail with a raw ENOTDIR/EEXIST. Normalize into the guard.
		yield* fs.makeDirectory(path.dirname(dst), { recursive: true }).pipe(
			Effect.andThen(fs.copyFile(src, dst)),
			Effect.catchIf(isOccupied, () => Effect.fail(publicCollision(rel))),
		);
	}
});

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
export const copyAmbientDts: (
	options: CopyAmbientDtsOptions,
) => Effect.Effect<void, ConfigValidationError | PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =
	Effect.fnUntraced(function* (options: CopyAmbientDtsOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		for (const a of options.ambient) {
			const src = path.join(options.srcCwd, a.source);
			if (!(yield* existsLikeNode(src))) {
				return yield* new ConfigValidationError({
					path: `exports."${a.exportKey}"`,
					reason: `ambient .d.ts source not found: ${a.source}`,
				});
			}
			const relativeSpecifiers = findRelativeSpecifiers(yield* fs.readFileString(src), a.source);
			if (relativeSpecifiers.length > 0) {
				return yield* new ConfigValidationError({
					path: `exports."${a.exportKey}"`,
					reason: `ambient .d.ts "${a.source}" has relative import(s) [${relativeSpecifiers.join(", ")}] that cannot resolve after a verbatim copy — use bare package specifiers or self-contained declare module/global blocks`,
				});
			}
			const dst = path.join(options.outDir, a.outName);
			if (!(yield* existsLikeNode(dst)) || !(yield* sameBytes(src, dst))) {
				yield* fs.makeDirectory(path.dirname(dst), { recursive: true });
				yield* fs.copyFile(src, dst);
			}
		}
	});
