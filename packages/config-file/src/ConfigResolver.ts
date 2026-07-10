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
}

/** Absorb any failure into `Option.none()` — the resolver contract. */
const absorb = <R>(
	effect: Effect.Effect<Option.Option<string>, unknown, R>,
): Effect.Effect<Option.Option<string>, never, R> => Effect.catch(effect, () => Effect.succeed(Option.none()));

const cwdOf = (given: string | undefined): string => given ?? globalThis.process?.cwd?.() ?? "/";

const explicitPath = (target: string): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
	name: "explicit",
	resolve: absorb(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return (yield* fs.exists(target)) ? Option.some(target) : Option.none();
		}),
	),
});

const staticDir = (options: {
	readonly dir: string;
	readonly filename: string;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
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
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
	name: "walk",
	resolve: Effect.gen(function* () {
		const path = yield* Path.Path;
		const subpaths = options.subpaths ?? ["."];
		const dirs = yield* Walker.ascend(cwdOf(options.cwd), {
			...(options.stopAt !== undefined && { stopAt: options.stopAt }),
		});
		return yield* Walker.findUpward(dirs, (dir) => subpaths.map((sub) => path.join(dir, sub, options.filename)));
	}),
});

/**
 * Ascend from `cwd` looking for the first directory where `isRoot` reports
 * true, then probe `subpaths` under it. Shared by `gitRoot` and
 * `workspaceRoot`, which differ only in how a "root" is detected.
 */
const rootAnchored = (
	name: string,
	isRoot: (dir: string) => Effect.Effect<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path>,
	options: { readonly filename: string; readonly cwd?: string; readonly subpaths?: ReadonlyArray<string> },
): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
	name,
	resolve: Effect.gen(function* () {
		const path = yield* Path.Path;
		const dirs = yield* Walker.ascend(cwdOf(options.cwd));

		const root = yield* Walker.findRoot(dirs, isRoot);
		if (Option.isNone(root)) return Option.none();

		const subpaths = options.subpaths ?? ["."];
		return yield* Walker.findUpward([root.value], (dir) =>
			subpaths.map((sub) => path.join(dir, sub, options.filename)),
		);
	}),
});

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

const gitRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => rootAnchored("git", isGitRoot, options);

const workspaceRoot = (options: {
	readonly filename: string;
	readonly cwd?: string;
	readonly subpaths?: ReadonlyArray<string>;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => rootAnchored("workspace", isWorkspaceRoot, options);

const systemEtc = (options: {
	readonly app: string;
	readonly filename: string;
	/**
	 * System config root. Defaults to `/etc`. Overridable primarily so tests
	 * can point at a writable temp directory — the real `/etc` is not writable
	 * in test environments — and as an escape hatch for non-standard layouts.
	 */
	readonly dir?: string;
}): ConfigResolver<FileSystem.FileSystem | Path.Path> => ({
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
