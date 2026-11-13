import { Schema } from "effect";
import { Bool, Str, StringArray, Unsigned, closed, entry } from "./schemas.js";

/** The store and lockfile settings (`docs/settings/store.md`). */
export const store = {
	excludeLinksFromLockfile: entry("excludeLinksFromLockfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, dependencies declared with the `link:` protocol are left out of `pnpm-lock.yaml`.",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/store#excludelinksfromlockfile",
	}),
	forceLegacyDeploy: entry("forceLegacyDeploy", {
		schema: Bool,
		kind: "boolean",
		description:
			"Force `pnpm deploy` to use the legacy install-based implementation even when a shared workspace lockfile is available.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	frozenLockfile: entry("frozenLockfile", {
		schema: Bool,
		kind: "boolean",
		description: "When set to `true`, pnpm fails the installation if the lockfile needs updating or is missing.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/store#frozenlockfile",
	}),
	frozenStore: entry("frozenStore", {
		schema: Bool,
		kind: "boolean",
		description:
			"Lets `pnpm install` run against a package store that lives on a read-only filesystem, for example a Nix store, a read-only bind mount, or an OCI image layer.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/store#frozenstore",
	}),
	gitBranchLockfile: entry("gitBranchLockfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, the generated lockfile name after installation will be named based on the current branch name to completely avoid merge conflicts.",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/store#gitbranchlockfile",
	}),
	lockfile: entry("lockfile", {
		schema: Schema.Union([
			Bool,
			closed({
				includeResolutionSettings: Schema.optionalKey(Bool),
				integrityTarget: Schema.optionalKey(Schema.Literals(["resource", "tar"])),
				format: Schema.optionalKey(Schema.Literals(["v9", "v13"])),
			}),
		]),
		kind: "union",
		description:
			"When `false`, pnpm neither reads nor writes `pnpm-lock.yaml`. The object form keeps the lockfile and sets its `format`, `integrityTarget` and `includeResolutionSettings`.",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/store#lockfile",
	}),
	lockfileDir: entry("lockfileDir", {
		schema: Str,
		kind: "string",
		description: "The directory in which `pnpm-lock.yaml` is created. Several projects may share a single lockfile.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
		anchor: "settings/store#lockfiledir",
	}),
	lockfileIncludeTarballUrl: entry("lockfileIncludeTarballUrl", {
		schema: Bool,
		kind: "boolean",
		description: "Add the full URL to the package's tarball to every entry in `pnpm-lock.yaml`.",
		locations: ["workspace", "env"],
		envFormat: "json",
		default: false,
		anchor: "settings/store#lockfileincludetarballurl",
	}),
	mergeGitBranchLockfiles: entry("mergeGitBranchLockfiles", {
		schema: Bool,
		kind: "boolean",
		description:
			"Fold every `pnpm-lock.<branch>.yaml` into `pnpm-lock.yaml` and delete them, which is what a branch's merge back into the mainline needs.",
		locations: ["workspace", "env"],
		envFormat: "json",
	}),
	mergeGitBranchLockfilesBranchPattern: entry("mergeGitBranchLockfilesBranchPattern", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"This configuration matches the current branch name to determine whether to merge all git branch lockfile files.",
		locations: ["workspace", "env"],
		envFormat: "json",
		anchor: "settings/store#mergegitbranchlockfilesbranchpattern",
	}),
	peersSuffixMaxLength: entry("peersSuffixMaxLength", {
		schema: Unsigned,
		kind: "number",
		description: "Max length of the peer IDs suffix added to dependency keys in the lockfile.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: 1000,
		anchor: "settings/store#peerssuffixmaxlength",
	}),
	preferFrozenLockfile: entry("preferFrozenLockfile", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true` and the available `pnpm-lock.yaml` satisfies the `package.json` dependencies directive, a headless installation is performed.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/store#preferfrozenlockfile",
	}),
	storeDir: entry("storeDir", {
		schema: Str,
		kind: "string",
		description: "The location where all the packages are saved on the disk.",
		locations: ["workspace", "global", "env"],
		envFormat: "text",
		anchor: "settings/store#storedir",
	}),
	storeIndexFormat: entry("storeIndexFormat", {
		schema: Schema.Literals(["sqlite", "files"]),
		kind: "enum",
		description: "How the store records which files each package has.",
		locations: ["workspace", "global", "env"],
		envFormat: "jsonOrText",
		default: "sqlite",
		anchor: "settings/store#storeindexformat",
	}),
	strictStorePkgContentCheck: entry("strictStorePkgContentCheck", {
		schema: Bool,
		kind: "boolean",
		description:
			"Some registries allow the exact same content to be published under different package names and/or versions.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/store#strictstorepkgcontentcheck",
	}),
	symlinkedLockfileTargetDirs: entry("symlinkedLockfileTargetDirs", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"When `pnpm-lock.yaml` is a symlink, pnpm reads it through the link but refuses to write changes to it.",
		locations: ["global", "env"],
		envFormat: "json",
		anchor: "settings/store#symlinkedlockfiletargetdirs",
	}),
	verifyStoreIntegrity: entry("verifyStoreIntegrity", {
		schema: Bool,
		kind: "boolean",
		description:
			"By default, if a file in the store has been modified, the content of this file is checked before linking it to a project's `node_modules`.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
		default: true,
		anchor: "settings/store#verifystoreintegrity",
	}),
} as const;
