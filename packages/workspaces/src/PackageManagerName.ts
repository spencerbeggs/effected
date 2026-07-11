// Which package manager drives this workspace, and how we work that out.
//
// `PackageManagerName` is structurally identical to `@effected/lockfiles`'
// `LockfileFormat` and assigns freely to it — which is exactly what
// `LockfileReader` relies on. They are kept as separate names because they are
// separate concepts (which PM runs the repo vs. which lockfile grammar to
// parse), and because `@effected/package-json` already exports a
// `PackageManager` class for the corepack `pnpm@10.33.0` field.

import { PackageManager } from "@effected/package-json";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { WorkspaceManifestError } from "./WorkspacePackage.js";

/**
 * The four package managers this package understands.
 *
 * @public
 */
export const PackageManagerName = Schema.Literals(["npm", "pnpm", "yarn", "bun"]);

/**
 * The decoded type of {@link (PackageManagerName:variable)}: `"npm" | "pnpm" | "yarn" | "bun"`.
 *
 * @public
 */
export type PackageManagerName = typeof PackageManagerName.Type;

/**
 * The outcome of package-manager detection at a workspace root.
 *
 * @remarks
 * `version` is `Option.none()` unless a manifest field naming the *same* manager
 * that was detected also carries a version — a `packageManager: "yarn@4"` in a
 * pnpm workspace tells us nothing about pnpm's version, so it is not reported as
 * one. The two fields consulted are the corepack top-level `packageManager` and
 * `devEngines.packageManager`; see {@link PackageManagerDetector} for the
 * precedence between them.
 *
 * @public
 */
export class DetectedPackageManager extends Schema.Class<DetectedPackageManager>("DetectedPackageManager")({
	/** The detected manager. */
	name: PackageManagerName,
	/** Its version, when a manifest field agrees on the manager and carries one. */
	version: Schema.Option(Schema.String),
	/** The JavaScript runtime the manager implies. */
	runtime: Schema.Literals(["node", "bun"]),
}) {}

/**
 * A manager named by one of the two manifest fields: the name, plus the exact
 * version when the field carries one that parses.
 */
interface ManagerHint {
	readonly name: string;
	readonly version: Option.Option<string>;
}

/** Whether `value` is a non-null, non-array object — corepack's own shape test. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The exact version a `name` + `version` pair denotes, or none when the version
 * is not an exact version.
 *
 * Reuses the corepack `name@version+integrity` grammar rather than a second
 * parser, so a `devEngines` version carrying a hash (`11.11.0+sha512.…`, which
 * this repo's own root manifest does) normalizes to the same `11.11.0` the
 * top-level field reports — and a *range* (`^11`, `11.x`) yields none, because a
 * range is not a version and corepack will not run one either.
 */
const exactVersionOf = (name: string, version: string): Option.Option<string> =>
	Schema.decodeUnknownOption(PackageManager.FromString)(`${name}@${version}`).pipe(Option.map((pm) => pm.version));

/**
 * The `devEngines.packageManager` hint, or none.
 *
 * Every malformed shape corepack itself tolerates is tolerated here by *ignoring
 * the field*, never by failing detection: a non-object `devEngines`, a
 * non-object `packageManager`, an **array** of them (corepack does not support
 * arrays in this slot and falls back), a missing or non-string `name`, and a
 * `name` containing `@`. A version that is not an exact version is dropped on its
 * own, keeping the name — the name is still a valid disambiguator.
 */
const devEnginesHint = (manifest: Record<string, unknown>): Option.Option<ManagerHint> => {
	const devEngines = manifest.devEngines;
	if (!isPlainObject(devEngines)) return Option.none();

	const slot = devEngines.packageManager;
	if (!isPlainObject(slot)) return Option.none();

	const name = slot.name;
	if (typeof name !== "string" || name === "" || name.includes("@")) return Option.none();

	const version = slot.version;
	return Option.some({
		name,
		version: typeof version === "string" && version !== "" ? exactVersionOf(name, version) : Option.none<string>(),
	});
};

/** The corepack top-level `packageManager` hint, or none when absent or malformed. */
const corepackHint = (manifest: Record<string, unknown>): Option.Option<ManagerHint> => {
	const raw = manifest.packageManager;
	if (typeof raw !== "string") return Option.none();
	return Schema.decodeUnknownOption(PackageManager.FromString)(raw).pipe(
		Option.map((pm) => ({ name: pm.name, version: Option.some(pm.version) })),
	);
};

/**
 * Raised when a directory carries no lockfile and no workspace configuration,
 * so no package manager can be attributed to it.
 *
 * @public
 */
export class PackageManagerDetectionError extends Schema.TaggedErrorClass<PackageManagerDetectionError>()(
	"PackageManagerDetectionError",
	{
		/** The workspace root that was probed. */
		root: Schema.String,
		/** The marker files probed, in the order they were probed. */
		checked: Schema.Array(Schema.String),
	},
) {
	/** Renders the root and probed markers into a one-line message. */
	override get message(): string {
		return `No package manager detected at ${this.root} (checked ${this.checked.join(", ")})`;
	}
}

/** The markers probed, in priority order. Exposed on the error so the contract is not prose-only. */
const CHECKED = ["pnpm-workspace.yaml", "bun.lock", "bun.lockb", "yarn.lock", "package.json#workspaces"] as const;

/**
 * Every failure {@link PackageManagerDetector} can surface: no manager could be
 * attributed to the root, or the root's `package.json` exists but cannot be read
 * or parsed.
 *
 * @public
 */
export type PackageManagerDetectionFailure = PackageManagerDetectionError | WorkspaceManifestError;

/**
 * Detects which package manager owns a workspace root.
 *
 * @remarks
 * **Lockfile evidence is the primary signal** — it is what says which manager
 * actually ran. Priority, first match wins: a `pnpm-workspace.yaml` means pnpm;
 * a bun lockfile *plus* a manifest field naming bun means bun; a `yarn.lock`
 * *plus* a manifest field naming yarn means yarn; a root `package.json` with a
 * `workspaces` field falls back to npm.
 *
 * The manifest conjunction is deliberate: a stray `yarn.lock` in an npm repo is
 * common, and only a declared manager name disambiguates it.
 *
 * **Two manifest fields declare a manager, and they are not interchangeable.**
 * Corepack reads both, and this is the rule that falls out of how it treats
 * them:
 *
 * - `devEngines.packageManager.name` is authoritative for the **name**.
 *   Corepack *errors* when a top-level `packageManager` disagrees with it (per
 *   `devEngines.packageManager.onFail`), so where both are present and disagree,
 *   `devEngines` is the one to believe. When `devEngines` names a manager, the
 *   top-level field's name is not consulted as a disambiguator at all.
 * - The top-level `packageManager` is authoritative for the exact **version**:
 *   it is the field that carries the integrity hash. Where both name the same
 *   manager, its version wins; where it is absent, `devEngines.packageManager.version`
 *   supplies the version instead.
 *
 * A version is reported **only when the field it came from names the manager
 * that was actually detected**. A `packageManager: "yarn@4"` in a pnpm workspace
 * says nothing about pnpm's version, so no version is reported — and the same
 * discipline applies to `devEngines`.
 *
 * Malformed manifest *hints* are ignored rather than fatal, matching corepack: a
 * non-object or array `devEngines.packageManager`, a `name` containing `@`, or a
 * version that is not an exact version cannot turn a detectable workspace into a
 * detection failure. A manifest that exists but cannot be **read or parsed** is a
 * different thing entirely and fails with a `WorkspaceManifestError` — a corrupt
 * root manifest is a real problem, not a missing hint.
 *
 * @public
 */
export class PackageManagerDetector extends Context.Service<
	PackageManagerDetector,
	{
		/** Detect the package manager at a workspace root. */
		readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionFailure>;
	}
>()("@effected/workspaces/PackageManagerDetector") {
	/** Builds the service over core `FileSystem` and `Path`. */
	static readonly make: Effect.Effect<
		{ readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionFailure> },
		never,
		FileSystem.FileSystem | Path.Path
	> = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const has = (root: string, file: string): Effect.Effect<boolean> =>
			fs.exists(path.join(root, file)).pipe(Effect.orElseSucceed(() => false));

		/**
		 * The root manifest, read and parsed **once** per detection.
		 *
		 * An absent manifest is `Option.none()` — a bun or yarn repo with no root
		 * `package.json` is unusual but not an error. A manifest that is present but
		 * unreadable, unparseable, or not a JSON object fails typed: those are
		 * corrupt-manifest conditions, and swallowing them would report "no manager
		 * declared" for a repo whose manifest is simply broken.
		 */
		const manifestOf = (root: string): Effect.Effect<Option.Option<Record<string, unknown>>, WorkspaceManifestError> =>
			Effect.gen(function* () {
				const packageJsonPath = path.join(root, "package.json");
				const exists = yield* fs.exists(packageJsonPath).pipe(Effect.orElseSucceed(() => false));
				if (!exists) return Option.none<Record<string, unknown>>();

				const content = yield* fs
					.readFileString(packageJsonPath)
					.pipe(Effect.mapError((cause) => new WorkspaceManifestError({ packageJsonPath, kind: "read", cause })));

				const parsed = yield* Effect.try({
					try: () => JSON.parse(content) as unknown,
					catch: (cause) => new WorkspaceManifestError({ packageJsonPath, kind: "decode", cause }),
				});

				if (!isPlainObject(parsed)) {
					return yield* Effect.fail(
						new WorkspaceManifestError({
							packageJsonPath,
							kind: "decode",
							cause: new Error("package.json is not a JSON object"),
						}),
					);
				}
				return Option.some(parsed);
			});

		/**
		 * The manager name the manifest declares, if any.
		 *
		 * `devEngines` first — it is authoritative for the name, and corepack errors
		 * when the top-level field contradicts it.
		 */
		const declaredName = (hints: {
			readonly devEngines: Option.Option<ManagerHint>;
			readonly corepack: Option.Option<ManagerHint>;
		}): Option.Option<string> =>
			Option.map(
				Option.orElse(hints.devEngines, () => hints.corepack),
				(hint) => hint.name,
			);

		/** Whether the manifest declares `name` as its manager. */
		const namesManager = (
			hints: { readonly devEngines: Option.Option<ManagerHint>; readonly corepack: Option.Option<ManagerHint> },
			name: PackageManagerName,
		): boolean => Option.contains(declaredName(hints), name);

		/**
		 * The version to report for the manager that was detected — none unless a
		 * field naming *that* manager carries one.
		 *
		 * The top-level `packageManager` wins when it names the manager, because it
		 * is the field carrying the integrity hash; `devEngines` supplies the version
		 * when it does not.
		 */
		const versionFor = (
			hints: { readonly devEngines: Option.Option<ManagerHint>; readonly corepack: Option.Option<ManagerHint> },
			name: PackageManagerName,
		): Option.Option<string> => {
			if (!namesManager(hints, name)) return Option.none();
			const fromCorepack = Option.flatMap(hints.corepack, (hint) =>
				hint.name === name ? hint.version : Option.none<string>(),
			);
			return Option.orElse(fromCorepack, () =>
				Option.flatMap(hints.devEngines, (hint) => (hint.name === name ? hint.version : Option.none<string>())),
			);
		};

		const detect = Effect.fn("PackageManagerDetector.detect")(function* (root: string) {
			const manifest = yield* manifestOf(root);
			const hints = {
				devEngines: Option.flatMap(manifest, devEnginesHint),
				corepack: Option.flatMap(manifest, corepackHint),
			};

			if (yield* has(root, "pnpm-workspace.yaml")) {
				return DetectedPackageManager.make({
					name: "pnpm",
					version: versionFor(hints, "pnpm"),
					runtime: "node",
				});
			}

			const bunLock = (yield* has(root, "bun.lock")) || (yield* has(root, "bun.lockb"));
			if (bunLock && namesManager(hints, "bun")) {
				return DetectedPackageManager.make({
					name: "bun",
					version: versionFor(hints, "bun"),
					runtime: "bun",
				});
			}

			if ((yield* has(root, "yarn.lock")) && namesManager(hints, "yarn")) {
				return DetectedPackageManager.make({
					name: "yarn",
					version: versionFor(hints, "yarn"),
					runtime: "node",
				});
			}

			const workspaces = Option.map(manifest, (fields) => fields.workspaces);
			if (Option.isSome(workspaces) && workspaces.value !== undefined && workspaces.value !== null) {
				return DetectedPackageManager.make({
					name: "npm",
					version: versionFor(hints, "npm"),
					runtime: "node",
				});
			}

			return yield* Effect.fail(new PackageManagerDetectionError({ root, checked: CHECKED }));
		});

		return {
			detect: (root: string) =>
				detect(root).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path)),
		};
	});

	/** The live layer. */
	static readonly layer: Layer.Layer<PackageManagerDetector, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
		PackageManagerDetector,
		PackageManagerDetector.make,
	);
}
