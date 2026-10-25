import { Yaml } from "@effected/yaml";
import { Effect, FileSystem, Result, Schema, SchemaTransformation } from "effect";
import { inputVariable } from "./ActionInput.js";

/** Any value a YAML scalar resolves to. */
type YamlScalarValue = string | number | bigint | boolean | null;

/**
 * A resolved YAML scalar as text: `null` (a bare `key:`, `~`) is `""`, a
 * non-finite number takes YAML's own spelling, and anything else is
 * `String(value)`.
 */
const scalarText = (value: YamlScalarValue): string => {
	if (value === null) return "";
	if (typeof value === "number" && !Number.isFinite(value)) {
		return Number.isNaN(value) ? ".nan" : value > 0 ? ".inf" : "-.inf";
	}
	return String(value);
};

/**
 * A YAML scalar read as the text the runner publishes.
 *
 * @remarks
 * YAML types an unquoted `default: false` as a boolean, `default: 3` as a
 * number and a bare `default:` as null, but the runner hands every value to
 * the action as text. Accepting every scalar and stringifying keeps a
 * manifest author's quoting choice from changing what a test believes the
 * runner sends, and keeps a manifest that published actions really carry
 * from failing to decode.
 *
 * A bare value or `~` reads as `""`, which is what the runner publishes for
 * it. `.inf`, `-.inf` and `.nan` read as those spellings. Any other number is
 * stringified by JavaScript (`String(value)`), so one whose YAML spelling is
 * not its canonical form (`1.0`, `0x10`, `.Inf`) reads as `"1"`, `"16"` or
 * `".inf"` here — quote such a value in `action.yml` to pin its exact text.
 */
const ScalarText = Schema.Union([Schema.String, Schema.Number, Schema.BigInt, Schema.Boolean, Schema.Null]).pipe(
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform<string, YamlScalarValue>({
			decode: scalarText,
			encode: (text: string) => text,
		}),
	),
);

/**
 * A YAML boolean, or the strings `"true"` and `"false"`, which published
 * manifests quote as often as not.
 */
const LenientBoolean = Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]).pipe(
	Schema.decodeTo(
		Schema.Boolean,
		SchemaTransformation.transform<boolean, boolean | "true" | "false">({
			decode: (value) => value === true || value === "true",
			encode: (value) => value,
		}),
	),
);

/**
 * One input an `action.yml` declares under `inputs:`.
 *
 * @remarks
 * `default` is the text the runner publishes when a workflow omits the input;
 * when the manifest declares none, the runner publishes `""` instead — see
 * {@link ActionManifest.runnerInputs}. A `default` written as a workflow
 * expression (`${{ github.token }}`) is evaluated by the runner, so here it is
 * the unevaluated text: supply the evaluated value explicitly in a test.
 *
 * `required` is documentation only — the runner does not enforce it — and
 * `description` is optional here because the runner does not require it
 * either, even though the metadata reference lists it.
 *
 * @public
 */
export class ActionManifestInput extends Schema.Class<ActionManifestInput>("ActionManifestInput")({
	/** What the input is for. */
	description: Schema.optionalKey(Schema.String),
	/**
	 * Whether the manifest marks the input required (not enforced by the
	 * runner); the quoted strings `"true"` and `"false"` decode as booleans.
	 */
	required: Schema.optionalKey(LenientBoolean),
	/**
	 * The text published when a workflow omits the input, stringified from any
	 * YAML scalar; a bare `default:` reads as `""`.
	 */
	default: Schema.optionalKey(ScalarText),
	/** Set when the input is deprecated; the runner warns with this text when a workflow supplies it. */
	deprecationMessage: Schema.optionalKey(Schema.String),
}) {}

/**
 * One output an `action.yml` declares under `outputs:`.
 *
 * @remarks
 * `value` is the expression a composite action maps the output from; a
 * JavaScript or Docker action writes its outputs at runtime and declares none.
 *
 * @public
 */
export class ActionManifestOutput extends Schema.Class<ActionManifestOutput>("ActionManifestOutput")({
	/** What the output carries. */
	description: Schema.optionalKey(Schema.String),
	/** The expression a composite action maps the output from. */
	value: Schema.optionalKey(Schema.String),
}) {}

/**
 * The `runs:` block of a JavaScript action — `using: node24` and its kin.
 *
 * @remarks
 * `using` is any `node<major>` string rather than a closed list, so a manifest
 * written for a runtime newer than this package still decodes. The YAML keys
 * `pre-if` and `post-if` decode to `preIf` and `postIf`.
 *
 * @public
 */
export class ActionManifestNodeRuns extends Schema.Class<ActionManifestNodeRuns>("ActionManifestNodeRuns")({
	/** The Node runtime, such as `node24`. */
	using: Schema.String.check(Schema.isPattern(/^node\d+$/)),
	/** The entry point the `main` phase runs. */
	main: Schema.String,
	/** The entry point the `pre` phase runs, before any step of the job. */
	pre: Schema.optionalKey(Schema.String),
	/** The entry point the `post` phase runs, after every step of the job. */
	post: Schema.optionalKey(Schema.String),
	/** The condition gating the `pre` phase (`pre-if` in YAML). */
	preIf: Schema.optionalKey(Schema.String),
	/** The condition gating the `post` phase (`post-if` in YAML). */
	postIf: Schema.optionalKey(Schema.String),
}) {}

/**
 * The `runs:` block of a composite action.
 *
 * @remarks
 * `steps` stays loosely typed — each step is a mapping — because describing
 * the workflow-step grammar is out of this construct's scope.
 *
 * @public
 */
export class ActionManifestCompositeRuns extends Schema.Class<ActionManifestCompositeRuns>(
	"ActionManifestCompositeRuns",
)({
	/** Always `composite`. */
	using: Schema.Literal("composite"),
	/** The steps the action runs, each an unvalidated mapping. */
	steps: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

/**
 * The `runs:` block of a Docker container action.
 *
 * @remarks
 * The YAML keys `pre-entrypoint`, `post-entrypoint`, `pre-if` and `post-if`
 * decode to camelCase. `args` entries and `env` values are stringified from
 * any YAML scalar, as the runner passes them to the container as text.
 *
 * @public
 */
export class ActionManifestDockerRuns extends Schema.Class<ActionManifestDockerRuns>("ActionManifestDockerRuns")({
	/** Always `docker`. */
	using: Schema.Literal("docker"),
	/** A `Dockerfile` path or a `docker://` image reference. */
	image: Schema.String,
	/** Arguments passed to the container, each stringified from any YAML scalar. */
	args: Schema.optionalKey(Schema.Array(ScalarText)),
	/** Environment variables set in the container. */
	env: Schema.optionalKey(Schema.Record(Schema.String, ScalarText)),
	/** Overrides the image's `ENTRYPOINT`. */
	entrypoint: Schema.optionalKey(Schema.String),
	/** The entry point run before the `main` phase (`pre-entrypoint` in YAML). */
	preEntrypoint: Schema.optionalKey(Schema.String),
	/** The entry point run after the job's steps (`post-entrypoint` in YAML). */
	postEntrypoint: Schema.optionalKey(Schema.String),
	/** The condition gating the `pre` phase (`pre-if` in YAML). */
	preIf: Schema.optionalKey(Schema.String),
	/** The condition gating the `post` phase (`post-if` in YAML). */
	postIf: Schema.optionalKey(Schema.String),
}) {}

/**
 * The three `runs:` shapes an `action.yml` can declare.
 *
 * @public
 */
export type ActionManifestRuns = ActionManifestNodeRuns | ActionManifestCompositeRuns | ActionManifestDockerRuns;

/** The `runs:` union, with each shape's hyphenated YAML keys renamed. */
const Runs = Schema.Union([
	ActionManifestNodeRuns.pipe(Schema.encodeKeys({ preIf: "pre-if", postIf: "post-if" })),
	ActionManifestCompositeRuns,
	ActionManifestDockerRuns.pipe(
		Schema.encodeKeys({
			preEntrypoint: "pre-entrypoint",
			postEntrypoint: "post-entrypoint",
			preIf: "pre-if",
			postIf: "post-if",
		}),
	),
]);

/**
 * The `branding:` block a Marketplace listing reads.
 *
 * @public
 */
export class ActionManifestBranding extends Schema.Class<ActionManifestBranding>("ActionManifestBranding")({
	/** A Feather icon name. */
	icon: Schema.optionalKey(Schema.String),
	/** The badge background colour. */
	color: Schema.optionalKey(Schema.String),
}) {}

/**
 * Raised when an `action.yml` cannot be read from the filesystem.
 *
 * @public
 */
export class ActionManifestReadError extends Schema.TaggedError<ActionManifestReadError>()("ActionManifestReadError", {
	/** The path that was being read. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not read the action manifest at "${this.path}"`;
	}
}

/**
 * Raised when an `action.yml` is not valid YAML, or is YAML that does not
 * have the shape of an action manifest.
 *
 * @remarks
 * One class for both, because the two share every field and no caller
 * recovers from one but not the other: either way the manifest is broken.
 * `detail` is the rendered parse or schema failure and `cause` the structured
 * original.
 *
 * @public
 */
export class ActionManifestDecodeError extends Schema.TaggedError<ActionManifestDecodeError>()(
	"ActionManifestDecodeError",
	{
		/** The rendered parse or schema failure. */
		detail: Schema.String,
		/** The `YamlParseError` or `SchemaError` behind it. */
		cause: Schema.Defect(),
	},
) {
	override get message(): string {
		return `Not a valid action manifest: ${this.detail}`;
	}
}

/**
 * Anything that can go wrong loading an `action.yml`.
 *
 * @public
 */
export type ActionManifestError = ActionManifestReadError | ActionManifestDecodeError;

/**
 * The names an action's code reads and writes, for {@link ActionManifest.diff}.
 *
 * @public
 */
export interface ActionManifestUsage {
	/** The input names the code reads, spelled as in `action.yml`. */
	readonly inputs?: Iterable<string>;
	/** The output names the code writes. Omit to skip the output comparison. */
	readonly outputs?: Iterable<string>;
}

/**
 * Where an action's code and its `action.yml` disagree.
 *
 * @remarks
 * Every list is in declaration or usage order, with duplicates removed. An
 * empty diff — {@link ActionManifestDiff.inSync} — means the code reads every
 * declared input, declares every input it reads, and the same for outputs.
 *
 * @public
 */
export class ActionManifestDiff extends Schema.Class<ActionManifestDiff>("ActionManifestDiff")({
	/** Declared in `action.yml`, never read by the code. */
	unreadInputs: Schema.Array(Schema.String),
	/** Read by the code, not declared in `action.yml` — on a runner it arrives absent. */
	undeclaredInputs: Schema.Array(Schema.String),
	/** Declared in `action.yml`, never written by the code. */
	unwrittenOutputs: Schema.Array(Schema.String),
	/** Written by the code, not declared in `action.yml`. */
	undeclaredOutputs: Schema.Array(Schema.String),
}) {
	/** True when the code and the manifest agree on every name. */
	get inSync(): boolean {
		return (
			this.unreadInputs.length === 0 &&
			this.undeclaredInputs.length === 0 &&
			this.unwrittenOutputs.length === 0 &&
			this.undeclaredOutputs.length === 0
		);
	}
}

/** The names in `names` whose key is absent from `keys`, deduplicated, in order. */
const missingFrom = (
	names: Iterable<string>,
	keys: ReadonlySet<string>,
	key: (name: string) => string,
): Array<string> => {
	const seen = new Set<string>();
	const missing: Array<string> = [];
	for (const name of names) {
		const k = key(name);
		if (!seen.has(k) && !keys.has(k)) {
			missing.push(name);
		}
		seen.add(k);
	}
	return missing;
};

/** The identity key, for outputs. */
const verbatim = (name: string): string => name;

/**
 * A decoded `action.yml`: the action's metadata, its declared inputs and
 * outputs, and the `runs:` block naming how it executes.
 *
 * @remarks
 * `action.yml` is the single source of truth for an action's input names and
 * defaults, and the code mirrors both. This construct makes the mirror
 * testable: {@link ActionManifest.runnerInputs} builds the input environment a
 * real runner builds from the manifest, and {@link ActionManifest.diff} reports
 * where the code's reads and writes disagree with what the manifest declares.
 *
 * `inputs` and `outputs` are keyed by name, in declaration order. Keys this
 * construct does not describe are ignored, so a manifest carrying a newer
 * metadata key still decodes.
 *
 * @example
 * ```ts
 * import { ActionInput, ActionManifest } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const manifest = yield* ActionManifest.read("action.yml");
 *   // Every declared input present, with its manifest default or "".
 *   const layer = ActionInput.layer(ActionManifest.runnerInputs(manifest, { "dry-run": "true" }));
 *   return layer;
 * });
 * ```
 *
 * @public
 */
export class ActionManifest extends Schema.Class<ActionManifest>("ActionManifest")({
	/** The action's display name. */
	name: Schema.String,
	/** What the action does. */
	description: Schema.optionalKey(Schema.String),
	/** Who wrote the action. */
	author: Schema.optionalKey(Schema.String),
	/** The declared inputs, keyed by name. */
	inputs: Schema.optionalKey(Schema.Record(Schema.String, ActionManifestInput)),
	/** The declared outputs, keyed by name. */
	outputs: Schema.optionalKey(Schema.Record(Schema.String, ActionManifestOutput)),
	/** How the action executes. */
	runs: Runs,
	/** The Marketplace badge. */
	branding: Schema.optionalKey(ActionManifestBranding),
}) {
	/**
	 * Decode `action.yml` text, synchronously.
	 *
	 * @remarks
	 * Fails with {@link ActionManifestDecodeError} when the text is not YAML or
	 * not an action manifest. This is the form for a test that wants the
	 * manifest without an effect; {@link ActionManifest.decode} is the same
	 * decode as an `Effect`.
	 */
	static decodeResult(source: string): Result.Result<ActionManifest, ActionManifestDecodeError> {
		return Result.flatMap(
			Result.mapError(
				Yaml.parseResult(source),
				(cause) => new ActionManifestDecodeError({ detail: cause.message, cause }),
			),
			(value) =>
				Result.mapError(
					decodeManifest(value),
					(cause) => new ActionManifestDecodeError({ detail: cause.message, cause }),
				),
		);
	}

	/**
	 * Decode `action.yml` text.
	 *
	 * @remarks
	 * Fails with {@link ActionManifestDecodeError} when the text is not YAML or
	 * not an action manifest.
	 */
	static readonly decode = (source: string): Effect.Effect<ActionManifest, ActionManifestDecodeError> =>
		Effect.fromResult(ActionManifest.decodeResult(source));

	/**
	 * Read and decode the `action.yml` at `path`.
	 *
	 * @remarks
	 * Reads through `FileSystem` in `R`, so a test provides `@effected/memfs`
	 * and production the platform filesystem. A read failure is
	 * {@link ActionManifestReadError}, carrying the path; a malformed manifest is
	 * {@link ActionManifestDecodeError}.
	 */
	static readonly read = Effect.fn("ActionManifest.read")(function* (path: string) {
		const fs = yield* FileSystem.FileSystem;
		const source = yield* fs
			.readFileString(path)
			.pipe(Effect.mapError((cause) => new ActionManifestReadError({ path, cause })));
		return yield* ActionManifest.decode(source);
	});

	/**
	 * The input environment a real runner builds for this manifest.
	 *
	 * @remarks
	 * The runner publishes a variable for **every** declared input: the value
	 * the workflow supplied under `with:`, else the manifest `default`, else
	 * `""`. So "absent" is a state production never produces, and a test built
	 * on an empty `ActionInput.layer({})` exercises the code's
	 * `Config.withDefault` fallbacks rather than the manifest defaults a real
	 * run decodes. This record is the runner-shaped baseline instead.
	 *
	 * Keys are runner variables — `INPUT_` plus the name uppercased with spaces
	 * turned to underscores and every other character, dashes included, kept
	 * (`write-summary` → `INPUT_WRITE-SUMMARY`) — derived through
	 * `ActionInput.variable`, the same function every accessor reads through.
	 * So the record feeds `ActionInput.layer`, spreads into
	 * `ActionEnvironment.layerTest`'s overrides, or becomes a spawned
	 * process's environment unchanged.
	 *
	 * `supplied` is the workflow's `with:` block, keyed by input name, and is
	 * matched to the declared inputs **by runner variable**, the way
	 * {@link ActionManifest.diff} matches: `write summary`, `write_summary` and
	 * `WRITE_SUMMARY` all supply the input declared as `write_summary`. A
	 * supplied value wins even when it is `""`, as on a runner.
	 *
	 * A supplied name the manifest does not declare is **passed through** as
	 * one more `INPUT_` variable, because the runner publishes it too — it only
	 * warns. This never throws. To catch a typo in a test, compare the names
	 * with {@link ActionManifest.diff}, which reports an undeclared read; a
	 * typoed supplied name otherwise leaves the declared input on its default.
	 *
	 * **Composite actions receive no `INPUT_` environment.** The runner
	 * publishes these variables to node and docker actions only; a composite
	 * action reads its inputs through `inputs.<name>` expressions in its steps.
	 * This builder is for node and docker actions, and for a composite test
	 * that drives the inputs into its steps explicitly.
	 *
	 * @param manifest - The decoded manifest.
	 * @param supplied - The workflow's `with:` values, keyed by input name.
	 * @returns The runner's `INPUT_*` variables: one per declared input, then
	 * one per supplied name the manifest does not declare.
	 */
	static runnerInputs(
		manifest: ActionManifest,
		supplied: Readonly<Record<string, string>> = {},
	): Record<string, string> {
		const byVariable = new Map<string, string>();
		for (const [name, value] of Object.entries(supplied)) byVariable.set(inputVariable(name), value);
		const env: Record<string, string> = {};
		for (const [name, input] of Object.entries(manifest.inputs ?? {})) {
			const variable = inputVariable(name);
			env[variable] = byVariable.get(variable) ?? input.default ?? "";
			byVariable.delete(variable);
		}
		// What is left was supplied but not declared: the runner warns and
		// publishes it anyway.
		for (const [variable, value] of byVariable) env[variable] = value;
		return env;
	}

	/**
	 * Compare the names an action's code reads and writes against the names
	 * its manifest declares.
	 *
	 * @remarks
	 * Inputs are matched the way the runner connects them — by runner
	 * variable — so `write summary` in code and `write_summary` in the
	 * manifest are the same input, and so are names differing only in case.
	 * Outputs are matched verbatim. Omitting `usage.outputs` skips the output
	 * comparison, leaving both output lists empty; omitting `usage.inputs`
	 * compares against no reads, so every declared input reports unread.
	 *
	 * @example
	 * ```ts
	 * import { assert, it } from "@effect/vitest";
	 * import { ActionManifest } from "@effected/github-actions";
	 *
	 * declare const manifest: ActionManifest;
	 *
	 * it("action.yml and the code agree", () => {
	 *   const diff = ActionManifest.diff(manifest, { inputs: ["name", "dry-run"], outputs: ["greeting"] });
	 *   assert.isTrue(diff.inSync, JSON.stringify(diff));
	 * });
	 * ```
	 */
	static diff(manifest: ActionManifest, usage: ActionManifestUsage): ActionManifestDiff {
		const declaredInputs = Object.keys(manifest.inputs ?? {});
		const readInputs = [...(usage.inputs ?? [])];
		const compareOutputs = usage.outputs !== undefined;
		const declaredOutputs = compareOutputs ? Object.keys(manifest.outputs ?? {}) : [];
		const writtenOutputs = [...(usage.outputs ?? [])];
		return new ActionManifestDiff({
			unreadInputs: missingFrom(declaredInputs, new Set(readInputs.map(inputVariable)), inputVariable),
			undeclaredInputs: missingFrom(readInputs, new Set(declaredInputs.map(inputVariable)), inputVariable),
			unwrittenOutputs: missingFrom(declaredOutputs, new Set(writtenOutputs), verbatim),
			undeclaredOutputs: missingFrom(writtenOutputs, new Set(declaredOutputs), verbatim),
		});
	}
}

/** The manifest decoder, derived once. */
const decodeManifest = Schema.decodeUnknownResult(ActionManifest);
