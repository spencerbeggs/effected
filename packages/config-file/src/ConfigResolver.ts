import { Walker } from "@effected/walker";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";

/**
 * A composable config file resolver: one lookup strategy.
 *
 * @remarks
 * `resolve` yields `Option.some(path)` when a config file is found and
 * `Option.none()` when it is not. **Its error channel is `never` by contract**:
 * every filesystem failure — permission denied, ENOTDIR, a broken symlink — is
 * absorbed into `Option.none()`, so a failure on one tier never aborts the
 * chain. This is deliberate: discovery is best-effort.
 *
 * `R` carries the resolver's requirements. The built-ins require
 * `FileSystem.FileSystem | Path.Path`, satisfied once by the consumer's
 * platform layer at the edge.
 *
 * @public
 */
export interface ConfigResolver<R = never> {
	readonly name: string;
	readonly resolve: Effect.Effect<Option.Option<string>, never, R>;
	/**
	 * The same lookup, reporting **how** the file was found rather than only
	 * where.
	 *
	 * @remarks
	 * Optional, and optional forever: a hand-rolled resolver that omits it is a
	 * complete `ConfigResolver`, and the pipeline falls back to `resolve`,
	 * reporting a bare `{ path }` match. Every built-in implements it, and
	 * derives `resolve` from it, so the two can never disagree.
	 *
	 * It exists because a resolver's `name` cannot identify *which* candidate
	 * matched once one resolver probes several — `upwardWalk` with a
	 * `filenames` list, or with `subpaths`, is one resolver with many
	 * candidates. A consumer that needs the anchor directory (a CLI computing
	 * its project root from the discovered config) reads
	 * {@link ConfigMatch.dir} instead of string-matching the discovered path's
	 * tail.
	 */
	readonly resolveMatch?: Effect.Effect<Option.Option<ConfigMatch>, never, R>;
}

/**
 * How a resolver found a config file, not merely where.
 *
 * @remarks
 * `path` is always present; the rest describe the candidate that matched and
 * are populated only when the resolver knows them. `dir` is the **anchor**: the
 * directory the candidate was resolved against — the ancestor `upwardWalk`
 * stopped at, the root `gitRoot`/`workspaceRoot` found, `staticDir`'s `dir`.
 * `subpath` and `filename` are the `subpaths`/`filenames` entries that matched,
 * exactly as the caller spelled them.
 *
 * @public
 */
export interface ConfigMatch {
	/** The filesystem path that matched. */
	readonly path: string;
	/** The directory the matching candidate was resolved against, when the resolver has one. */
	readonly dir?: string;
	/** The `subpaths` entry that matched, when the resolver takes `subpaths`. */
	readonly subpath?: string;
	/** The `filenames`/`filename` entry that matched, when the resolver takes one. */
	readonly filename?: string;
}

/**
 * Build a resolver from a match-reporting lookup, deriving `resolve` from it.
 *
 * @remarks
 * Every built-in goes through here, so `resolve` and `resolveMatch` are one
 * implementation and cannot drift.
 */
const fromMatch = <R>(
	name: string,
	resolveMatch: Effect.Effect<Option.Option<ConfigMatch>, never, R>,
): ConfigResolver<R> => ({
	name,
	resolve: Effect.map(
		resolveMatch,
		Option.map((match) => match.path),
	),
	resolveMatch,
});

/** Absorb any failure into `Option.none()` — the resolver contract. */
const absorb = <A, R>(effect: Effect.Effect<Option.Option<A>, unknown, R>): Effect.Effect<Option.Option<A>, never, R> =>
	Effect.catch(effect, () => Effect.succeed(Option.none()));

const cwdOf = (given: string | undefined): string => given ?? globalThis.process?.cwd?.() ?? "/";

// Implementation of ConfigResolver.explicitPath; the public contract lives on the static.
const explicitPath = (target: string): ConfigResolver<FileSystem.FileSystem | Path.Path> =>
	fromMatch(
		"explicit",
		absorb(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				// No `dir`: an explicit path names a file, not an anchored candidate.
				return (yield* fs.exists(target)) ? Option.some<ConfigMatch>({ path: target }) : Option.none();
			}),
		),
	);

// Implementation of ConfigResolver.staticDir; the public contract lives on the static.
const staticDir = (options: {
	readonly dir: string;
	readonly filename: string;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> =>
	fromMatch(
		"static",
		absorb(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const candidate = path.join(options.dir, options.filename);
				return (yield* fs.exists(candidate))
					? Option.some<ConfigMatch>({ path: candidate, dir: options.dir, filename: options.filename })
					: Option.none();
			}),
		),
	);

/**
 * Options for `ConfigResolver.upwardWalk`.
 *
 * @remarks
 * Exactly one of `filename` and `filenames` is given. `filename` is the
 * original one-name form and keeps working unchanged; `filenames` is the
 * per-directory candidate list — every name is probed at each ancestor before
 * the walk ascends, which is the "config-dir" convention (`.app.toml`, then
 * `app.toml`, then `.config/app.toml`, all at one level) that separate
 * `upwardWalk` entries cannot express, because the chain exhausts one resolver
 * to the filesystem root before starting the next.
 *
 * A `filenames` entry may itself carry a relative directory
 * (`".config/app.toml"`), which is how a mixed convention is spelled without a
 * `subpaths` cross product.
 *
 * @public
 */
export type UpwardWalkOptions =
	| {
			/** The single file name probed at each ancestor directory. */
			readonly filename: string;
			readonly filenames?: undefined;
			/** Where the walk starts. Defaults to the process cwd. */
			readonly cwd?: string;
			/** An absolute ceiling the walk stops at, inclusive. */
			readonly stopAt?: string;
			/** Directories probed under each ancestor, in order. Defaults to `["."]`. */
			readonly subpaths?: ReadonlyArray<string>;
			/**
			 * The resolver's reported name. Defaults to `"walk"`.
			 *
			 * @remarks
			 * Two `upwardWalk` entries in one chain otherwise report the same
			 * `"walk"`, so `ConfigSource.resolver` cannot tell them apart. Pass a
			 * distinct name per call — or read `ConfigSource.match` instead, which
			 * identifies the matching candidate rather than the resolver.
			 */
			readonly name?: string;
	  }
	| {
			/**
			 * The candidate file names probed at each ancestor directory, in order,
			 * before the walk ascends.
			 */
			readonly filenames: ReadonlyArray<string>;
			readonly filename?: undefined;
			/** Where the walk starts. Defaults to the process cwd. */
			readonly cwd?: string;
			/** An absolute ceiling the walk stops at, inclusive. */
			readonly stopAt?: string;
			/** Directories probed under each ancestor, in order. Defaults to `["."]`. */
			readonly subpaths?: ReadonlyArray<string>;
			/** The resolver's reported name. Defaults to `"walk"`. */
			readonly name?: string;
	  };

// Implementation of ConfigResolver.upwardWalk; the public contract lives on the static.
const upwardWalk = (options: UpwardWalkOptions): ConfigResolver<FileSystem.FileSystem | Path.Path> =>
	fromMatch(
		options.name ?? "walk",
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const subpaths = options.subpaths ?? ["."];
			const filenames = options.filenames ?? [options.filename];
			const dirs = yield* Walker.ascend(cwdOf(options.cwd), {
				...(options.stopAt !== undefined && { stopAt: options.stopAt }),
			});
			// Directory-major, then subpath, then filename: every candidate at one
			// ancestor is exhausted before the walk ascends. A parent's first
			// candidate must never beat a child's second, which is exactly what
			// registering one resolver per filename would do.
			const candidates: Array<ConfigMatch> = [];
			for (const dir of dirs) {
				for (const sub of subpaths) {
					for (const filename of filenames) {
						candidates.push({
							path: path.join(dir, sub, filename),
							dir,
							filename,
							...(options.subpaths !== undefined && { subpath: sub }),
						});
					}
				}
			}
			const found = yield* Walker.firstMatch(
				candidates.map((candidate) => candidate.path),
				(candidate) => fs.exists(candidate),
			);
			// `firstMatch` returns the path; recover the descriptor that produced it.
			return Option.flatMap(found, (target) =>
				Option.fromNullishOr(candidates.find((candidate) => candidate.path === target)),
			);
		}),
	);

/**
 * Ascend from `cwd` looking for the first directory where `isRoot` reports
 * true, then probe `subpaths` under it. Shared by `gitRoot` and
 * `workspaceRoot`, which differ only in how a "root" is detected.
 */
const rootAnchored = (
	name: string,
	isRoot: (dir: string) => Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path>,
	options: { readonly filename: string; readonly cwd?: string; readonly subpaths?: ReadonlyArray<string> },
): ConfigResolver<FileSystem.FileSystem | Path.Path> =>
	fromMatch(
		name,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dirs = yield* Walker.ascend(cwdOf(options.cwd));

			const root = yield* Walker.findRoot(dirs, isRoot);
			if (Option.isNone(root)) return Option.none();

			const subpaths = options.subpaths ?? ["."];
			const found = yield* Walker.firstMatch(
				subpaths.map((sub) => path.join(root.value, sub, options.filename)),
				(candidate) => fs.exists(candidate),
			);
			return Option.map(found, (target): ConfigMatch => {
				const matchedSubpath =
					options.subpaths === undefined
						? undefined
						: subpaths.find((sub) => path.join(root.value, sub, options.filename) === target);
				return {
					path: target,
					// The anchor is the ROOT, not the subpath directory: a consumer
					// asking "where is my project" wants the git/workspace root back.
					dir: root.value,
					filename: options.filename,
					...(matchedSubpath !== undefined && { subpath: matchedSubpath }),
				};
			});
		}),
	);

/** `.git` may be a directory (a normal repo) or a file (a worktree pointing at the real repo). */
const isGitRoot = (
	dir: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		return yield* fs.exists(path.join(dir, ".git"));
	});

/** A workspace root is marked by `pnpm-workspace.yaml`, or a `package.json` with a `workspaces` field. */
const isWorkspaceRoot = (
	dir: string,
): Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (yield* fs.exists(path.join(dir, "pnpm-workspace.yaml"))) return true;
		const pkgPath = path.join(dir, "package.json");
		if (yield* fs.exists(pkgPath)) {
			const content = yield* fs.readFileString(pkgPath);
			try {
				const pkg = JSON.parse(content) as Record<string, unknown>;
				if ("workspaces" in pkg) return true;
			} catch {
				// Not valid JSON, skip.
			}
		}
		return false;
	});

// Implementation of ConfigResolver.gitRoot; the public contract lives on the static.
const gitRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => rootAnchored("git", isGitRoot, options);

// Implementation of ConfigResolver.workspaceRoot; the public contract lives on the static.
const workspaceRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => rootAnchored("workspace", isWorkspaceRoot, options);

// Implementation of ConfigResolver.systemEtc; the public contract lives on the static.
const systemEtc = (options: {
	readonly app: string;
	readonly filename: string;
	/**
	 * System config root. Defaults to `/etc`. Overridable primarily so tests
	 * can point at a writable temp directory — the real `/etc` is not writable
	 * in test environments — and as an escape hatch for non-standard layouts.
	 */
	readonly dir?: string;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> =>
	fromMatch(
		"system",
		absorb(
			Effect.gen(function* () {
				// `/etc` has no meaning on Windows; short-circuit to "not found".
				if (globalThis.process?.platform === "win32") return Option.none();
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const base = options.dir ?? "/etc";
				const dir = path.join(base, options.app);
				const candidate = path.join(dir, options.filename);
				return (yield* fs.exists(candidate))
					? Option.some<ConfigMatch>({ path: candidate, dir, filename: options.filename })
					: Option.none();
			}),
		),
	);

/**
 * Built-in resolvers, in the order a typical chain uses them.
 *
 * @public
 */
export class ConfigResolver {
	private constructor() {}

	/** Resolves to `target` when it exists on disk, or `Option.none()` when it does not — no walking, no filename convention. */
	static readonly explicitPath = explicitPath;

	/** Resolves `path.join(dir, filename)` when it exists on disk, or `Option.none()` when it does not. */
	static readonly staticDir = staticDir;

	/**
	 * Ascends from `cwd` (or the process cwd) toward `stopAt`, resolving the
	 * first `subpaths/filename` combination found at each level.
	 *
	 * @remarks
	 * `filenames` replaces `filename` with a per-directory candidate list: every
	 * name is probed at one ancestor before the walk ascends, so a child's
	 * second candidate still beats a parent's first. Registering one resolver
	 * per filename cannot do this — the chain runs a resolver to the filesystem
	 * root before starting the next.
	 *
	 * `name` overrides the reported `"walk"` so two walks in one chain are
	 * distinguishable; `ConfigSource.match` identifies the matching candidate
	 * more precisely still.
	 */
	static readonly upwardWalk = upwardWalk;

	/**
	 * Ascends from `cwd` to the nearest workspace root — a directory with a
	 * `pnpm-workspace.yaml`, or a `package.json` carrying a `workspaces` field —
	 * then resolves the first `subpaths/filename` combination found under it.
	 */
	static readonly workspaceRoot = workspaceRoot;

	/**
	 * Ascends from `cwd` to the nearest git root — a directory containing a
	 * `.git` entry, directory or file (the latter for a worktree) — then
	 * resolves the first `subpaths/filename` combination found under it.
	 */
	static readonly gitRoot = gitRoot;

	/**
	 * Resolves `<dir>/<app>/<filename>` under the system config root (`/etc` by
	 * default). Always `Option.none()` on Windows, where `/etc` has no meaning.
	 */
	static readonly systemEtc = systemEtc;
}
