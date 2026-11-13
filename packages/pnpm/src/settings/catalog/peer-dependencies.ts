import { PeerDependencyRules } from "@effected/pnpm";
import { Bool, entry } from "./schemas.js";

/** The peer-dependency settings (`docs/settings/peer-dependencies.md`). */
export const peerDependencies = {
	addMissingPeerTypes: entry("addMissingPeerTypes", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, every peer dependency of a dependency also makes the matching `@types` package an optional peer of it.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/peer-dependencies#addmissingpeertypes",
	}),
	autoInstallPeers: entry("autoInstallPeers", {
		schema: Bool,
		kind: "boolean",
		description: "When `true`, any missing non-optional peer dependencies are automatically installed.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/peer-dependencies#autoinstallpeers",
	}),
	autoInstallPeersFromHighestMatch: entry("autoInstallPeersFromHighestMatch", {
		schema: Bool,
		kind: "boolean",
		description:
			"When set to `true`, pnpm joins conflicting peer dependency ranges with `||` and installs the highest version that satisfies any of them.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/peer-dependencies#autoinstallpeersfromhighestmatch",
	}),
	dedupePeerDependents: entry("dedupePeerDependents", {
		schema: Bool,
		kind: "boolean",
		description:
			"When this setting is set to `true`, packages with peer dependencies will be deduplicated after peers resolution.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/peer-dependencies#dedupepeerdependents",
	}),
	dedupePeers: entry("dedupePeers", {
		schema: Bool,
		kind: "boolean",
		description:
			"When enabled, peer dependency suffixes use version-only identifiers (`name@version`) instead of full dep paths, eliminating nested suffixes like `(foo@1.0.0(bar@2.0.0))`.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/peer-dependencies#dedupepeers",
	}),
	peerDependencyRules: entry("peerDependencyRules", {
		schema: PeerDependencyRules,
		kind: "object",
		description:
			"Deprecated: `peerDependencyRules` only suppresses peer dependency warnings after resolution without changing `peerDependencies`.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/peer-dependencies#peerdependencyrules",
	}),
	projectScopedOptionalPeers: entry("projectScopedOptionalPeers", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `true`, a project gets a missing optional peer dependency only if the project's own dependencies already install a version of it.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/peer-dependencies#projectscopedoptionalpeers",
	}),
	resolvePeersFromWorkspaceRoot: entry("resolvePeersFromWorkspaceRoot", {
		schema: Bool,
		kind: "boolean",
		description:
			"When enabled, dependencies of the root workspace project are used to resolve peer dependencies of any projects in the workspace.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/peer-dependencies#resolvepeersfromworkspaceroot",
	}),
	strictPeerDependencies: entry("strictPeerDependencies", {
		schema: Bool,
		kind: "boolean",
		description: "If this is enabled, commands will fail if there is a missing or invalid peer dependency in the tree.",
		locations: ["workspace", "env"],
		default: false,
		anchor: "settings/peer-dependencies#strictpeerdependencies",
	}),
} as const;
