import { Schema } from "effect";
import { Bool, Integer, Str, StringArray, StringRecord, closed, entry } from "./schemas.js";

/** An `allowBuilds`-style decision: `true`/`false`, or a string pnpm leaves undecided. */
const BuildDecision = Schema.Union([Schema.Boolean, Schema.String]);

const Permissions = Schema.Record(
	Schema.String,
	Schema.Struct({
		build: Schema.optionalKey(BuildDecision),
		skills: Schema.optionalKey(Schema.Union([Schema.Boolean, StringArray])),
	}),
);

const RemoteCache = closed({
	url: Schema.optionalKey(Str),
	team: Schema.optionalKey(Str),
	org: Schema.optionalKey(Str),
	trustedKeys: Schema.optionalKey(StringRecord),
	privateKey: Schema.optionalKey(Str),
	keyId: Schema.optionalKey(Str),
	builderId: Schema.optionalKey(Str),
	publish: Schema.optionalKey(Bool),
	imageDigest: Schema.optionalKey(Str),
	architectureBaseline: Schema.optionalKey(Str),
	buildEnv: Schema.optionalKey(StringRecord),
});

const RemoteSideEffectsCache = closed({
	org: Schema.optionalKey(Str),
	organization: Schema.optionalKey(Str),
	packages: Schema.optionalKey(StringArray),
	publish: Schema.optionalKey(Bool),
	keyId: Schema.optionalKey(Str),
	builderId: Schema.optionalKey(Str),
	imageDigest: Schema.optionalKey(Str),
	architectureBaseline: Schema.optionalKey(Str),
	buildEnv: Schema.optionalKey(StringRecord),
	trustedKeys: Schema.optionalKey(StringRecord),
	privateKey: Schema.optionalKey(Str),
});

const SideEffectsCacheSettings = Schema.Struct({
	read: Schema.optionalKey(Bool),
	write: Schema.optionalKey(Bool),
	remote: Schema.optionalKey(RemoteSideEffectsCache),
	exclude: Schema.optionalKey(StringArray),
});

/** The build, scripts and patch settings (`docs/settings/build.md`). */
export const build = {
	allowBuilds: entry("allowBuilds", {
		schema: Schema.Record(Schema.String, Schema.Union([Schema.Boolean, Schema.String])),
		kind: "booleanRecord",
		description:
			"Packages whose build scripts are allowed (`true`) or refused (`false`), keyed by package name or `name@version`; any other value leaves the package undecided.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/build#allowbuilds",
	}),
	allowUnusedPatches: entry("allowUnusedPatches", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, configured patches that don't match any installed dependency produce a warning instead of failing the install with `ERR_PNPM_UNUSED_PATCH`.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	childConcurrency: entry("childConcurrency", {
		schema: Integer,
		kind: "number",
		description: "The maximum number of child processes to allocate simultaneously to build node_modules.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: 5,
		anchor: "settings/build#childconcurrency",
	}),
	dangerouslyAllowAllBuilds: entry("dangerouslyAllowAllBuilds", {
		schema: Bool,
		kind: "boolean",
		description:
			"If set to `true`, all build scripts (e.g. `preinstall`, `install`, `postinstall`) from dependencies will run automatically, without requiring approval.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/build#dangerouslyallowallbuilds",
	}),
	globalPnpmfile: entry("globalPnpmfile", {
		schema: Str,
		kind: "string",
		description:
			"Loaded ahead of every project pnpmfile and left out of `pnpmfileChecksum`, matching the entry pnpm's `requireHooks` pushes first with `includeInChecksum: false`.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
	}),
	ignorePnpmfile: entry("ignorePnpmfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, no pnpmfile hooks run: neither the pnpmfiles the project configures or ships nor those of config-dependency plugins are loaded, so `readPackage`, `updateConfig`, `afterAllResolved`, custom resolvers and custom fetchers are all skipped.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	ignoreScripts: entry("ignoreScripts", {
		schema: Bool,
		kind: "boolean",
		description: "Do not execute any scripts defined in the project `package.json` and its dependencies.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/build#ignorescripts",
	}),
	nodeOptions: entry("nodeOptions", {
		schema: Schema.NullOr(Str),
		kind: "string",
		description: "Options to pass through to Node.js via the `NODE_OPTIONS` environment variable.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
		anchor: "settings/build#nodeoptions",
	}),
	patchedDependencies: entry("patchedDependencies", {
		schema: StringRecord,
		kind: "stringRecord",
		description:
			"Patches to apply to dependencies: keys are `name` or `name@version`, values are patch file paths, relative to the workspace root or absolute.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	patchesDir: entry("patchesDir", {
		schema: Str,
		kind: "string",
		description: "The directory `pnpm patch-commit` writes generated patch files to; `patches` when unset.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
	}),
	permissions: entry("permissions", {
		schema: Permissions,
		kind: "unknownRecord",
		description:
			"What each dependency may do, keyed like `allowBuilds`: whether it may run its build (`build`) and which agent skills it may link (`skills`).",
		locations: ["workspace"],
		anchor: "settings/build#permissions",
	}),
	pnpmfile: entry("pnpmfile", {
		schema: Schema.Union([Str, StringArray]),
		kind: "union",
		description:
			"Explicit pnpmfiles resolved against the workspace root. `None` discovers the default `.pnpmfile.mjs` or `.pnpmfile.cjs`.",
		locations: ["workspace", "env"],
		envFormat: "jsonOrText",
	}),
	remoteCache: entry("remoteCache", {
		schema: RemoteCache,
		kind: "object",
		description:
			"The server that shares build output between machines, and the keys every shared artifact is signed and verified with.",
		locations: ["workspace", "global"],
		anchor: "settings/build#remotecache",
	}),
	remoteSideEffectsCache: entry("remoteSideEffectsCache", {
		schema: RemoteSideEffectsCache,
		kind: "object",
		description:
			"The older spelling of the shared remote build cache that `sideEffectsCache.remote` and `remoteCache` now carry: the organization, the packages it covers and the signing keys.",
		locations: ["workspace", "global"],
	}),
	sideEffectsCache: entry("sideEffectsCache", {
		schema: Schema.Union([Bool, SideEffectsCacheSettings]),
		kind: "union",
		description:
			"Use and cache the results of (pre/post)install hooks. A boolean sets reading and writing together; the object form sets `read`, `write`, a `remote` cache and the packages to `exclude`.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/build#sideeffectscache",
	}),
	sideEffectsCacheReadonly: entry("sideEffectsCacheReadonly", {
		schema: Bool,
		kind: "boolean",
		description: "Only use the side effects cache if present, do not create it for new packages.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/build#sideeffectscachereadonly",
	}),
	skills: entry("skills", {
		schema: Schema.Struct({ dirs: Schema.optionalKey(StringArray) }),
		kind: "object",
		description: "The directories, relative to the workspace root, that pnpm links approved agent skills into.",
		locations: ["workspace", "global"],
		anchor: "settings/build#skillsdirs",
	}),
	strictDepBuilds: entry("strictDepBuilds", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `strictDepBuilds` is enabled, the installation will exit with a non-zero exit code if any dependencies have unreviewed build scripts (aka postinstall scripts).",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/build#strictdepbuilds",
	}),
	unsafePerm: entry("unsafePerm", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `false`, lifecycle scripts run with `TMPDIR` set to the package's `node_modules/.tmp` directory.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/build#unsafeperm",
	}),
	verifyDepsBeforeRun: entry("verifyDepsBeforeRun", {
		schema: Schema.Union([Schema.Literals(["install", "warn", "error", "prompt", "true", "false"]), Schema.Boolean]),
		kind: "union",
		description:
			"Whether `pnpm run` and `pnpm exec` check the state of dependencies first, and what they do when it is stale: `install`, `warn`, `error`, `prompt`, `true` (check only) or `false`.",
		locations: ["workspace", "global", "env"],
		envFormat: "flag",
		default: "install",
		anchor: "settings/build#verifydepsbeforerun",
	}),
} as const;
