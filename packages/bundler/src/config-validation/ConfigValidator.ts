import { existsSync, statSync } from "node:fs";
import { Context, Effect, Layer } from "effect";
import { ConfigValidationError } from "../errors.js";
import type { ExeConfig } from "../exe/config.js";
import { normalizeExeOptions } from "../exe/config.js";
import type { MetaOptions } from "../meta/config.js";
import type { LooseFiles } from "../passes/loose-files.js";
import { normalizeLooseFiles } from "../passes/loose-files.js";
import type { PublishTargets } from "../targets/config.js";
import { resolveTargets } from "../targets/resolve-targets.js";

/**
 * The normalized facts the validator checks, assembled by the bundler before any build work.
 *
 * @public
 */
export interface ValidationInput {
	readonly baseName: string;
	/** Whether the package declares an exports map (for the model-without-exports cross-field rule). */
	readonly hasExports: boolean;
	readonly targets?: PublishTargets | undefined;
	readonly exe?: ExeConfig | ReadonlyArray<ExeConfig> | undefined;
	readonly osCpu?: { readonly os: ReadonlyArray<string>; readonly cpu: ReadonlyArray<string> } | undefined;
	readonly meta?: MetaOptions | undefined;
	/** Standalone bundled output files; validated structurally (extension/format) before any build. */
	readonly looseFiles?: LooseFiles | undefined;
}

const VALID_SYNTAX_KINDS = new Set(["block", "inline", "modifier"]);

/** Synchronous rule set; throws ConfigValidationError on the first violation. */
function check(input: ValidationInput): void {
	// Targets — delegate to resolveTargets (single source of truth; it throws ConfigValidationError).
	if (input.targets !== undefined && Object.keys(input.targets).length > 0) {
		resolveTargets({ targets: input.targets, baseName: input.baseName });
	}

	// Exe — fileName present and non-empty; targets non-empty after inference.
	if (input.exe !== undefined) {
		const specs = normalizeExeOptions(input.exe, input.osCpu ?? { os: [], cpu: [] });
		for (const spec of specs) {
			if (spec.fileName.trim() === "") {
				throw new ConfigValidationError({ path: "exe.fileName", reason: "an exe binary needs a non-empty fileName" });
			}
			if (spec.targets.length === 0) {
				throw new ConfigValidationError({
					path: `exe.${spec.fileName}.targets`,
					reason: "no targets: the package declares no os/cpu and the exe config states none",
				});
			}
		}
	}

	// Meta — tagDefinitions syntaxKind valid; localPaths that exist must be directories.
	if (input.meta !== undefined) {
		// Prerequisite guard: a package with no exports cannot emit a model, so fail fast before validating the rest of the meta config.
		if (!input.hasExports) {
			throw new ConfigValidationError({
				path: "meta",
				reason: "meta requires an exports map to extract an api-model from",
			});
		}
		for (const tag of input.meta.tsdoc?.tagDefinitions ?? []) {
			if (!VALID_SYNTAX_KINDS.has(tag.syntaxKind)) {
				throw new ConfigValidationError({
					path: "meta.tsdoc.tagDefinitions",
					reason: `tag "${tag.tagName}" has an invalid syntaxKind "${tag.syntaxKind}"`,
				});
			}
		}
		for (const p of input.meta.localPaths ?? []) {
			if (existsSync(p) && !statSync(p).isDirectory()) {
				throw new ConfigValidationError({ path: "meta.localPaths", reason: `"${p}" exists but is not a directory` });
			}
		}
	}

	// looseFiles — structural validation only (extension/format). normalizeLooseFiles throws
	// ConfigValidationError on any problem; the layer's validate method surfaces it as a typed failure.
	if (input.looseFiles !== undefined) {
		normalizeLooseFiles(input.looseFiles);
	}
}

/**
 * Fast-fail config validator; runs first in the bundler over the resolved config.
 *
 * @public
 */
export class ConfigValidator extends Context.Service<
	ConfigValidator,
	{ readonly validate: (input: ValidationInput) => Effect.Effect<void, ConfigValidationError> }
>()("@savvy-web/tsdown-plugins/ConfigValidator") {
	static readonly layer: Layer.Layer<ConfigValidator> = Layer.succeed(this, {
		validate: (input) =>
			Effect.try({
				try: () => check(input),
				catch: (e) =>
					e instanceof ConfigValidationError ? e : new ConfigValidationError({ path: "config", reason: String(e) }),
			}),
	});
}
