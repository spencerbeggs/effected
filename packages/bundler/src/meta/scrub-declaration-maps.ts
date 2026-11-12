// packages/tsdown-plugins/src/meta/scrub-declaration-maps.ts
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { DescendError } from "@effected/walker";
import { descend } from "@effected/walker";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";

/** Every declaration map, at any depth, dot-directories included. */
const DECLARATION_MAPS = Result.getOrThrow(
	GlobPattern.compileResult("**/*.d.{ts,cts,mts}.map", GlobPatternOptions.make({ dot: true })),
);

/**
 * Drop every source-less segment (a generated position with no original position) from a
 * declaration map, in place. Returns the number of segments removed.
 *
 * @remarks
 * rolldown 1.2.15+ writes such segments for declarations TypeScript synthesizes with no source
 * position — the `declare const X_base` hoisted for a class whose heritage clause is a call
 * expression (Effect's `Schema.Class`/`Data.TaggedError`, any mixin factory). API Extractor's
 * `SourceMapper` resolves a source-less mapping item to the `.d.ts`'s own directory and then
 * `readFile`s it, so the meta pass dies with `EISDIR` (savvy-web/systems#817; upstream
 * microsoft/rushstack#6156 / PR #6157, unreleased). Segments with no source carry no location a
 * consumer can use, so removing them is lossless for every reader.
 *
 * @internal
 */
export const scrubSourcelessMappings: (
	mapPath: string,
) => Effect.Effect<number, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.fnUntraced(function* (
	mapPath: string,
) {
	const fs = yield* FileSystem.FileSystem;
	// A malformed map throws, a defect, as the synchronous `JSON.parse` did.
	const raw = JSON.parse(yield* fs.readFileString(mapPath)) as { mappings: string };
	const lines = decode(raw.mappings);
	let removed = 0;
	const scrubbed = lines.map((segments) =>
		segments.filter((segment) => {
			if (segment.length === 1) {
				removed += 1;
				return false;
			}
			return true;
		}),
	);
	if (removed > 0) yield* fs.writeFileString(mapPath, `${JSON.stringify({ ...raw, mappings: encode(scrubbed) })}\n`);
	return removed;
});

/**
 * Scrub every `.d.ts.map`/`.d.cts.map`/`.d.mts.map` under `dir` (recursively). Returns the total
 * number of segments removed. Missing dir -> 0.
 *
 * @internal
 */
export const scrubDeclarationMapsUnder: (
	dir: string,
) => Effect.Effect<number, DescendError | PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =
	Effect.fnUntraced(function* (dir: string) {
		const path = yield* Path.Path;
		// prune: [], followSymlinks: true and onUnreadable: "skip" keep the hand-rolled walk's reach: it stat-followed links,
		// pruned nothing, and skipped a directory it could not read.
		const maps = yield* descend(DECLARATION_MAPS, {
			cwd: path.resolve(dir),
			prune: [],
			followSymlinks: true,
			onUnreadable: "skip",
		});
		let removed = 0;
		for (const rel of maps) removed += yield* scrubSourcelessMappings(path.join(dir, rel));
		return removed;
	});
