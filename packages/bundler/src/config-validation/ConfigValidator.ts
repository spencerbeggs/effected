import { Context, Effect, FileSystem, Layer } from "effect";
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

/** The synchronous rule set; throws ConfigValidationError on the first violation. */
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

	// Meta — tagDefinitions syntaxKind valid. That localPaths which exist are directories is checked by the layer,
	// through FileSystem, between these rules and the looseFiles ones.
	//
	// The syntaxKind rule is unreachable from effected.toml: the PackageBuildConfig decode already refuses an invalid
	// syntaxKind as EffectedConfigError. It stays for programmatic callers, which hand Bundler.build or
	// ConfigValidator.validate a plain MetaOptions (a TypeScript interface, so a cast or untyped value passes) with no
	// decode in front of it.
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
	}
}

/** The rules after `meta.localPaths`, which the layer checks against the filesystem between the two. */
function checkLooseFiles(input: ValidationInput): void {
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
	static readonly layer: Layer.Layer<ConfigValidator, never, FileSystem.FileSystem> = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			// A localPaths entry that exists must be a directory; one that does not (or cannot be stat'd) is created later.
			const checkLocalPaths = (paths: ReadonlyArray<string>) =>
				Effect.forEach(paths, (p) =>
					fs.stat(p).pipe(
						Effect.option,
						Effect.flatMap((info) =>
							info._tag === "Some" && info.value.type !== "Directory"
								? Effect.fail(
										new ConfigValidationError({
											path: "meta.localPaths",
											reason: `"${p}" exists but is not a directory`,
										}),
									)
								: Effect.void,
						),
					),
				);
			const run = (rules: () => void) =>
				Effect.try({
					try: rules,
					catch: (e) =>
						e instanceof ConfigValidationError ? e : new ConfigValidationError({ path: "config", reason: String(e) }),
				});
			return {
				validate: (input) =>
					run(() => check(input)).pipe(
						Effect.andThen(checkLocalPaths(input.meta?.localPaths ?? [])),
						Effect.andThen(run(() => checkLooseFiles(input))),
					),
			};
		}),
	);
}
