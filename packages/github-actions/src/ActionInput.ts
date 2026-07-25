import type { Layer, Redacted } from "effect";
import { Config, ConfigProvider, Effect, Option, Schema, SchemaIssue } from "effect";

/**
 * The variable name the runner publishes an input under.
 *
 * @remarks
 * GitHub uppercases the input name and replaces **spaces** with underscores —
 * and leaves every other character, **dashes included**, alone. So the input
 * `sbom-config` arrives as `INPUT_SBOM-CONFIG`, not `INPUT_SBOM_CONFIG`.
 *
 * That distinction is not academic: a consumer read `process.env["INPUT_SBOM_CONFIG"]`
 * directly, silently got nothing, and shipped it. Every accessor in this module
 * goes through this function so no caller ever spells the variable name, which
 * makes that class of bug unrepresentable rather than merely documented.
 *
 * @internal
 */
export const inputVariable = (name: string): string => `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;

/**
 * A validation failure for an input that is present but unusable.
 *
 * @remarks
 * `actual` carries the offending value, and that is load-bearing rather than
 * decorative: `Config.withDefault` and `Config.option` fall back only for
 * *missing data*, and their `isMissingDataOnly` check reads an `InvalidValue`
 * whose `actual` is `None` as missing (`Config.ts:304`). An error built without
 * it would therefore be **swallowed by a default** — so `dry-run: yes` would
 * quietly become `false` and the action would perform the mutations the author
 * meant to rehearse.
 */
const configError = (message: string, actual: unknown): Config.ConfigError =>
	new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue(Option.some(actual), { message })));

/** YAML 1.2 core-schema booleans, which is what the runner documents. */
const TRUE = new Set(["true", "True", "TRUE"]);
const FALSE = new Set(["false", "False", "FALSE"]);

/** Strip a trailing `#` comment and surrounding whitespace from one line. */
const stripComment = (line: string): string => {
	const hash = line.indexOf("#");
	return (hash === -1 ? line : line.slice(0, hash)).trim();
};

/**
 * Action inputs, read as `Config` values.
 *
 * @remarks
 * Inputs are **never** read from `process.env` directly. Every accessor names
 * the input the way the workflow author wrote it and lets this module derive
 * the runner's variable name — see {@link inputVariable} for why that matters.
 *
 * `lines`, `list` and `pairs` exist because the `@actions/core`-faithful
 * newline split was not enough for real consumers: two of them reinvented
 * richer parsing independently, one parsing JSON arrays and bullet lists, the
 * other stripping comments and reading `key=value` pairs. Those are now one
 * implementation with one set of tests instead of two divergent ones with
 * none.
 *
 * These are grouped statics over one concept reaching nothing but `Config` —
 * not a namespace object over engines.
 *
 * @example
 * ```ts
 * import { ActionInput } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const dryRun = yield* ActionInput.boolean("dry-run");
 *   const globs = yield* ActionInput.list("paths");
 * });
 * ```
 *
 * @public
 */
export class ActionInput {
	private constructor() {}

	/** A required string input. */
	static string(name: string): Config.Config<string> {
		return Config.string(inputVariable(name));
	}

	/** A boolean input, per the runner's documented YAML 1.2 core schema. */
	static boolean(name: string): Config.Config<boolean> {
		return Config.string(inputVariable(name)).pipe(
			Config.mapOrFail((raw) => {
				const value = raw.trim();
				if (TRUE.has(value)) {
					return Effect.succeed(true);
				}
				if (FALSE.has(value)) {
					return Effect.succeed(false);
				}
				return Effect.fail(
					configError(
						`Input "${name}" does not meet the YAML 1.2 core schema for booleans. ` +
							"Supported: true | True | TRUE | false | False | FALSE",
						raw,
					),
				);
			}),
		);
	}

	/** An integer input. */
	static integer(name: string): Config.Config<number> {
		return Config.int(inputVariable(name));
	}

	/** A secret input, kept redacted. */
	static redacted(name: string): Config.Config<Redacted.Redacted<string>> {
		return Config.redacted(inputVariable(name));
	}

	/**
	 * A multiline input, split on newlines.
	 *
	 * @remarks
	 * The `@actions/core`-faithful shape: blank lines are dropped and each entry
	 * is trimmed, because a YAML block scalar carries the workflow's own
	 * indentation.
	 */
	static lines(name: string): Config.Config<ReadonlyArray<string>> {
		return Config.string(inputVariable(name)).pipe(
			Config.map((raw) =>
				raw
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line !== ""),
			),
		);
	}

	/**
	 * A list input, accepting the three shapes workflow authors actually write.
	 *
	 * @remarks
	 * A JSON array (`["a","b"]`), a bullet list (`- a`), or comma- and
	 * newline-separated values. Each was reinvented in a consumer; accepting all
	 * three means a workflow author's first guess works.
	 */
	static list(name: string): Config.Config<ReadonlyArray<string>> {
		return Config.string(inputVariable(name)).pipe(
			Config.mapOrFail((raw) => {
				const trimmed = raw.trim();
				if (trimmed === "") {
					return Effect.succeed<ReadonlyArray<string>>([]);
				}
				if (trimmed.startsWith("[")) {
					try {
						const parsed: unknown = JSON.parse(trimmed);
						if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
							return Effect.succeed<ReadonlyArray<string>>(parsed as ReadonlyArray<string>);
						}
						return Effect.fail(configError(`Input "${name}" is a JSON array but not an array of strings`, raw));
					} catch {
						return Effect.fail(configError(`Input "${name}" looks like JSON but could not be parsed`, raw));
					}
				}
				const entries = trimmed
					.split(/[\n,]/)
					.map((item) => item.trim())
					// A leading "- " is a YAML bullet, not part of the value.
					.map((item) => (item.startsWith("- ") ? item.slice(2).trim() : item))
					.filter((item) => item !== "");
				return Effect.succeed<ReadonlyArray<string>>(entries);
			}),
		);
	}

	/**
	 * A `key=value` input, one pair per line, with `#` comments stripped.
	 *
	 * @remarks
	 * Only the **first** `=` splits, so a value may contain one.
	 */
	static pairs(name: string): Config.Config<Record<string, string>> {
		return Config.string(inputVariable(name)).pipe(
			Config.mapOrFail((raw) => {
				const result: Record<string, string> = {};
				for (const line of raw.split("\n")) {
					const stripped = stripComment(line);
					if (stripped === "") {
						continue;
					}
					const split = stripped.indexOf("=");
					if (split === -1) {
						return Effect.fail(configError(`Input "${name}" has a line that is not \`key=value\`: "${stripped}"`, raw));
					}
					result[stripped.slice(0, split).trim()] = stripped.slice(split + 1).trim();
				}
				return Effect.succeed(result);
			}),
		);
	}

	/** A JSON-valued input, decoded through a schema. */
	static schema<A, I>(name: string, schema: Schema.Codec<A, I>): Config.Config<A> {
		return Config.string(inputVariable(name)).pipe(
			Config.mapOrFail((raw) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(raw);
				} catch {
					return Effect.fail(configError(`Input "${name}" is not valid JSON`, raw));
				}
				return Schema.decodeUnknownEffect(schema)(parsed).pipe(
					Effect.mapError(() => configError(`Input "${name}" did not satisfy its schema`, parsed)),
				);
			}),
		);
	}

	/**
	 * A `ConfigProvider` over a record of runner variables.
	 *
	 * @remarks
	 * Subsumes the source package's free-standing `ActionsConfigProvider`, whose
	 * three behaviors are preserved exactly: the path is joined with `_`, spaces
	 * become underscores and the whole is uppercased; and an **empty string
	 * reads as absent**, because the runner sets unsupplied inputs to `""` and
	 * treating that as present would make every optional input look supplied.
	 *
	 * Taking the environment as an argument rather than reading `process.env`
	 * is what makes inputs testable without mutating the test process.
	 */
	static provider(env: Readonly<Record<string, string | undefined>> = process.env): ConfigProvider.ConfigProvider {
		return ConfigProvider.make((path) => {
			const value = env[path.join("_").replaceAll(" ", "_").toUpperCase()];
			return Effect.succeed(value === undefined || value === "" ? undefined : ConfigProvider.makeValue(value));
		});
	}

	/**
	 * A layer installing {@link ActionInput.provider}.
	 *
	 * @remarks
	 * `ConfigProvider.ConfigProvider` is a `Context.Reference` in v4, so this is
	 * a reference override rather than a service — there is no
	 * `Effect.withConfigProvider`.
	 *
	 * A parameterized layer factory mints a fresh reference per call; bind it to
	 * a `const` rather than calling it at each composition site.
	 */
	static layer(env?: Readonly<Record<string, string | undefined>>): Layer.Layer<never> {
		return ConfigProvider.layer(ActionInput.provider(env));
	}
}
