// Workspace-root discovery, expressed over `@effected/walker`.
//
// The markers, in priority order: a `pnpm-workspace.yaml`, then a
// `package.json` carrying a `workspaces` field. Walker's per-probe error
// absorption is load-bearing — one unreadable ancestor must not hide a valid
// root above it.

import { Walker } from "@effected/walker";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";

/**
 * The marker filenames {@link WorkspaceRoot} probes for, in priority order.
 *
 * @public
 */
export const WORKSPACE_MARKERS: ReadonlyArray<string> = ["pnpm-workspace.yaml", "package.json"];

/**
 * Raised when no workspace root can be found by ascending from a directory.
 *
 * @remarks
 * `markers` records what was probed, so the failure names the contract rather
 * than paraphrasing it in prose.
 *
 * @public
 */
export class WorkspaceRootNotFoundError extends Schema.TaggedErrorClass<WorkspaceRootNotFoundError>()(
	"WorkspaceRootNotFoundError",
	{
		/** The directory the ascent started from. */
		searchPath: Schema.String,
		/** The marker filenames probed at each ancestor. */
		markers: Schema.Array(Schema.String),
	},
) {
	/** Renders the search path and probed markers into a one-line message. */
	override get message(): string {
		return `No workspace root above ${this.searchPath} (looked for ${this.markers.join(", ")})`;
	}
}

/**
 * Whether `dir` is a workspace root: it holds a `pnpm-workspace.yaml`, or a
 * `package.json` with a `workspaces` field.
 *
 * A malformed root `package.json` is "not a root", not an error — the ascent
 * continues past it, matching walker's absorption contract.
 */
const isWorkspaceRoot = (dir: string): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const pnpmWorkspace = yield* fs
			.exists(path.join(dir, "pnpm-workspace.yaml"))
			.pipe(Effect.orElseSucceed(() => false));
		if (pnpmWorkspace) return true;

		const packageJson = path.join(dir, "package.json");
		const hasManifest = yield* fs.exists(packageJson).pipe(Effect.orElseSucceed(() => false));
		if (!hasManifest) return false;

		const content = yield* fs.readFileString(packageJson).pipe(Effect.orElseSucceed(() => "{}"));
		// JSON.parse throws; inside a `never`-channelled effect that would be a
		// defect, so it is wrapped at the point it can throw rather than trusted
		// to a catch further out.
		const parsed = yield* Effect.try({
			try: () => JSON.parse(content) as Record<string, unknown>,
			catch: () => undefined,
		}).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));

		return parsed.workspaces !== undefined && parsed.workspaces !== null;
	});

/**
 * Locates the workspace root by ascending from a starting directory.
 *
 * @example
 * ```ts
 * import { WorkspaceRoot } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const root = yield* WorkspaceRoot;
 *   return yield* root.find("/repo/packages/utils/src");
 * });
 * ```
 *
 * @public
 */
export class WorkspaceRoot extends Context.Service<
	WorkspaceRoot,
	{
		/**
		 * The nearest workspace root at or above `cwd`.
		 *
		 * @param cwd - The directory to start the ascent from; resolved to an
		 *   absolute path first.
		 */
		readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError>;
	}
>()("@effected/workspaces/WorkspaceRoot") {
	/** Builds the service over core `FileSystem` and `Path`. */
	static readonly make: Effect.Effect<
		{ readonly find: (cwd: string) => Effect.Effect<string, WorkspaceRootNotFoundError> },
		never,
		FileSystem.FileSystem | Path.Path
	> = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const find = Effect.fn("WorkspaceRoot.find")(function* (cwd: string) {
			const start = path.resolve(cwd);
			const chain = yield* Walker.ascend(start);
			const found = yield* Walker.findRoot(chain, isWorkspaceRoot);
			if (Option.isNone(found)) {
				return yield* Effect.fail(new WorkspaceRootNotFoundError({ searchPath: start, markers: WORKSPACE_MARKERS }));
			}
			yield* Effect.logDebug("Workspace root found").pipe(Effect.annotateLogs("workspace.root", found.value));
			return found.value;
		});

		return {
			find: (cwd: string) =>
				find(cwd).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path)),
		};
	});

	/** The live layer. */
	static readonly layer: Layer.Layer<WorkspaceRoot, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
		WorkspaceRoot,
		WorkspaceRoot.make,
	);
}
