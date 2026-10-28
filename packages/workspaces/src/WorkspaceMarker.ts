// The workspace-root marker vocabulary, shared by `WorkspaceRoot` and the sync
// facade. Kept apart from `WorkspaceRoot.ts` so the sync module does not reach
// `@effected/walker` or the service through it.

import { Schema } from "effect";

/**
 * A file that marks a workspace root: a `pnpm-workspace.yaml`, or a
 * `package.json` carrying a `workspaces` field.
 *
 * @public
 */
export const WorkspaceMarker = Schema.Literals(["pnpm-workspace.yaml", "package.json"]);

/**
 * The decoded type of {@link (WorkspaceMarker:variable)}.
 *
 * @public
 */
export type WorkspaceMarker = typeof WorkspaceMarker.Type;

/**
 * The marker filenames {@link WorkspaceRoot} probes for, in priority order.
 *
 * @public
 */
export const WORKSPACE_MARKERS: ReadonlyArray<WorkspaceMarker> = WorkspaceMarker.literals;

/**
 * The markers a search probes, in priority order: every marker by default,
 * or the ones `markers` names.
 *
 * @remarks
 * An empty or unknown marker list is developer wiring, so it throws: a search
 * that probes nothing would report "no root" for every directory.
 *
 * @internal
 */
export const probedMarkers = (markers: ReadonlyArray<WorkspaceMarker> | undefined): ReadonlyArray<WorkspaceMarker> => {
	if (markers === undefined) return WORKSPACE_MARKERS;
	const unknown = markers.filter((marker) => !WORKSPACE_MARKERS.includes(marker));
	if (markers.length === 0 || unknown.length > 0) {
		throw new Error(
			`markers must name at least one of ${WORKSPACE_MARKERS.join(", ")}, received ${JSON.stringify(markers)}`,
		);
	}
	return WORKSPACE_MARKERS.filter((marker) => markers.includes(marker));
};

/**
 * A workspace root, and the marker file that made it one.
 *
 * @public
 */
export class WorkspaceRootMatch extends Schema.Class<WorkspaceRootMatch>("WorkspaceRootMatch")({
	/** The workspace root directory. */
	root: Schema.String,
	/** Which marker matched. */
	marker: WorkspaceMarker,
	/** The marker file's path: `root` joined with `marker`. */
	path: Schema.String,
}) {}
