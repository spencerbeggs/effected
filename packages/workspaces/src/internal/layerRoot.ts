// The layer-bound root lookup every root-consuming service shares.
//
// `WorkspaceDiscovery`, `LockfileReader`, `WorkspaceCatalogs` and
// `WorkspaceSnapshots` each resolve their workspace root from a layer-level
// `cwd` and optional `stopAt`. One implementation means the four cannot
// disagree about which root a layer's options name — discovery refusing an
// enclosing workspace while the lockfile and catalog reads adopt it.

import type { Effect } from "effect";
import type { WorkspaceRootNotFoundError, WorkspaceRootShape } from "../WorkspaceRoot.js";

/** The layer-level options every root-consuming service reads its root from. */
export interface LayerRootOptions {
	readonly cwd?: string;
	readonly stopAt?: string | undefined;
}

/**
 * Resolve the workspace root a layer's options name.
 *
 * An omitted `cwd` is passed to `find` as `"."`, which the live
 * `WorkspaceRoot` resolves through the injected core `Path` at call time — so
 * no `process` read happens here, a `process.chdir` between provide and first
 * use is honoured, and a test can swap `Path` to control the default. Core's
 * `Path.resolve` reads the working directory from `process.cwd()`, so the
 * default still needs a host that exposes `process`: on a host without one,
 * an omitted `cwd` is a defect (core `Path.resolve` throws), not a typed
 * failure — pass `cwd` explicitly there.
 */
export const findLayerRoot = (
	roots: WorkspaceRootShape,
	options: LayerRootOptions | undefined,
): Effect.Effect<string, WorkspaceRootNotFoundError> => {
	const stopAt = options?.stopAt;
	return roots.find(options?.cwd ?? ".", stopAt === undefined ? undefined : { stopAt });
};
