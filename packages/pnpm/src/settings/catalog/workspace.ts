import { Schema } from "effect";
import { Bool, Integer, Str, StringArray, StringRecord, UnknownRecord, entry } from "./schemas.js";

/** The workspace-structure settings: membership, catalogs, linking and recursive selection. */
export const workspace = {
	catalog: entry("catalog", {
		schema: StringRecord,
		kind: "stringRecord",
		description: "The default catalog: dependency names and the version ranges the `catalog:` protocol resolves to.",
		locations: ["workspace"],
	}),
	catalogs: entry("catalogs", {
		schema: Schema.Record(Schema.String, StringRecord),
		kind: "unknownRecord",
		description: "The named catalogs: each maps dependency names to the version ranges `catalog:<name>` resolves to.",
		locations: ["workspace"],
	}),
	changedFilesIgnorePattern: entry("changedFilesIgnorePattern", {
		schema: StringArray,
		kind: "stringArray",
		description: "Glob patterns of changed files the `--filter` change detection ignores.",
		locations: ["workspace", "env"],
	}),
	cleanupUnusedCatalogs: entry("cleanupUnusedCatalogs", {
		schema: Bool,
		kind: "boolean",
		description: "The former name of `catalogPrune`; `catalogPrune` wins when a file sets both.",
		locations: ["workspace", "global"],
	}),
	configDependencies: entry("configDependencies", {
		schema: UnknownRecord,
		kind: "unknownRecord",
		description:
			"Packages pnpm installs before reading the rest of the configuration, keyed by name, each value a version with its integrity.",
		locations: ["workspace"],
	}),
	dedupeInjectedDeps: entry("dedupeInjectedDeps", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, injected workspace dependencies whose materialised children turn out to be a subset of the target workspace project's own direct dependencies get rewritten back to symlinks.",
		locations: ["workspace", "env"],
		default: true,
	}),
	disallowWorkspaceCycles: entry("disallowWorkspaceCycles", {
		schema: Bool,
		kind: "boolean",
		description:
			"Make a cycle among the selected workspace projects an error (`ERR_PNPM_DISALLOW_WORKSPACE_CYCLES`) rather than a warning.",
		locations: ["workspace", "global", "env"],
	}),
	failIfNoMatch: entry("failIfNoMatch", {
		schema: Bool,
		kind: "boolean",
		description:
			"Exit with code 1 when the `--filter` / `--filter-prod` selectors select no workspace project, instead of letting the command run over an empty selection.",
		locations: ["workspace", "global", "env"],
	}),
	ignoreWorkspace: entry("ignoreWorkspace", {
		schema: Bool,
		kind: "boolean",
		description:
			"Treat the project as standalone: no workspace root is discovered, so `pnpm-workspace.yaml` contributes neither settings nor sibling projects.",
		locations: ["workspace", "global", "env"],
	}),
	ignoreWorkspaceCycles: entry("ignoreWorkspaceCycles", {
		schema: Bool,
		kind: "boolean",
		description:
			"Suppress the report a recursive install makes when the selected workspace projects depend on each other in a cycle.",
		locations: ["workspace", "global", "env"],
	}),
	ignoreWorkspaceRootCheck: entry("ignoreWorkspaceRootCheck", {
		schema: Bool,
		kind: "boolean",
		description: "Let `pnpm add` modify a multi-package workspace root without `-w`.",
		locations: ["workspace", "env"],
	}),
	includeWorkspaceRoot: entry("includeWorkspaceRoot", {
		schema: Bool,
		kind: "boolean",
		description: "Whether a recursive command also runs on the workspace root project.",
		locations: ["workspace", "global", "env"],
	}),
	injectWorkspacePackages: entry("injectWorkspacePackages", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, workspace-package resolutions materialize as `file:` (hard-linked copies into the virtual store) instead of `link:` symlinks back to the source.",
		locations: ["workspace", "env"],
	}),
	legacyDirFiltering: entry("legacyDirFiltering", {
		schema: Bool,
		kind: "boolean",
		description: "Match a `{<dir>}` filter selector by directory subtree instead of by glob.",
		locations: ["workspace", "env"],
	}),
	linkWorkspacePackages: entry("linkWorkspacePackages", {
		schema: Schema.Union([Bool, Schema.Literal("deep")]),
		kind: "union",
		description:
			"Whether a bare version range resolves to a matching workspace package: `true`, `false`, or `deep` to link in dependencies of dependencies too.",
		locations: ["workspace", "env"],
	}),
	packageConfigs: entry("packageConfigs", {
		schema: Schema.Union([UnknownRecord, Schema.Array(UnknownRecord)]),
		kind: "union",
		description:
			"Settings that apply to one project of the workspace instead of all of them, as a map keyed by project name or a list of entries that select projects.",
		locations: ["workspace"],
	}),
	packages: entry("packages", {
		schema: StringArray,
		kind: "stringArray",
		description: "The glob patterns that select the workspace's projects.",
		locations: ["workspace"],
	}),
	preferWorkspacePackages: entry("preferWorkspacePackages", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, prefer a workspace package over a registry pick even when the registry version is newer than the workspace one.",
		locations: ["workspace", "env"],
	}),
	saveCatalogName: entry("saveCatalogName", {
		schema: Str,
		kind: "string",
		description:
			"Name of the catalog `pnpm add` saves a new dependency into, set by `--save-catalog-name=<name>` (with `--save-catalog` a shorthand for `default`).",
		locations: ["workspace", "env"],
	}),
	saveWorkspaceProtocol: entry("saveWorkspaceProtocol", {
		schema: Schema.Union([Bool, Schema.Literal("rolling")]),
		kind: "union",
		description:
			"How `pnpm add` and `pnpm update` write a dependency linked to a workspace package: `true` saves `workspace:` with the range, `false` saves the range alone, `rolling` saves `workspace:^`/`workspace:~`.",
		locations: ["workspace", "env"],
	}),
	sharedWorkspaceLockfile: entry("sharedWorkspaceLockfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"Whether the workspace uses a single root `pnpm-lock.yaml`. The `sharedWorkspaceLockfile` setting; default `true`.",
		locations: ["workspace", "env"],
		default: true,
	}),
	syncInjectedDepsAfterScripts: entry("syncInjectedDepsAfterScripts", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"The scripts after which pnpm re-syncs injected workspace dependencies into the projects that inject them.",
		locations: ["workspace", "env"],
	}),
	testPattern: entry("testPattern", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"Glob patterns of test files: a project whose only changes match them is selected by `--filter` with `...` but not rebuilt.",
		locations: ["workspace", "env"],
	}),
	workspaceConcurrency: entry("workspaceConcurrency", {
		schema: Integer,
		kind: "number",
		description:
			"How many projects a recursive command processes at once; a zero or negative value is subtracted from the available parallelism.",
		locations: ["workspace", "global", "env"],
	}),
} as const;
