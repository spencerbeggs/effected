import type { ManifestSource } from "@effected/manifest";
import { BUNDLE_MANIFEST_FILENAME, decodeManifestSource } from "@effected/manifest";
import { WorkspaceDiscovery, WorkspaceRootNotFoundError, Workspaces } from "@effected/workspaces";
import type { PlatformError } from "effect";
import { Cause, Data, Effect, FileSystem, Path } from "effect";
import { existsLikeNode } from "../internal/exists.js";

/**
 * A present `bundle.json` source file that could not be parsed or decoded. Absence is never
 * this error — a missing source tier is the normal case.
 *
 * @public
 */
export class BundleManifestSourceError extends Data.TaggedError("BundleManifestSourceError")<{
	readonly path: string;
	readonly cause: unknown;
}> {
	get message(): string {
		return `Invalid ${BUNDLE_MANIFEST_FILENAME} at ${this.path}`;
	}
}

/**
 * The two source tiers a build reads: the package's own file and the workspace root's.
 *
 * @public
 */
export interface BundleManifestSources {
	readonly leaf: ManifestSource | undefined;
	readonly project: ManifestSource | undefined;
	/**
	 * Why workspace discovery failed, when it did. The project tier is then unknown rather than
	 * absent; `runMetaPass` records it as a `meta` warning so the degradation is visible in `issues.json`.
	 */
	readonly discoveryFailure?: string | undefined;
	/**
	 * Source files under the retired name `tsdoctor.json`, at a tier with no `bundle.json`. They are never
	 * read; `runMetaPass` records each as a `meta` warning so a missed rename is visible instead of the tier
	 * silently disappearing. Absent when there are none.
	 */
	readonly retiredSources?: ReadonlyArray<string> | undefined;
}

/**
 * The sidecar's and its source files' name before it became `bundle.json`. Nothing reads or writes it: a build
 * deletes an emitted copy and reports an authored one.
 *
 * @internal
 */
export const RETIRED_MANIFEST_FILENAME = "tsdoctor.json";

/** The canonical absolute form of a directory, so a relative or symlinked `cwd` compares equal to the discovered root. */
const canonical = (dir: string): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const absolute = (yield* Path.Path).resolve(dir);
		return yield* (yield* FileSystem.FileSystem).realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
	});

/**
 * The workspace root containing `cwd`, or the reason discovery failed. A package outside any
 * workspace is the `root: undefined` case with no failure. Mirrors the `WorkspaceDiscovery`
 * invocation in `changesets/next-versions.ts`.
 */
const findWorkspaceRoot = (
	cwd: string,
): Effect.Effect<
	{ readonly root: string | undefined; readonly failure?: string | undefined },
	never,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.flatMap(WorkspaceDiscovery, (discovery) => discovery.listPackages()).pipe(
		Effect.provide(Workspaces.layer({ cwd })),
		// listPackages is root-first; the root package's path is the workspace root.
		Effect.map((packages) => ({ root: packages[0]?.isRootWorkspace ? packages[0].path : undefined })),
		// No workspace above cwd is the normal standalone-package case, not a failure. Every OTHER
		// discovery failure (a root package.json without a version, an unparseable pnpm-workspace.yaml,
		// a malformed sibling manifest) is surfaced, never swallowed. A defect is surfaced the same way.
		Effect.catchCause((cause) => {
			if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
			const error = Cause.squash(cause);
			if (error instanceof WorkspaceRootNotFoundError) return Effect.succeed({ root: undefined });
			return Effect.succeed({ root: undefined, failure: error instanceof Error ? error.message : String(error) });
		}),
	);

const readSource = Effect.fnUntraced(function* (
	path: string,
): Effect.fn.Return<
	ManifestSource | undefined,
	BundleManifestSourceError | PlatformError.PlatformError,
	FileSystem.FileSystem
> {
	const fs = yield* FileSystem.FileSystem;
	if (!(yield* existsLikeNode(path))) return undefined;
	const text = yield* fs.readFileString(path);
	const parsed = yield* Effect.try({
		try: () => JSON.parse(text) as unknown,
		catch: (cause) => new BundleManifestSourceError({ path, cause }),
	});
	return yield* decodeManifestSource(parsed, path).pipe(
		Effect.mapError((cause) => new BundleManifestSourceError({ path, cause })),
	);
});

/**
 * Read the leaf (`<cwd>/bundle.json`) and project (`<workspaceRoot>/bundle.json`)
 * source tiers. Absence is normal; a present file that does not decode fails
 * {@link BundleManifestSourceError}. A package that IS the workspace root reads its file once, as the
 * leaf, and has no project tier.
 *
 * @public
 */
export const loadBundleManifestSources: (
	cwd: string,
) => Effect.Effect<
	BundleManifestSources,
	BundleManifestSourceError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path
> = Effect.fnUntraced(function* (cwd: string) {
	const { join } = yield* Path.Path;
	const leafDir = yield* canonical(cwd);
	const tierDirs = [leafDir];
	const leaf = yield* readSource(join(leafDir, BUNDLE_MANIFEST_FILENAME));
	const { root, failure } = yield* findWorkspaceRoot(leafDir);
	const projectDir = root !== undefined && (yield* canonical(root)) !== leafDir ? root : undefined;
	if (projectDir !== undefined) tierDirs.push(projectDir);
	const project = projectDir !== undefined ? yield* readSource(join(projectDir, BUNDLE_MANIFEST_FILENAME)) : undefined;
	// Detection only: a retired-name file is never read, only reported, and only where the tier has no bundle.json.
	const retiredSources: string[] = [];
	for (const dir of tierDirs) {
		const retired = join(dir, RETIRED_MANIFEST_FILENAME);
		if (!(yield* existsLikeNode(join(dir, BUNDLE_MANIFEST_FILENAME))) && (yield* existsLikeNode(retired)))
			retiredSources.push(retired);
	}
	return {
		leaf,
		project,
		...(failure !== undefined ? { discoveryFailure: failure } : {}),
		...(retiredSources.length > 0 ? { retiredSources } : {}),
	};
});
