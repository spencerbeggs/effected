import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { WorkspaceDiscovery, WorkspaceRootNotFoundError, Workspaces } from "@effected/workspaces";
import { Data, Effect, Layer } from "effect";
import { TSDOCTOR_MANIFEST_FILENAME } from "./BundleManifest.js";
import type { ManifestSource } from "./ManifestSource.js";
import { decodeManifestSource } from "./ManifestSource.js";

/**
 * A present `tsdoctor.json` source file that could not be parsed or decoded. Absence is never
 * this error — a missing source tier is the normal case.
 *
 * @public
 */
export class TsdoctorSourceError extends Data.TaggedError("TsdoctorSourceError")<{
	readonly path: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Invalid ${TSDOCTOR_MANIFEST_FILENAME} at ${this.path}`;
	}
}

/**
 * The two source tiers a build reads: the package's own file and the workspace root's.
 *
 * @public
 */
export interface TsdoctorSources {
	readonly leaf: ManifestSource | undefined;
	readonly project: ManifestSource | undefined;
	/**
	 * Why workspace discovery failed, when it did. The project tier is then unknown rather than
	 * absent; `runMetaPass` records it as a `meta` warning so the degradation is visible in `issues.json`.
	 */
	readonly discoveryFailure?: string | undefined;
}

/** Bound once: the platform layer is stateless and layers memoize by reference. */
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The canonical absolute form of a directory, so a relative or symlinked `cwd` compares equal to the discovered root. */
function canonical(dir: string): string {
	const absolute = resolve(dir);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

/** `Effect.runPromise` rejects with the failure itself or with a `FiberFailure` wrapping it; check both. */
function isRootNotFound(cause: unknown): boolean {
	if (cause instanceof WorkspaceRootNotFoundError) return true;
	return typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "WorkspaceRootNotFoundError";
}

/**
 * The workspace root containing `cwd`, or the reason discovery failed. A package outside any
 * workspace is the `root: undefined` case with no failure. Mirrors the `WorkspaceDiscovery`
 * invocation in `changesets/next-versions.ts`.
 */
async function findWorkspaceRoot(
	cwd: string,
): Promise<{ readonly root: string | undefined; readonly failure?: string | undefined }> {
	try {
		const packages = await Effect.runPromise(
			Effect.gen(function* () {
				const discovery = yield* WorkspaceDiscovery;
				return yield* discovery.listPackages();
			}).pipe(Effect.provide(Workspaces.layer({ cwd }).pipe(Layer.provide(platform)))),
		);
		// listPackages is root-first; the root package's path is the workspace root.
		return { root: packages[0]?.isRootWorkspace ? packages[0].path : undefined };
	} catch (cause) {
		// No workspace above cwd is the normal standalone-package case, not a failure. Every OTHER
		// discovery failure (a root package.json without a version, an unparseable pnpm-workspace.yaml,
		// a malformed sibling manifest) is surfaced, never swallowed.
		if (isRootNotFound(cause)) return { root: undefined };
		return { root: undefined, failure: cause instanceof Error ? cause.message : String(cause) };
	}
}

async function readSource(path: string): Promise<ManifestSource | undefined> {
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch (cause) {
		throw new TsdoctorSourceError({ path, cause });
	}
	const result = await Effect.runPromise(Effect.result(decodeManifestSource(parsed, path)));
	if (result._tag === "Failure") throw new TsdoctorSourceError({ path, cause: result.failure });
	return result.success;
}

/**
 * Read the leaf (`<cwd>/tsdoctor.json`) and project (`<workspaceRoot>/tsdoctor.json`)
 * source tiers. Absence is normal; a present file that does not decode throws
 * {@link TsdoctorSourceError}. A package that IS the workspace root reads its file once, as the
 * leaf, and has no project tier.
 *
 * @public
 */
export async function loadTsdoctorSources(cwd: string): Promise<TsdoctorSources> {
	const leafDir = canonical(cwd);
	const leaf = await readSource(join(leafDir, TSDOCTOR_MANIFEST_FILENAME));
	const { root, failure } = await findWorkspaceRoot(leafDir);
	const project =
		root !== undefined && canonical(root) !== leafDir
			? await readSource(join(root, TSDOCTOR_MANIFEST_FILENAME))
			: undefined;
	return { leaf, project, ...(failure !== undefined ? { discoveryFailure: failure } : {}) };
}
