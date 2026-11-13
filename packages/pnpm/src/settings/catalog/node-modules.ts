import { Schema } from "effect";
import { Bool, Str, StringArray, Unsigned, closed, entry } from "./schemas.js";

const NodePackageMapType = Schema.Literals(["standard", "loose"]);

/** The `node_modules` and hoisting settings (`docs/settings/node-modules.md`). */
export const nodeModules = {
	dlxCacheMaxAge: entry("dlxCacheMaxAge", {
		schema: Unsigned,
		kind: "number",
		description:
			"The time in minutes after which dlx cache expires. After executing a dlx command, pnpm keeps a cache that omits the installation step for subsequent calls to the same dlx command.",
		locations: ["workspace", "global", "env"],
		default: 1440,
		anchor: "settings/node-modules#dlxcachemaxage",
	}),
	enableGlobalVirtualStore: entry("enableGlobalVirtualStore", {
		schema: Bool,
		kind: "boolean",
		description:
			"The boolean spelling of `virtualStoreType`: `true` is `virtualStoreType: global`. `virtualStoreType` wins when a project sets both.",
		locations: ["workspace", "global", "env"],
		default: false,
		anchor: "settings/node-modules#enableglobalvirtualstore",
	}),
	enableModulesDir: entry("enableModulesDir", {
		schema: Bool,
		kind: "boolean",
		description: "When `false`, pnpm will not write any files to the modules directory (`node_modules`).",
		locations: ["workspace", "global", "env"],
		default: true,
		anchor: "settings/node-modules#enablemodulesdir",
	}),
	externalDependencies: entry("externalDependencies", {
		schema: StringArray,
		kind: "stringArray",
		description: "Names of dependencies that another tool links into the root `node_modules`.",
		locations: ["workspace", "env"],
		anchor: "settings/node-modules#externaldependencies",
	}),
	globalVirtualStoreDir: entry("globalVirtualStoreDir", {
		schema: Str,
		kind: "string",
		description: "The location of the global virtual store. It takes precedence over `virtualStoreDir`.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#globalvirtualstoredir",
	}),
	hoist: entry("hoist", {
		schema: Bool,
		kind: "boolean",
		description: "When `true`, all dependencies are hoisted to `node_modules/.pnpm/node_modules`.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/node-modules#hoist",
	}),
	hoistingLimits: entry("hoistingLimits", {
		schema: Schema.Literals(["none", "workspaces", "dependencies"]),
		kind: "enum",
		description: "Controls how far dependencies are hoisted when using `nodeLinker: hoisted`.",
		locations: ["workspace", "env"],
		default: "none",
		anchor: "settings/node-modules#hoistinglimits",
	}),
	hoistPattern: entry("hoistPattern", {
		schema: Schema.NullOr(StringArray),
		kind: "stringArray",
		description: "Tells pnpm which packages should be hoisted to `node_modules/.pnpm/node_modules`.",
		locations: ["workspace", "env"],
		anchor: "settings/node-modules#hoistpattern",
	}),
	hoistWorkspacePackages: entry("hoistWorkspacePackages", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, the projects of the workspace are hoisting candidates too, not only the packages that come from a registry.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/node-modules#hoistworkspacepackages",
	}),
	modulesCacheMaxAge: entry("modulesCacheMaxAge", {
		schema: Unsigned,
		kind: "number",
		description: "The time in minutes after which orphan packages from the modules directory should be removed.",
		locations: ["workspace", "global", "env"],
		default: 10080,
		anchor: "settings/node-modules#modulescachemaxage",
	}),
	modulesDir: entry("modulesDir", {
		schema: Str,
		kind: "string",
		description: "The directory in which dependencies will be installed (instead of `node_modules`).",
		locations: ["workspace", "env"],
		anchor: "settings/node-modules#modulesdir",
	}),
	nodeExperimentalPackageMap: entry("nodeExperimentalPackageMap", {
		schema: Bool,
		kind: "boolean",
		description:
			"Deprecated: use `nodePackageMap.mode`. `true` is `mode: load` and `false` is `mode: off`; `nodePackageMap` wins when both are set in one place.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#nodeexperimentalpackagemap",
	}),
	nodeLinker: entry("nodeLinker", {
		schema: Schema.Union([
			Schema.Literals(["isolated", "hoisted", "pnp", "loaded"]),
			closed({ type: Schema.Literal("loaded"), excluded: Schema.optionalKey(StringArray) }),
		]),
		kind: "union",
		description:
			"Defines what linker installs Node packages: `isolated`, `hoisted`, `pnp`, `loaded`, or the loaded-linker object `{ type: loaded, excluded }`.",
		locations: ["workspace", "env"],
		default: "isolated",
		anchor: "settings/node-modules#nodelinker",
	}),
	nodePackageMap: entry("nodePackageMap", {
		schema: Schema.Struct({
			mode: Schema.optionalKey(Schema.Literals(["off", "write-only", "load"])),
			type: Schema.optionalKey(NodePackageMapType),
		}),
		kind: "object",
		description: "Controls `node_modules/.package-map.json`, which pnpm writes during isolated and hoisted installs.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#nodepackagemapmode",
	}),
	nodePackageMapType: entry("nodePackageMapType", {
		schema: NodePackageMapType,
		kind: "enum",
		description: "Deprecated: use `nodePackageMap.type`. `nodePackageMap` wins when both are set in one place.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#nodepackagemaptype-1",
	}),
	packageImportMethod: entry("packageImportMethod", {
		schema: Schema.Literals(["auto", "hardlink", "copy", "clone", "clone-or-copy"]),
		kind: "enum",
		description:
			"Controls the way packages are imported from the store (if you want to disable symlinks inside `node_modules`, then you need to change the [nodeLinker] setting, not this one).",
		locations: ["workspace", "global", "env"],
		default: "auto",
		anchor: "settings/node-modules#packageimportmethod",
	}),
	publicHoistPattern: entry("publicHoistPattern", {
		schema: Schema.NullOr(StringArray),
		kind: "stringArray",
		description:
			"Unlike `hoistPattern`, which hoists dependencies to a hidden modules directory inside the virtual store, `publicHoistPattern` hoists dependencies matching the pattern to the root modules directory.",
		locations: ["workspace", "env"],
		anchor: "settings/node-modules#publichoistpattern",
	}),
	shamefullyHoist: entry("shamefullyHoist", {
		schema: Bool,
		kind: "boolean",
		description:
			"By default, pnpm creates a semistrict `node_modules`, meaning dependencies have access to undeclared dependencies but modules outside of `node_modules` do not.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/node-modules#shamefullyhoist",
	}),
	symlink: entry("symlink", {
		schema: Bool,
		kind: "boolean",
		description: "When `symlink` is set to `false`, pnpm creates a virtual store directory without any symlinks.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/node-modules#symlink",
	}),
	virtualStoreDir: entry("virtualStoreDir", {
		schema: Str,
		kind: "string",
		description:
			"The directory with links to the store. All direct and indirect dependencies of the project are linked into this directory.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#virtualstoredir",
	}),
	virtualStoreDirMaxLength: entry("virtualStoreDirMaxLength", {
		schema: Unsigned,
		kind: "number",
		description:
			"Sets the maximum allowed length of directory names inside the virtual store directory (`node_modules/.pnpm`).",
		locations: ["workspace", "global", "env"],
		anchor: "settings/node-modules#virtualstoredirmaxlength",
	}),
	virtualStoreOnly: entry("virtualStoreOnly", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, pnpm populates the virtual store without creating importer symlinks, hoisting, bin links, or running lifecycle scripts.",
		locations: ["workspace", "global", "env"],
		default: false,
		anchor: "settings/node-modules#virtualstoreonly",
	}),
	virtualStoreType: entry("virtualStoreType", {
		schema: Schema.Literals(["global", "project"]),
		kind: "enum",
		description: "Names where the virtual store lives: one store per project, or one store per machine.",
		locations: ["workspace", "global", "env"],
		default: "project",
		anchor: "settings/node-modules#virtualstoretype",
	}),
} as const;
