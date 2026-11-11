/**
 * Raise every release whose published floor crosses a dependency's breaking line.
 *
 * `@changesets/assemble-release-plan` bumps a dependent `patch` however far its dependency moves.
 * Under `workspace:^`, a dependent released beside a breaking 0.x minor publishes a floor on the
 * new minor, so a consumer holding the old line of both resolves the patch and gets a dependency
 * it cannot satisfy (effected#1333: `@effected/lockfiles@0.24.1` required `@effected/npm@0.34`).
 * `ReleasePlan.breakingFloors` finds those releases; this script writes one fixed-name changeset
 * per package raising it to the bump that leaves its own line, and plans again until nothing
 * crosses, because a raised package can cross its own dependents' floors.
 *
 * The files it writes are derived: every run recomputes them from the other changesets, rewrites
 * the ones still needed and deletes the rest, so a floor that stops crossing takes its file with it.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import type { BreakingFloor } from "@effected/changesets";
import { PendingChangeset, ReleasePlan } from "@effected/changesets";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer, Result } from "effect";

/** Every file this script owns starts with this, under `.changeset/`. */
export const FLOOR_PREFIX = "breaking-floor-";

/** The bump and the reasons one package is raised. */
export interface RaisedRelease {
	readonly name: string;
	readonly required: BreakingFloor["required"];
	readonly causes: BreakingFloor["causes"];
}

/** The changeset file name, relative to `.changeset/`, that raises `name`. */
export function floorFile(name: string): string {
	return `${FLOOR_PREFIX}${name.replace(/^@/, "").replace(/\//g, "-")}.md`;
}

/** The changeset raising one package, with a line per dependency whose floor it crosses. */
export function renderFloorChangeset(raised: RaisedRelease): string {
	const lines = raised.causes.map(
		(cause) =>
			`- Requires \`${cause.dependency}\` ${cause.newVersion} (\`${cause.kind}\`: \`${cause.range}\`), a breaking release from ${cause.oldVersion}. A consumer still on ${cause.oldVersion} cannot install this version beside it, so this release leaves its own version line too.`,
	);
	return `---\n"${raised.name}": ${raised.required}\n---\n\n## Breaking Changes\n\n${lines.join("\n")}\n`;
}

const isFloorFile = (file: string): boolean => file.startsWith(FLOOR_PREFIX) && file.endsWith(".md");

/**
 * Plan the workspace at `root` without this script's own files, then raise each crossing and plan
 * again until none is left. Returns the raised releases, sorted by name.
 */
export const planFloors = (root: string): Promise<readonly RaisedRelease[]> =>
	Effect.gen(function* () {
		const context = yield* ReleasePlan.readWithContext(root);
		// The base is every changeset but ours, so a raise is never its own evidence.
		const base = context.plan.changesets.filter((changeset) => !isFloorFile(changeset.file));
		const members = context.packages.filter((pkg) => !pkg.isRootWorkspace);
		const packages = members.length > 0 ? members : context.packages;
		const raised = new Map<string, RaisedRelease>();
		// Each pass raises at least one more package or ends, so the package count bounds it.
		for (let pass = 0; pass <= packages.length; pass++) {
			const synthetic = [...raised.values()].map((r) =>
				PendingChangeset.make({
					file: floorFile(r.name),
					releases: new Map([[r.name, r.required]]),
					summary: "",
				}),
			);
			const plan = yield* Effect.fromResult(
				ReleasePlan.assemble({
					packages,
					changesets: [...base, ...synthetic],
					config: context.config,
					...(context.plan.preState === undefined ? {} : { pre: context.plan.preState }),
				}),
			);
			const floors = ReleasePlan.breakingFloors(plan, { packages: context.packages });
			if (floors.length === 0) {
				return [...raised.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
			}
			for (const floor of floors) {
				raised.set(floor.name, { name: floor.name, required: floor.required, causes: floor.causes });
			}
		}
		return yield* Effect.die(new Error("breaking floors did not settle; a raise should never undo another"));
	})
		.pipe(
			Effect.provide(
				WorkspaceDiscovery.layer({ cwd: root }).pipe(
					Layer.provide(WorkspaceRoot.layer),
					Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
				),
			),
			Effect.result,
			Effect.runPromise,
		)
		.then((result) => {
			if (Result.isSuccess(result)) return result.success;
			const error = result.failure;
			throw new Error(`Release plan could not be read: ${error instanceof Error ? error.message : String(error)}`);
		});

/** One file the directory should change: written with `content`, or deleted when it is `undefined`. */
export interface FloorEdit {
	readonly file: string;
	readonly content: string | undefined;
}

/** What `.changeset/` needs to hold exactly the raises in `raised` and none other of ours. */
export function floorEdits(root: string, raised: readonly RaisedRelease[]): readonly FloorEdit[] {
	const dir = join(root, ".changeset");
	const wanted = new Map(raised.map((r) => [floorFile(r.name), renderFloorChangeset(r)]));
	const edits: FloorEdit[] = [];
	for (const [file, content] of wanted) {
		const path = join(dir, file);
		if (!existsSync(path) || readFileSync(path, "utf8") !== content) edits.push({ file, content });
	}
	const present = existsSync(dir) ? readdirSync(dir).filter(isFloorFile) : [];
	for (const file of present.sort()) {
		if (!wanted.has(file)) edits.push({ file, content: undefined });
	}
	return edits;
}

/** Apply `edits` under `<root>/.changeset/`. */
export function applyFloorEdits(root: string, edits: readonly FloorEdit[]): void {
	for (const { file, content } of edits) {
		const path = join(root, ".changeset", file);
		if (content === undefined) rmSync(path, { force: true });
		else writeFileSync(path, content);
	}
}

/** One line per edit, for a person reading a log or a red check. */
export function describeFloorEdits(raised: readonly RaisedRelease[], edits: readonly FloorEdit[]): string {
	const byFile = new Map(raised.map((r) => [floorFile(r.name), r]));
	return edits
		.map(({ file, content }) => {
			const r = byFile.get(file);
			if (content === undefined || r === undefined) return `  .changeset/${file}  (no longer needed)\n`;
			const deps = r.causes.map((c) => `${c.dependency} ${c.oldVersion} -> ${c.newVersion}`).join(", ");
			return `  ${r.name}  -> ${r.required}  (crosses ${deps})\n`;
		})
		.join("");
}

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

if (import.meta.main) {
	try {
		const raised = await planFloors(DEFAULT_ROOT);
		const edits = floorEdits(DEFAULT_ROOT, raised);
		if (process.argv.includes("--check")) {
			if (edits.length > 0) {
				process.stdout.write(
					`Breaking floors are out of date in ${edits.length} changeset(s):\n${describeFloorEdits(raised, edits)}Run \`pnpm changeset:floors\`.\n`,
				);
				process.exitCode = 1;
			} else {
				process.stdout.write("No release crosses a breaking floor.\n");
			}
		} else {
			applyFloorEdits(DEFAULT_ROOT, edits);
			process.stdout.write(
				edits.length > 0
					? describeFloorEdits(raised, edits)
					: "No release crosses a breaking floor; nothing written.\n",
			);
		}
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
