// The workspace root the tools hold caller-supplied paths to.

import { PathContainment } from "@effected/kit";
import { ToolFailure, ToolRefusal } from "@effected/mcp-kit";
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Option, Path } from "effect";

/** The nearest pnpm workspace, otherwise the nearest git checkout, otherwise where the server started. */
export const findRoot = (cwd: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const chain = yield* Walker.ascend(cwd);
		const holding = (marker: string) => Walker.findRoot(chain, (dir) => fs.exists(path.join(dir, marker)));
		const workspace = yield* holding("pnpm-workspace.yaml");
		return Option.isSome(workspace) ? workspace.value : Option.getOrElse(yield* holding(".git"), () => cwd);
	});

/** Refuses a path that resolves outside `root`; `label` names the parameter it came from. */
export const inside = (root: string, label: string, candidate: string) =>
	Effect.flatMap(PathContainment.isWithin(root, candidate), (within) =>
		within
			? Effect.void
			: Effect.fail(
					ToolRefusal.refuse(
						`The ${label} "${ToolFailure.truncate(candidate)}" is outside the workspace root ${root}.`,
						{
							hint: `Pass a path under ${root}.`,
						},
					),
				),
	);
