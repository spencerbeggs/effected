// The `packages:` enumerator — the fix for workspaces issue #62.
//
// v3's glob-core silently rewrote a trailing `/**` to `/*`, so `packages/**`
// matched exactly one level and a nested package went undiscovered with no
// diagnostic. Here `@effected/glob` classifies the pattern set and tells us,
// per wildcard, whether it can cross a segment boundary; when it can, we owe a
// real descent.
//
// The descent is a WORKLIST, not a recursion: it cannot overflow the stack, so
// there is no cap to get wrong. It is bounded by depth, by a visited-directory
// budget, and by an unconditional node_modules / .git prune.

import type { GlobPattern, GlobSet } from "@effected/glob";
import { Effect, FileSystem, Path } from "effect";
import { MAX_ENUMERATION_DEPTH, MAX_ENUMERATION_ENTRIES, PRUNED_DIRECTORIES } from "./limits.js";

/** A directory the enumerator accepted: its root-relative POSIX path and its absolute path. */
export interface EnumeratedDirectory {
	readonly relativePath: string;
	readonly path: string;
}

/** Why an enumeration failed. Every member is a caller-visible condition, never a defect. */
export type EnumerationFailureKind = "missingBaseDir" | "depthExceeded" | "budgetExceeded" | "unreadableDirectory";

/** The enumerator's raw failure record; the facade materializes the typed error. */
export interface EnumerationFailure {
	readonly kind: EnumerationFailureKind;
	readonly pattern: string;
	readonly detail: string;
}

/** Options for {@link enumerate}. */
export interface EnumerateOptions {
	/** Descent cap below a wildcard's enumeration prefix. Defaults to 32. */
	readonly maxDepth?: number;
}

/** Join root-relative POSIX segments; `""` is the root itself. */
const joinRelative = (base: string, entry: string): string => (base === "" ? entry : `${base}/${entry}`);

/** Strip a trailing slash from `GlobPattern.enumerationPrefix` to get a relative directory. */
const baseOf = (pattern: GlobPattern): string => pattern.enumerationPrefix.replace(/\/$/, "");

/**
 * Enumerate the workspace directories a compiled `packages:` set selects.
 *
 * Every returned directory holds a `package.json`, matches at least one include
 * (literal or wildcard), and is rejected by no exclude. Results are sorted by
 * relative path.
 */
export const enumerate = (
	root: string,
	globs: GlobSet,
	options?: EnumerateOptions,
): Effect.Effect<ReadonlyArray<EnumeratedDirectory>, EnumerationFailure, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const maxDepth = options?.maxDepth ?? MAX_ENUMERATION_DEPTH;
		// `NaN < 1` is false and so is `2.5 < 1` — a bare relational guard admits
		// both, and a NaN depth then runs the loop zero times and returns an empty
		// result indistinguishable from a legitimate one. Integrality first.
		if (!Number.isInteger(maxDepth) || maxDepth < 1) {
			return yield* Effect.die(
				new Error(`enumerate: maxDepth must be a positive integer, received ${String(maxDepth)}`),
			);
		}

		const isPackage = (absolute: string): Effect.Effect<boolean> =>
			fs.exists(path.join(absolute, "package.json")).pipe(Effect.orElseSucceed(() => false));

		const isDirectory = (absolute: string): Effect.Effect<boolean> =>
			fs.stat(absolute).pipe(
				Effect.map((info) => info.type === "Directory"),
				Effect.orElseSucceed(() => false),
			);

		const included = new Map<string, string>();
		let visited = 0;

		const consumeBudget = (pattern: string): Effect.Effect<void, EnumerationFailure> => {
			visited += 1;
			return visited > MAX_ENUMERATION_ENTRIES
				? Effect.fail({
						kind: "budgetExceeded" as const,
						pattern,
						detail: `visited more than ${MAX_ENUMERATION_ENTRIES} directories`,
					})
				: Effect.void;
		};

		// Literals: an exact lookup, no directory read at all.
		for (const literal of globs.literals) {
			const absolute = path.join(root, literal);
			if (yield* isPackage(absolute)) included.set(literal, absolute);
		}

		for (const wildcard of globs.wildcards) {
			const base = baseOf(wildcard);
			const absoluteBase = path.join(root, base);

			const exists = yield* isDirectory(absoluteBase);
			if (!exists) {
				// v3 failed here too, and it is the behaviour that catches a typo in
				// `packages:` instead of silently discovering nothing.
				return yield* Effect.fail<EnumerationFailure>({
					kind: "missingBaseDir",
					pattern: wildcard.source,
					detail: base === "" ? root : base,
				});
			}

			// A worklist, not a recursion. `depth` counts levels BELOW the base.
			const queue: Array<{ readonly relative: string; readonly absolute: string; readonly depth: number }> = [
				{ relative: base, absolute: absoluteBase, depth: 0 },
			];

			while (queue.length > 0) {
				const current = queue.shift();
				/* v8 ignore next */
				if (current === undefined) break;

				yield* consumeBudget(wildcard.source);

				// A directory that vanished between the parent's listing and this read
				// is a benign race — treat it as empty. Anything else (permission
				// denied, an IO error) means a subtree we were asked to enumerate is
				// unreadable, and answering with "no packages there" would be a WRONG
				// ANSWER dressed as an empty one.
				//
				// This is deliberately NOT `@effected/walker`'s per-probe absorption.
				// Walker absorbs because one unreadable ANCESTOR must not hide a valid
				// root above it — the walk continues upward and can still succeed. This
				// is DOWNWARD enumeration: a swallowed subtree is silently missing
				// membership, which is the same silent-degradation shape as the
				// trailing-`/**` bug this module exists to fix.
				const entries = yield* fs.readDirectory(current.absolute).pipe(
					Effect.catch((error) =>
						error.reason._tag === "NotFound"
							? Effect.succeed<ReadonlyArray<string>>([])
							: Effect.fail<EnumerationFailure>({
									kind: "unreadableDirectory",
									pattern: wildcard.source,
									detail: current.relative === "" ? root : current.relative,
								}),
					),
				);

				for (const entry of entries) {
					if (PRUNED_DIRECTORIES.has(entry)) continue;

					const relative = joinRelative(current.relative, entry);
					const absolute = path.join(current.absolute, entry);
					if (!(yield* isDirectory(absolute))) continue;

					if (wildcard.matches(relative) && (yield* isPackage(absolute))) included.set(relative, absolute);

					// Only a segment-crossing pattern earns a descent. `packages/*`
					// reads one level, exactly as v3 did — correctly, for that pattern.
					if (!wildcard.crossesSegments) continue;

					const depth = current.depth + 1;
					if (depth > maxDepth) {
						return yield* Effect.fail<EnumerationFailure>({
							kind: "depthExceeded",
							pattern: wildcard.source,
							detail: `descended past ${maxDepth} levels below "${base}"`,
						});
					}
					queue.push({ relative, absolute, depth });
				}
			}
		}

		const results: Array<EnumeratedDirectory> = [];
		for (const [relativePath, absolute] of included) {
			if (globs.excludes.some((exclude) => exclude.matches(relativePath))) continue;
			results.push({ relativePath, path: absolute });
		}
		results.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
		return results;
	});
