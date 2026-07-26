import type { Layer, Redacted } from "effect";
import { Config, ConfigProvider, Context, Effect, Option, Schema, SchemaIssue } from "effect";

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
 * the runner's variable name — see `inputVariable` for why that matters. (A
 * `{@link}` cannot reach it: it is internal, so it is not exported from the
 * entrypoint and the reference would not resolve.)
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
 * **The absence contract, shared by every accessor:** the runner writes `""`
 * for an input the workflow left out, and the provider reads an empty string
 * as absent — so *unset* and *empty* are the same case, **missing data**, and
 * the read fails rather than yielding an empty value. `Config.withDefault`
 * falls back for exactly that class, which makes
 * `.pipe(Config.withDefault(…))` the idiom for every optional input. What a
 * default never swallows is a *present but malformed* value — see
 * {@link ActionInput.boolean}.
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

	/**
	 * A required string input.
	 *
	 * @remarks
	 * Fails as *missing data* when the input is absent **or set to the empty
	 * string** — the runner writes `""` for an unsupplied input, and both the
	 * runtime's provider and {@link ActionInput.provider} read that as absent.
	 * Every accessor on this class shares the rule, so an **optional** input
	 * needs `Config.withDefault` (or `Config.option`) at the call site or the
	 * read fails outright.
	 */
	static string(name: string): Config.Config<string> {
		return Config.string(inputVariable(name));
	}

	/**
	 * A boolean input, per the runner's documented YAML 1.2 core schema.
	 *
	 * @remarks
	 * Absent or `""` is **missing data** — wrap with `Config.withDefault` for
	 * an optional flag. A **present but malformed** value (`yes`, `on`, `1`) is
	 * a different class: it fails carrying its `actual`, deliberately, so a
	 * default does NOT swallow it — the shipped defect this guards against was
	 * a malformed `dry-run` quietly reading as `false`.
	 */
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

	/**
	 * An integer input.
	 *
	 * @remarks
	 * Unset and `""` both fail as **missing data**; for an optional input,
	 * `.pipe(Config.withDefault(n))`.
	 */
	static integer(name: string): Config.Config<number> {
		return Config.int(inputVariable(name));
	}

	/**
	 * A secret input, kept redacted.
	 *
	 * @remarks
	 * Unset and `""` both fail as **missing data**; `Config.option` is the
	 * usual shape for an optional secret, since there is rarely a meaningful
	 * default to redact.
	 */
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
	 *
	 * Absent or `""` fails as missing data (see {@link ActionInput.string}) —
	 * `Config.withDefault([])` is load-bearing for an optional multiline input.
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
	 * A list input, accepting the shapes workflow authors actually write.
	 *
	 * @remarks
	 * A JSON array (`["a","b"]`), a bullet list (`- a` or `* a`), or comma- and
	 * newline-separated values, with full-line `#` comments dropped — any
	 * combination of these in the same input. Each shape was reinvented
	 * independently by a consumer (one a bullet-list-and-JSON parser, the other
	 * comment-stripping); accepting the union means a workflow author's first
	 * guess works and nothing either prior consumer relied on regresses.
	 *
	 * Parsing order, applied per newline/comma-separated item after trimming:
	 *
	 * 1. **Comment lines are dropped first.** A trimmed item whose first
	 *    character is `#` is a full-line comment and is discarded entirely,
	 *    before any bullet marker is considered. This means `- #tag` is a
	 *    value, not a comment: the check runs on the untouched, still-bulleted
	 *    item, and `-` is not `#`.
	 * 2. **Only then is a leading bullet marker stripped** — `- ` or `* `
	 *    (dash-or-asterisk followed by a space), mirroring the indentation a
	 *    YAML block scalar carries in. So `- #tag` becomes the value `#tag`.
	 * 3. Blank results (an empty line, or a comment line) are dropped from the
	 *    final list.
	 *
	 * A `#` that is not the first character of a trimmed item — a trailing or
	 * mid-value `#` — is left alone; unlike {@link ActionInput.pairs}, `list`
	 * has no trailing-comment rule, only a whole-line one.
	 *
	 * Absent or `""` fails as **missing data** (see {@link ActionInput.string}),
	 * so `Config.withDefault([])` is load-bearing at every optional-input call
	 * site — omitting an optional multi-value input otherwise fails the read
	 * outright. A *whitespace-only* value (a block scalar holding only a
	 * newline) is present, and parses to `[]`.
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
					// A line whose first character is "#" is a full-line comment,
					// dropped before a bullet marker is considered.
					.filter((item) => !item.startsWith("#"))
					// A leading "- " or "* " is a YAML/Markdown bullet, not part of the value.
					.map((item) => (item.startsWith("- ") || item.startsWith("* ") ? item.slice(2).trim() : item))
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
	 *
	 * Absent or `""` fails as missing data (see {@link ActionInput.string}) —
	 * `Config.withDefault({})` is the idiom for an optional pairs input.
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

	/**
	 * A JSON-valued input, decoded through a schema.
	 *
	 * @remarks
	 * Absent or `""` fails as **missing data** before any JSON parsing runs
	 * (see {@link ActionInput.string}) — `Config.withDefault` or
	 * `Config.option` for an optional input. A present value that is not valid
	 * JSON, or does not satisfy the schema, fails carrying its `actual` and is
	 * never swallowed by a default.
	 */
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

	/**
	 * Inputs-first resolution layered over an existing provider.
	 *
	 * @remarks
	 * A bare `Config.string("dry-run")` resolves a **flat** name — one string
	 * segment — by first trying the variable the runner would have published for
	 * an input of that name (the `INPUT_` derivation this module owns), and only
	 * then trying the name unchanged through `ambient`. Anything the runner
	 * could not have set as an input — a nested path, a numeric segment — is
	 * passed to `ambient` untouched, so no path semantics are invented that the
	 * runner does not have.
	 *
	 * This exists because a live action shipped a **false green**: every bare
	 * `Config` read fell back to its `withDefault` because the runner exposes
	 * inputs as `INPUT_<MANGLED>` variables and a plain-named lookup finds
	 * nothing. Under this provider a bare read resolves through the same
	 * derivation `ActionInput.string` uses, so side-stepping the typed accessors
	 * degrades to the right answer instead of to the default.
	 *
	 * The documented trade: a workflow input named like an environment variable
	 * **shadows it** for bare reads — and because the derivation uppercases,
	 * any casing of the name sees the input. An unsupplied input does not
	 * shadow: the runner writes `""` for it, and the ambient provider's
	 * empty-is-absent rule (which the attempt resolves through) drops it. The
	 * `ActionInput` accessors themselves are unaffected — they read
	 * `INPUT_<MANGLED>` names, whose re-mangled form (`INPUT_INPUT_…`) never
	 * matches, so they fall through to the ambient lookup they always used.
	 */
	static providerOver(ambient: ConfigProvider.ConfigProvider): ConfigProvider.ConfigProvider {
		return ConfigProvider.orElse(
			ConfigProvider.make((path) => {
				const name = path.length === 1 ? path[0] : undefined;
				// The attempt resolves through `ambient` rather than reading an
				// environment of its own, so there is exactly one source of values and
				// exactly one spelling of the derivation (`inputVariable`).
				return typeof name === "string" ? ambient.load([inputVariable(name)]) : Effect.succeed(undefined);
			}),
			ambient,
		);
	}

	/**
	 * The provider the default action runtime installs: {@link ActionInput.providerOver}
	 * composed over the ambient environment lookup.
	 *
	 * @remarks
	 * Installed by `ActionRuntime.layer`, and therefore by `Action.run` — a bare
	 * `Config` read inside an action resolves through the runner's `INPUT_`
	 * derivation instead of silently missing. A caller-supplied
	 * `ConfigProvider` layer still wins by normal layer precedence.
	 *
	 * The ambient half is whatever provider is **explicitly installed** when the
	 * layer builds — which is how a test injects a deterministic environment by
	 * providing `ConfigProvider.layer(ConfigProvider.fromEnv({ env }))` beneath
	 * the runtime. When none is installed, a **fresh** `ConfigProvider.fromEnv()`
	 * is built rather than reading the reference's default: v4 caches that
	 * default once per process, and a snapshot taken before the runner's
	 * variables are visible would resurrect exactly the missed-input class this
	 * layer exists to kill. An action's environment is fixed before the process
	 * starts, so production cannot tell the difference; a test mutating
	 * `process.env` around `Action.run` can.
	 *
	 * A bound constant rather than a factory: layers memoize by reference.
	 */
	static readonly layerDefault: Layer.Layer<never> = ConfigProvider.layer(
		Effect.map(Effect.context<never>(), (context) =>
			ActionInput.providerOver(
				Context.getOrUndefined(context, ConfigProvider.ConfigProvider) ?? ConfigProvider.fromEnv(),
			),
		),
	);
}
