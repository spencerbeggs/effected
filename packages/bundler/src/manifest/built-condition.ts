// packages/bundler/src/manifest/built-condition.ts
import { ConfigValidationError } from "../errors.js";
import type { Json } from "./transform.js";

/**
 * The export condition that routes a workspace consumer to a sibling's built output instead of its source.
 *
 * @remarks
 * Workspace links resolve to `src/`, which tsx and vitest load and plain Node does not. A consumer that loads a
 * sibling in plain Node, such as a framework CLI importing a workspace plugin, runs with
 * `--conditions=effected-built` and reaches the `./dist/prod/<group>/pkg/...` file this condition names. Every other
 * resolver ignores an unknown condition and falls through to the source. The build strips the condition, so it never
 * publishes.
 *
 * @internal
 */
export const BUILT_CONDITION = "effected-built";

/** The prefix every built-condition target must carry: the build's one output tree. */
const BUILT_PREFIX = "./dist/prod/";

const conditionError = (exportKey: string, reason: string): ConfigValidationError =>
	new ConfigValidationError({ path: `exports."${exportKey}".${BUILT_CONDITION}`, reason });

const isRecord = (value: unknown): value is Json =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Whether a condition object holds the built condition at any depth. */
const holdsCondition = (value: unknown): boolean =>
	isRecord(value) && Object.entries(value).some(([key, inner]) => key === BUILT_CONDITION || holdsCondition(inner));

/**
 * One built-condition target as authored: the export key and the path it names.
 *
 * @internal
 */
export interface BuiltConditionTarget {
	readonly exportKey: string;
	readonly target: string;
}

/**
 * Refuse a built condition that could not take effect or could not be checked, and answer every one that can.
 *
 * @remarks
 * It must be the first key of a subpath's condition object, since Node takes the first condition it matches and
 * `import` and `default` match in plain Node too. Its value must be a literal path under `./dist/prod/`, an `import` or
 * `default` condition naming the source must follow it, and it may not
 * nest inside another condition or sit in a root-level condition object, which has no subpath key to check it against.
 *
 * @internal
 */
export function builtConditionTargets(exports: unknown): ReadonlyArray<BuiltConditionTarget> {
	if (!isRecord(exports)) return [];
	const entries = Object.entries(exports);
	const isSubpathMap = entries.some(([key]) => key.startsWith("."));
	if (!isSubpathMap) {
		if (holdsCondition(exports)) {
			throw conditionError(
				".",
				'a root-level condition object cannot carry it; write the export under a "." subpath key',
			);
		}
		return [];
	}
	const targets: BuiltConditionTarget[] = [];
	for (const [exportKey, value] of entries) {
		if (!isRecord(value)) continue;
		const conditions = Object.entries(value);
		for (const [index, [condition, target]] of conditions.entries()) {
			if (condition !== BUILT_CONDITION) {
				if (holdsCondition(target)) {
					throw conditionError(exportKey, `it cannot nest inside the "${condition}" condition; make it the first key`);
				}
				continue;
			}
			if (index !== 0) {
				throw conditionError(
					exportKey,
					"it must be the first condition, or Node resolves an earlier one (import and default match in plain Node too)",
				);
			}
			if (typeof target !== "string" || !target.startsWith(BUILT_PREFIX) || target.includes("*")) {
				throw conditionError(
					exportKey,
					`its value must be a literal path into the build's output, "${BUILT_PREFIX}<group>/pkg/<file>"`,
				);
			}
			// Without a following import or default, tsx and vitest match nothing and fail ERR_PACKAGE_PATH_NOT_EXPORTED.
			if (
				!conditions
					.slice(1)
					.some(([after, source]) => (after === "import" || after === "default") && typeof source === "string")
			) {
				throw conditionError(
					exportKey,
					'it needs an "import" or "default" condition after it, naming the source every other resolver takes',
				);
			}
			targets.push({ exportKey, target });
		}
	}
	return targets;
}

/**
 * A copy of `pkg` with the built condition removed from every subpath's condition object, and from a root-level
 * condition object. A manifest without it is returned unchanged.
 *
 * @internal
 */
export function stripBuiltCondition<P extends { readonly exports?: unknown }>(pkg: P): P {
	const { exports } = pkg;
	if (!isRecord(exports)) return pkg;
	// A root-level condition object, which the build refuses, still never publishes the condition from a direct caller.
	if (BUILT_CONDITION in exports) {
		const { [BUILT_CONDITION]: _built, ...rest } = exports;
		return { ...pkg, exports: rest };
	}
	if (!Object.values(exports).some((value) => isRecord(value) && BUILT_CONDITION in value)) return pkg;
	const next: Json = {};
	for (const [exportKey, value] of Object.entries(exports)) {
		if (isRecord(value) && BUILT_CONDITION in value) {
			const { [BUILT_CONDITION]: _built, ...rest } = value;
			next[exportKey] = rest;
		} else {
			next[exportKey] = value;
		}
	}
	return { ...pkg, exports: next };
}

/**
 * Each built-condition target that names no file a group emitted for its export, with the path it should name.
 *
 * @remarks
 * `emitted` maps a group id to that group's emitted `exports`. A target matches when it is
 * `./dist/prod/<group>/pkg/` joined to the file the group's manifest exports for the same key under `import` or
 * `default`. The expected path is the first group's.
 *
 * @internal
 */
export function mismatchedBuiltTargets(
	targets: ReadonlyArray<BuiltConditionTarget>,
	emitted: ReadonlyArray<{ readonly groupId: string; readonly exports: unknown }>,
): ReadonlyArray<BuiltConditionTarget & { readonly expected: string | undefined }> {
	const builtPathFor = (groupId: string, exports: unknown, exportKey: string): string | undefined => {
		if (!isRecord(exports)) return undefined;
		const value = exports[exportKey];
		const file = typeof value === "string" ? value : isRecord(value) ? (value.import ?? value.default) : undefined;
		return typeof file === "string" && file.startsWith("./")
			? `${BUILT_PREFIX}${groupId}/pkg/${file.slice(2)}`
			: undefined;
	};
	const out: Array<BuiltConditionTarget & { readonly expected: string | undefined }> = [];
	for (const target of targets) {
		const candidates = emitted.map((group) => builtPathFor(group.groupId, group.exports, target.exportKey));
		if (candidates.includes(target.target)) continue;
		out.push({ ...target, expected: candidates.find((candidate) => candidate !== undefined) });
	}
	return out;
}
