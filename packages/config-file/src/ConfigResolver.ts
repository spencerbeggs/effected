import { Effect, FileSystem, Option, Path } from "effect";
import { ascend, findUpward } from "./internal/walkUp.js";

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
}

type FsPath = FileSystem.FileSystem | Path.Path;

/** Absorb any failure into `Option.none()` — the resolver contract. */
const absorb = <R>(
	effect: Effect.Effect<Option.Option<string>, unknown, R>,
): Effect.Effect<Option.Option<string>, never, R> => Effect.catch(effect, () => Effect.succeed(Option.none()));

const cwdOf = (given: string | undefined): string => given ?? globalThis.process?.cwd?.() ?? "/";

/** Probe `subpaths` under `dir`, first match wins. */
const probeSubpaths = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	dir: string,
	filename: string,
	subpaths: ReadonlyArray<string>,
): Effect.Effect<Option.Option<string>, unknown> =>
	findUpward(
		[dir],
		(base) => subpaths.map((sub) => path.join(base, sub, filename)),
		(candidate) => fs.exists(candidate),
	);

const explicitPath = (target: string): ConfigResolver<FsPath> => ({
	name: "explicit",
	resolve: absorb(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return (yield* fs.exists(target)) ? Option.some(target) : Option.none();
		}),
	),
});

const staticDir = (options: { readonly dir: string; readonly filename: string }): ConfigResolver<FsPath> => ({
	name: "static",
	resolve: absorb(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const candidate = path.join(options.dir, options.filename);
			return (yield* fs.exists(candidate)) ? Option.some(candidate) : Option.none();
		}),
	),
});

const upwardWalk = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly stopAt?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FsPath> => ({
	name: "walk",
	resolve: absorb(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const subpaths = options.subpaths ?? ["."];
			const dirs = ascend(path, cwdOf(options.cwd), {
				...(options.stopAt !== undefined && { stopAt: options.stopAt }),
			});
			return yield* findUpward(
				dirs,
				(dir) => subpaths.map((sub) => path.join(dir, sub, options.filename)),
				(candidate) => fs.exists(candidate),
			);
		}),
	),
});

/**
 * Ascend from `cwd` looking for the first directory where `isRoot` reports
 * true, then probe `subpaths` under it. Shared by `gitRoot` and
 * `workspaceRoot`, which differ only in how a "root" is detected.
 */
const rootAnchored = (
	name: string,
	isRoot: (fs: FileSystem.FileSystem, path: Path.Path, dir: string) => Effect.Effect<boolean, unknown>,
	options: { readonly filename: string; readonly cwd?: string; readonly subpaths?: ReadonlyArray<string> },
): ConfigResolver<FsPath> => ({
	name,
	resolve: absorb(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dirs = ascend(path, cwdOf(options.cwd));

			const root = yield* findUpward(
				dirs,
				(dir) => [dir],
				(dir) => isRoot(fs, path, dir),
			);
			if (Option.isNone(root)) return Option.none();

			const subpaths = options.subpaths ?? ["."];
			return yield* probeSubpaths(fs, path, root.value, options.filename, subpaths);
		}),
	),
});

/** `.git` may be a directory (a normal repo) or a file (a worktree pointing at the real repo). */
const isGitRoot = (fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<boolean, unknown> =>
	fs.exists(path.join(dir, ".git"));

/** A workspace root is marked by `pnpm-workspace.yaml`, or a `package.json` with a `workspaces` field. */
const isWorkspaceRoot = (fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<boolean, unknown> =>
	Effect.gen(function* () {
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

const gitRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FsPath> => rootAnchored("git", isGitRoot, options);

const workspaceRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FsPath> => rootAnchored("workspace", isWorkspaceRoot, options);

const systemEtc = (options: {
	readonly app: string;
	readonly filename: string;
	/**
	 * System config root. Defaults to `/etc`. Overridable primarily so tests
	 * can point at a writable temp directory — the real `/etc` is not writable
	 * in test environments — and as an escape hatch for non-standard layouts.
	 */
	readonly dir?: string;
}): ConfigResolver<FsPath> => ({
	name: "system",
	resolve: absorb(
		Effect.gen(function* () {
			// `/etc` has no meaning on Windows; short-circuit to "not found".
			if (globalThis.process?.platform === "win32") return Option.none();
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const base = options.dir ?? "/etc";
			const candidate = path.join(base, options.app, options.filename);
			return (yield* fs.exists(candidate)) ? Option.some(candidate) : Option.none();
		}),
	),
});

/**
 * Built-in resolvers, in the order a typical chain uses them.
 *
 * @public
 */
export const ConfigResolver = {
	explicitPath,
	staticDir,
	upwardWalk,
	workspaceRoot,
	gitRoot,
	systemEtc,
} as const;
