import type { PnpmSettingsError } from "@effected/pnpm";
import { PnpmSettings } from "@effected/pnpm";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";

/**
 * Where {@link (ReleaseManager:variable).detect} reads the environment from.
 *
 * @public
 */
export interface ReleaseManagerDetectOptions {
	/**
	 * The environment, as a plain record, handed to `PnpmSettings.load`. It
	 * matters only when `PNPM_CONFIG_WORKSPACE_DIR` names a workspace directory;
	 * the default is an empty record, so the answer never depends on the
	 * ambient process.
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** The platform handed to `PnpmSettings.load`; it never changes the answer. Defaults to `"linux"`. */
	readonly platform?: string;
}

const detect = Effect.fn("ReleaseManager.detect")(function* (root: string, options?: ReleaseManagerDetectOptions) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const settings = yield* PnpmSettings.load({
		cwd: root,
		env: options?.env ?? {},
		platform: options?.platform ?? "linux",
	});
	const versioning = yield* Effect.fromResult(Result.map(settings.versioning(), Option.isSome));
	if (versioning) return "pnpm" as const;
	const ledger = yield* fs.exists(path.join(root, ".changeset", "ledger.yaml"));
	return ledger ? ("pnpm" as const) : ("changesets" as const);
});

/**
 * The tool that plans and applies a repository's releases: the Changesets
 * CLI, or pnpm's own versioning.
 *
 * @remarks
 * `detect` answers `"pnpm"` when the workspace's `pnpm-workspace.yaml` has a
 * `versioning` block, or `.changeset/ledger.yaml` exists, and `"changesets"`
 * otherwise. pnpm ignores `.changeset/pre.json` and `config.json` entirely, so
 * their presence decides nothing: a `pre.json` beside a `versioning` key is
 * still pnpm. A `versioning` block that does not decode fails with
 * `PnpmSettingsError` rather than reading as absent. The value is both the
 * schema of the two names and the namespace of `detect`.
 *
 * @example
 * ```ts
 * import { Effect } from "effect";
 * import { ReleaseManager } from "@effected/changesets";
 *
 * // `FileSystem` and `Path` come from the platform layer at the edge.
 * const program = ReleaseManager.detect("/repo").pipe(Effect.map((manager) => manager === "pnpm"));
 * ```
 *
 * @public
 */
export const ReleaseManager = Object.assign(Schema.Literals(["changesets", "pnpm"]), {
	/**
	 * Detect which tool plans the releases of the repository at `root`.
	 *
	 * @param root - The repository root, where `pnpm-workspace.yaml` and `.changeset/` live.
	 * @param options - The environment handed to `PnpmSettings.load`; see {@link ReleaseManagerDetectOptions}.
	 */
	detect,
});

/**
 * The tool that plans a repository's releases.
 *
 * @public
 */
export type ReleaseManager = typeof ReleaseManager.Type;
