// Reading the workspace `packages:` pattern list.
//
// pnpm records it in `pnpm-workspace.yaml`; npm, yarn and bun record it in the
// root package.json `workspaces` field (array form, or the legacy
// `{ packages: [...] }` object form). v3 hand-rolled a line-by-line YAML
// scanner here "to avoid pulling in a YAML library"; `@effected/yaml` is a
// workspace sibling, so the scanner is deleted.

import { Yaml } from "@effected/yaml";
import { Effect, FileSystem, Path } from "effect";

/** The reason a pattern read failed, with the file it failed on. */
export interface PatternReadFailure {
	readonly path: string;
	readonly kind: "invalidYaml" | "invalidJson";
	readonly cause: unknown;
}

const stringsOf = (value: unknown): ReadonlyArray<string> | undefined =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

/** The `packages:` list of a `pnpm-workspace.yaml` document. Total on a parsed document. */
export const pnpmPatternsOf = (document: unknown): ReadonlyArray<string> => {
	if (document === null || typeof document !== "object") return [];
	return stringsOf((document as Record<string, unknown>).packages) ?? [];
};

/** The `workspaces` field of a root package.json, in either supported shape. */
export const manifestPatternsOf = (manifest: unknown): ReadonlyArray<string> => {
	if (manifest === null || typeof manifest !== "object") return [];
	const workspaces = (manifest as Record<string, unknown>).workspaces;
	const direct = stringsOf(workspaces);
	if (direct !== undefined) return direct;
	if (workspaces !== null && typeof workspaces === "object" && "packages" in workspaces) {
		return stringsOf((workspaces as { readonly packages: unknown }).packages) ?? [];
	}
	return [];
};

/**
 * The workspace `packages:` patterns for `root`: `pnpm-workspace.yaml` first,
 * then the root package.json `workspaces` field. An absent config is a
 * standalone package, not an error — it yields an empty list.
 */
export const readPatterns = (
	root: string,
): Effect.Effect<ReadonlyArray<string>, PatternReadFailure, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const pnpmWorkspacePath = path.join(root, "pnpm-workspace.yaml");
		const hasPnpmWorkspace = yield* fs.exists(pnpmWorkspacePath).pipe(Effect.orElseSucceed(() => false));
		if (hasPnpmWorkspace) {
			const content = yield* fs.readFileString(pnpmWorkspacePath).pipe(Effect.orElseSucceed(() => ""));
			const document = yield* Yaml.parse(content).pipe(
				Effect.mapError((cause): PatternReadFailure => ({ path: pnpmWorkspacePath, kind: "invalidYaml", cause })),
			);
			const patterns = pnpmPatternsOf(document);
			if (patterns.length > 0) return patterns;
		}

		const manifestPath = path.join(root, "package.json");
		const hasManifest = yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false));
		if (!hasManifest) return [];

		const content = yield* fs.readFileString(manifestPath).pipe(Effect.orElseSucceed(() => "{}"));
		const manifest = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (cause): PatternReadFailure => ({ path: manifestPath, kind: "invalidJson", cause }),
		});
		return manifestPatternsOf(manifest);
	});
