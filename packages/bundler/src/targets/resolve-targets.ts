import { ConfigValidationError } from "../errors.js";
import type {
	PublishTargetObject,
	PublishTargetValue,
	PublishTargets,
	ReleaseChannel,
	ResolvedTarget,
	TargetResolution,
} from "./config.js";
import { RELEASE_CHANNELS, isTargetObject } from "./config.js";

/** Default registry endpoints for the well-known target keys. */
const DEFAULT_REGISTRIES: Record<string, string> = {
	npm: "https://registry.npmjs.org",
	github: "https://npm.pkg.github.com",
};

/**
 * Resolve a `publishConfig.targets` map into the distinct groups to build and every target bound to one. Pure; throws ConfigValidationError on structurally-invalid config.
 *
 * @public
 */
export function resolveTargets(options: { targets: PublishTargets; baseName: string }): TargetResolution {
	const { targets, baseName } = options;
	const ids = Object.keys(targets);
	if (ids.length === 0)
		throw new ConfigValidationError({
			path: "publishConfig.targets",
			reason: "publishConfig.targets must declare at least one target",
		});

	// All `true` targets collapse into one canonical base-name group, foldered "npm" if present else the first true id.
	const trueIds = ids.filter((id) => targets[id] === true);
	const canonicalId = trueIds.includes("npm") ? "npm" : trueIds[0];

	const registryFor = (id: string, explicit: string | undefined): string => {
		const registry = explicit ?? DEFAULT_REGISTRIES[id];
		if (registry === undefined) {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}`,
				reason: `Target "${id}" has no registry; custom targets must set { registry }`,
			});
		}
		return registry;
	};

	// The per-target publish options: `releases` is always resolved (default "all"), `provenance` only when declared.
	const optionsFor = (id: string, value: PublishTargetValue): { releases: ReleaseChannel; provenance?: boolean } => {
		if (!isTargetObject(value)) return { releases: "all" };
		const { releases, provenance } = value;
		if (releases !== undefined && !RELEASE_CHANNELS.includes(releases)) {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}.releases`,
				reason: `Target "${id}" has releases "${String(releases)}"; expected one of ${RELEASE_CHANNELS.map((c) => `"${c}"`).join(", ")}`,
			});
		}
		if (provenance !== undefined && typeof provenance !== "boolean") {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}.provenance`,
				reason: `Target "${id}" has a non-boolean provenance; expected true or false`,
			});
		}
		return { releases: releases ?? "all", ...(provenance !== undefined ? { provenance } : {}) };
	};

	const groups = new Map<string, { id: string; name: string; dir: string }>();
	const addGroup = (id: string, name: string): void => {
		if (!groups.has(id)) groups.set(id, { id, name, dir: `dist/prod/${id}/pkg` });
	};

	const resolved: Array<ResolvedTarget> = [];
	const deferredFrom: Array<{ id: string; obj: PublishTargetObject }> = [];

	for (const id of ids) {
		const value = targets[id];
		if (value === true) {
			if (DEFAULT_REGISTRIES[id] === undefined) {
				throw new ConfigValidationError({
					path: `publishConfig.targets.${id}`,
					reason: `Target "${id}: true" is not a known registry; use an object with { registry }`,
				});
			}
			if (id === "github" && !baseName.startsWith("@")) {
				throw new ConfigValidationError({
					path: "publishConfig.targets.github",
					reason: `"github: true" needs a scoped base name; use a string/name override to rescope "${baseName}"`,
				});
			}
			const gid = canonicalId as string; // non-null: this branch implies a true target exists
			addGroup(gid, baseName);
			resolved.push({ id, group: gid, name: baseName, registry: registryFor(id, undefined), ...optionsFor(id, value) });
		} else if (typeof value === "string") {
			if (DEFAULT_REGISTRIES[id] === undefined) {
				throw new ConfigValidationError({
					path: `publishConfig.targets.${id}`,
					reason: `Target "${id}" uses a string name override but has no known registry; use an object { registry, name }`,
				});
			}
			addGroup(id, value);
			resolved.push({ id, group: id, name: value, registry: registryFor(id, undefined), ...optionsFor(id, value) });
		} else if (isTargetObject(value)) {
			if (value.from !== undefined && value.name !== undefined) {
				throw new ConfigValidationError({
					path: `publishConfig.targets.${id}`,
					reason: `Target "${id}" sets both "from" and "name"; they are mutually exclusive`,
				});
			}
			if (value.from !== undefined) {
				deferredFrom.push({ id, obj: value });
			} else if (value.name !== undefined) {
				addGroup(id, value.name);
				resolved.push({
					id,
					group: id,
					name: value.name,
					registry: registryFor(id, value.registry),
					...optionsFor(id, value),
				});
			} else {
				addGroup(id, baseName);
				resolved.push({
					id,
					group: id,
					name: baseName,
					registry: registryFor(id, value.registry),
					...optionsFor(id, value),
				});
			}
		}
	}

	// Bind `from` targets to the referenced group (no new bytes; no chained reuse).
	for (const { id, obj } of deferredFrom) {
		const fromId = obj.from as string;
		if (fromId === id) {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}`,
				reason: `Target "${id}" references itself in "from" (self-referencing from is not allowed)`,
			});
		}
		if (deferredFrom.some((d) => d.id === fromId)) {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}`,
				reason: `Target "${id}" reuses "from: ${fromId}", which itself uses "from" (no chained reuse)`,
			});
		}
		const ref = resolved.find((t) => t.id === fromId);
		if (ref === undefined) {
			throw new ConfigValidationError({
				path: `publishConfig.targets.${id}`,
				reason: `Target "${id}" has a dangling "from: ${fromId}" (no such target)`,
			});
		}
		resolved.push({
			id,
			group: ref.group,
			name: ref.name,
			registry: registryFor(id, obj.registry),
			...optionsFor(id, obj),
		});
	}

	return { groups: [...groups.values()], targets: resolved };
}

/**
 * Advisory warnings for a resolved target set that is valid but probably not what was meant.
 *
 * @remarks
 * Today the only one is a set whose every target is `releases: "prerelease"`, which leaves final
 * versions with nowhere to publish. A warning rather than a {@link ConfigValidationError}, since a
 * prerelease-only package is a legitimate if unusual setup. Pure; returns one message per finding.
 *
 * @public
 */
export function releaseWarnings(resolution: TargetResolution): ReadonlyArray<string> {
	const { targets } = resolution;
	if (targets.length > 0 && targets.every((t) => t.releases === "prerelease")) {
		return [
			`Every publish target sets releases: "prerelease", so final versions publish nowhere; set "all" or "stable" on at least one target`,
		];
	}
	return [];
}
