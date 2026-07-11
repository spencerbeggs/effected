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
 * `version` is `Option.none()` unless the root `package.json` carries a
 * `packageManager` field naming the *same* manager that was detected — a
 * `packageManager: "yarn@4"` in a pnpm workspace tells us nothing about pnpm's
 * version, so it is not reported as one.
 *
 * @public
 */
export class DetectedPackageManager extends Schema.Class<DetectedPackageManager>("DetectedPackageManager")({
	/** The detected manager. */
	name: PackageManagerName,
	/** Its version, when the corepack `packageManager` field agrees on the manager. */
	version: Schema.Option(Schema.String),
	/** The JavaScript runtime the manager implies. */
	runtime: Schema.Literals(["node", "bun"]),
}) {}

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
 * Detects which package manager owns a workspace root.
 *
 * @remarks
 * Priority, first match wins: a `pnpm-workspace.yaml` means pnpm; a bun
 * lockfile *plus* a `bun@` corepack field means bun; a `yarn.lock` *plus* a
 * `yarn@` corepack field means yarn; a root `package.json` with a `workspaces`
 * field falls back to npm.
 *
 * The corepack conjunction is deliberate: a stray `yarn.lock` in an npm repo is
 * common, and a `packageManager` field is the only thing that disambiguates.
 *
 * @public
 */
export class PackageManagerDetector extends Context.Service<
	PackageManagerDetector,
	{
		/** Detect the package manager at a workspace root. */
		readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionError>;
	}
>()("@effected/workspaces/PackageManagerDetector") {
	/** Builds the service over core `FileSystem` and `Path`. */
	static readonly make: Effect.Effect<
		{ readonly detect: (root: string) => Effect.Effect<DetectedPackageManager, PackageManagerDetectionError> },
		never,
		FileSystem.FileSystem | Path.Path
	> = Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const has = (root: string, file: string): Effect.Effect<boolean> =>
			fs.exists(path.join(root, file)).pipe(Effect.orElseSucceed(() => false));

		/** The parsed corepack `packageManager` field, or none. Never fails. */
		const corepackField = (root: string): Effect.Effect<Option.Option<PackageManager>> =>
			Effect.gen(function* () {
				const manifestPath = path.join(root, "package.json");
				const exists = yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false));
				if (!exists) return Option.none<PackageManager>();
				const content = yield* fs.readFileString(manifestPath).pipe(Effect.orElseSucceed(() => "{}"));
				const parsed = yield* Effect.try({
					try: () => JSON.parse(content) as Record<string, unknown>,
					catch: () => undefined,
				}).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));
				const raw = parsed.packageManager;
				if (typeof raw !== "string") return Option.none<PackageManager>();
				return yield* Schema.decodeUnknownEffect(PackageManager.FromString)(raw).pipe(Effect.option);
			});

		const hasWorkspacesField = (root: string): Effect.Effect<boolean> =>
			Effect.gen(function* () {
				const manifestPath = path.join(root, "package.json");
				const exists = yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false));
				if (!exists) return false;
				const content = yield* fs.readFileString(manifestPath).pipe(Effect.orElseSucceed(() => "{}"));
				const parsed = yield* Effect.try({
					try: () => JSON.parse(content) as Record<string, unknown>,
					catch: () => undefined,
				}).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>));
				return parsed.workspaces !== undefined && parsed.workspaces !== null;
			});

		/** The corepack version, but only when the field names the manager we detected. */
		const versionFor = (field: Option.Option<PackageManager>, name: PackageManagerName): Option.Option<string> =>
			Option.flatMap(field, (pm) => (pm.name === name ? Option.some(pm.version) : Option.none()));

		const detect = Effect.fn("PackageManagerDetector.detect")(function* (root: string) {
			const field = yield* corepackField(root);

			if (yield* has(root, "pnpm-workspace.yaml")) {
				return DetectedPackageManager.make({
					name: "pnpm",
					version: versionFor(field, "pnpm"),
					runtime: "node",
				});
			}

			const bunLock = (yield* has(root, "bun.lock")) || (yield* has(root, "bun.lockb"));
			if (bunLock && Option.isSome(versionFor(field, "bun"))) {
				return DetectedPackageManager.make({
					name: "bun",
					version: versionFor(field, "bun"),
					runtime: "bun",
				});
			}

			if ((yield* has(root, "yarn.lock")) && Option.isSome(versionFor(field, "yarn"))) {
				return DetectedPackageManager.make({
					name: "yarn",
					version: versionFor(field, "yarn"),
					runtime: "node",
				});
			}

			if (yield* hasWorkspacesField(root)) {
				return DetectedPackageManager.make({
					name: "npm",
					version: versionFor(field, "npm"),
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
