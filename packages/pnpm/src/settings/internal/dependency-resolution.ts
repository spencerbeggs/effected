import { OverrideKey } from "@effected/pnpm";
import { Result, Schema } from "effect";
import { Bool, Str, StringArray, StringRecord, UnknownRecord, Unsigned, entry } from "./schemas.js";

const AuditLevel = Schema.Literals(["info", "low", "moderate", "high", "critical"]);

/**
 * The `overrides` map: every key a selector `OverrideKey` parses, every value a
 * string. Checked over the whole record: a `Record` key schema drops a key that
 * fails it instead of reporting it.
 */
const Overrides = StringRecord.check(
	Schema.makeFilter((record) => {
		for (const key of Object.keys(record)) {
			const parsed = OverrideKey.parseResult(key);
			if (Result.isFailure(parsed)) return parsed.failure.message;
		}
		return true;
	}),
);

const PackageExtension = Schema.Struct({
	dependencies: Schema.optionalKey(StringRecord),
	optionalDependencies: Schema.optionalKey(StringRecord),
	peerDependencies: Schema.optionalKey(StringRecord),
	peerDependenciesMeta: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Bool) })),
	),
});

/** The dependency-resolution settings (`docs/settings/dependency-resolution.md`), with the audit and update sections. */
export const dependencyResolution = {
	allowedDeprecatedVersions: entry("allowedDeprecatedVersions", {
		schema: StringRecord,
		kind: "stringRecord",
		description: "This setting allows muting deprecation warnings of specific packages.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#alloweddeprecatedversions",
	}),
	audit: entry("audit", {
		schema: Schema.Struct({
			level: Schema.optionalKey(AuditLevel),
			ignore: Schema.optionalKey(StringArray),
			ignorePrune: Schema.optionalKey(Bool),
		}),
		kind: "object",
		description:
			"The `pnpm audit` section: the minimum `level` to report, the advisories to `ignore`, and whether to prune stale ignores. It supersedes `auditLevel` and `auditConfig`.",
		locations: ["workspace", "global"],
	}),
	auditConfig: entry("auditConfig", {
		schema: Schema.Struct({ ignoreGhsas: Schema.optionalKey(StringArray) }),
		kind: "object",
		description:
			"The deprecated spelling of `audit.ignore`: the GitHub advisory IDs (`ignoreGhsas`) `pnpm audit` ignores.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	auditLevel: entry("auditLevel", {
		schema: AuditLevel,
		kind: "enum",
		description: "The deprecated spelling of `audit.level`: the lowest advisory severity `pnpm audit` reports.",
		locations: ["workspace", "global", "env"],
		envFormat: "jsonOrText",
	}),
	autoDedupe: entry("autoDedupe", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, `pnpm install` and `pnpm add` deduplicate compatible dependency versions during installation.",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/dependency-resolution#autodedupe",
	}),
	blockExoticSubdeps: entry("blockExoticSubdeps", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, only direct dependencies (those listed in your root `package.json`) may use exotic sources (like git repositories or direct tarball URLs).",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/dependency-resolution#blockexoticsubdeps",
	}),
	forceIgnoresPlatform: entry("forceIgnoresPlatform", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, `pnpm install --force` also installs optional dependencies whose `os`, `cpu`, or `libc` do not match the host.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/dependency-resolution#forceignoresplatform",
	}),
	ignoredOptionalDependencies: entry("ignoredOptionalDependencies", {
		schema: StringArray,
		kind: "stringArray",
		description:
			'Deprecated: use `overrides` with `:optional` and `"-"` instead (for example, `"fsevents:optional": "-"` and `"@esbuild/*:optional": "-"`).',
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#ignoredoptionaldependencies",
	}),
	minimumReleaseAge: entry("minimumReleaseAge", {
		schema: Unsigned,
		kind: "number",
		description:
			"To reduce the risk of installing compromised or defective packages, you can delay the installation of newly published versions.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: 1440,
		anchor: "settings/dependency-resolution#minimumreleaseage",
	}),
	minimumReleaseAgeExclude: entry("minimumReleaseAgeExclude", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"If you set `minimumReleaseAge` but need certain dependencies to always install the newest version immediately, you can list them under `minimumReleaseAgeExclude`.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#minimumreleaseageexclude",
	}),
	minimumReleaseAgeExcludePrune: entry("minimumReleaseAgeExcludePrune", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, `pnpm install`, `pnpm add`, `pnpm update`, `pnpm remove`, and `pnpm dedupe` prune the entries of `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` that the freshly written lockfile no longer resolves: a version that is gone is dropped (an entry is removed once none of its versions remain), and an entry for a package that is no longer in the lockfile is removed too.",
		locations: ["workspace", "global"],
		default: false,
		anchor: "settings/dependency-resolution#minimumreleaseageexcludeprune",
	}),
	minimumReleaseAgeIgnoreMissingTime: entry("minimumReleaseAgeIgnoreMissingTime", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, pnpm skips the `minimumReleaseAge` check for a package whose registry metadata does not include the `time` field (some private registries and mirrors omit it).",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/dependency-resolution#minimumreleaseageignoremissingtime",
	}),
	minimumReleaseAgeStrict: entry("minimumReleaseAgeStrict", {
		schema: Bool,
		kind: "boolean",
		description:
			"Controls how pnpm behaves when no version of a dependency satisfies the `minimumReleaseAge` constraint within the requested range.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/dependency-resolution#minimumreleaseagestrict",
	}),
	namedRegistries: entry("namedRegistries", {
		schema: StringRecord,
		kind: "stringRecord",
		description: "Deprecated: declare a `prefix` in `registries` instead. See the Registries page.",
		locations: ["workspace", "global"],
		anchor: "settings/dependency-resolution#namedregistries",
	}),
	offline: entry("offline", {
		schema: Bool,
		kind: "boolean",
		description:
			"Refuse network requests during install. The `offline` flag gates the metadata-fetch path with `ERR_PNPM_NO_OFFLINE_META` when no cached metadata exists for a spec.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	optional: entry("optional", {
		schema: Bool,
		kind: "boolean",
		description:
			"Set to `false` to skip optional dependencies during installation, including transitive optional dependencies.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/dependency-resolution#optional",
	}),
	overrides: entry("overrides", {
		schema: Overrides,
		kind: "stringRecord",
		description:
			"This field allows you to instruct pnpm to override any dependency in the dependency graph, including peer dependencies.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#overrides",
	}),
	packageExtensions: entry("packageExtensions", {
		schema: Schema.Record(Schema.String, PackageExtension),
		kind: "unknownRecord",
		description:
			"The `packageExtensions` fields offer a way to extend the existing package definitions with additional information.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#packageextensions",
	}),
	pnprServer: entry("pnprServer", {
		schema: Str,
		kind: "string",
		description: "The URL of a pnpr server to accelerate installs through.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
		anchor: "settings/dependency-resolution#pnprserver",
	}),
	preferOffline: entry("preferOffline", {
		schema: Bool,
		kind: "boolean",
		description: "Prefer the local store on read, fall back to the network on a cache miss.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	registries: entry("registries", {
		schema: Schema.Record(Schema.String, Schema.Union([Str, UnknownRecord])),
		kind: "unknownRecord",
		description:
			"Declares the registries the project installs from, keyed by registry URL, each entry routing scopes and a bare-specifier prefix to it. A map of plain strings is the older `<scope>: <url>` shape.",
		locations: ["workspace", "global"],
		anchor: "settings/dependency-resolution#registries",
	}),
	supportedArchitectures: entry("supportedArchitectures", {
		schema: Schema.Struct({
			os: Schema.optionalKey(StringArray),
			cpu: Schema.optionalKey(StringArray),
			libc: Schema.optionalKey(StringArray),
		}),
		kind: "object",
		description:
			"You can specify architectures for which you'd like to install optional dependencies, even if they don't match the architecture of the system running the install.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#supportedarchitectures",
	}),
	trustLockfile: entry("trustLockfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, `pnpm install` skips the supply-chain verification pass that re-applies `minimumReleaseAge` and `trustPolicy` to every entry in the loaded lockfile.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/dependency-resolution#trustlockfile",
	}),
	trustPolicy: entry("trustPolicy", {
		schema: Schema.Literals(["no-downgrade", "off"]),
		kind: "enum",
		description:
			"When set to `no-downgrade`, pnpm will fail if a package's trust level has decreased compared to previous releases.",
		locations: ["workspace", "global", "env"],
		envFormat: "jsonOrText",
		default: "off",
		anchor: "settings/dependency-resolution#trustpolicy",
	}),
	trustPolicyExclude: entry("trustPolicyExclude", {
		schema: StringArray,
		kind: "stringArray",
		description: "A list of package selectors that should be excluded from the trust policy check.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#trustpolicyexclude",
	}),
	trustPolicyExcludePrune: entry("trustPolicyExcludePrune", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, `pnpm install`, `pnpm add`, `pnpm update`, `pnpm remove`, and `pnpm dedupe` prune the entries of `trustPolicyExclude` in `pnpm-workspace.yaml` that the freshly written lockfile no longer resolves: a version that is gone is dropped (an entry is removed once none of its versions remain), and an entry for a package that is no longer in the lockfile is removed too.",
		locations: ["workspace", "global"],
		default: false,
		anchor: "settings/dependency-resolution#trustpolicyexcludeprune",
	}),
	trustPolicyIgnoreAfter: entry("trustPolicyIgnoreAfter", {
		schema: Unsigned,
		kind: "number",
		description:
			"Allows ignoring the trust policy check for packages published more than the specified number of minutes ago.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		anchor: "settings/dependency-resolution#trustpolicyignoreafter",
	}),
	update: entry("update", {
		schema: Schema.Struct({
			ignoreDeps: Schema.optionalKey(StringArray),
			changeset: Schema.optionalKey(Bool),
			githubActions: Schema.optionalKey(Bool),
			githubActionsServer: Schema.optionalKey(Str),
		}),
		kind: "object",
		description: "Settings in this section tune the `pnpm update` and `pnpm outdated` commands.",
		locations: ["workspace", "global"],
		anchor: "settings/dependency-resolution#update",
	}),
	updateConfig: entry("updateConfig", {
		schema: Schema.Struct({
			ignoreDependencies: Schema.optionalKey(StringArray),
			changeset: Schema.optionalKey(Bool),
			githubActions: Schema.optionalKey(Bool),
			githubActionsServer: Schema.optionalKey(Str),
		}),
		kind: "object",
		description:
			"The deprecated spelling of `update`: the dependency patterns `pnpm update` skips (`ignoreDependencies`), whether it writes a change intent, and whether it updates GitHub Actions.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
} as const;
