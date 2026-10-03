# Schema, state and format

## `schema/inputs.ts` — names as data

```ts
export const INPUT_NAMES = ["some-input", "another-input"] as const;
export type InputName = (typeof INPUT_NAMES)[number];

export interface Inputs {
 readonly someInput: string;
 readonly anotherInput: boolean;
}

const loadInputs: Config.Config<Inputs> = Config.all({
 someInput: ActionInput.string("some-input").pipe(Config.withDefault("default-value")),
 anotherInput: ActionInput.boolean("another-input").pipe(Config.withDefault(false)),
});

export const readInputs: Effect.Effect<Inputs, InputError | Config.ConfigError> = Effect.gen(function* () {
 const inputs = yield* loadInputs;
 // cross-field / content validation belongs here — enum-or-range,
 // disjointness, "at least one of these is active"
 return inputs;
});
```

`INPUT_NAMES` as a `const` tuple — names as data, not just as string literals scattered through the read logic — is what makes "the manifest and the code declare the same inputs" a mechanically checkable fact rather than a convention two files might drift apart on. Defaults here mirror the manifest's own defaults; they are never a second, independently-chosen source of truth. `readInputs` is decoded exactly once, exported separately from the pipeline that uses it, so a test can exercise decoding and cross-field validation without running anything else. See [tests.md](tests.md) for the three-way check this shape enables.

## `schema/outputs.ts` — the all-disabled baseline

```ts
export const OUTPUT_NAMES = ["some-output", "another-output"] as const;

export const initialOutputs: OutputsModel = {
 someOutput: "",
 anotherOutput: false,
};

export const emitOutputs = (model: OutputsModel): Effect.Effect<void, ActionOutputError, ActionOutputs> =>
 Effect.gen(function* () {
  const outputs = yield* ActionOutputs;
  yield* outputs.set("some-output", model.someOutput);
  yield* outputs.set("another-output", String(model.anotherOutput));
 });
```

One emitter, called from exactly two places in the whole program: the up-front baseline write with `initialOutputs`, and every later exit path with what that path knows. See [program-and-steps.md](program-and-steps.md) for the fold this baseline anchors. When one of those outputs is a structured document for a downstream consumer, the schema it encodes through is also what generates its committed JSON Schema — `actions-inputs-outputs`' output-contracts reference owns that recipe.

## `state.ts` — cross-phase state that survives the round trip

```ts
export class MyPhaseState extends Schema.Class<MyPhaseState>("MyPhaseState")({
 startedAt: Schema.Number,
 optionalDetail: Schema.OptionFromNullOr(Schema.String),
}) {}

export const STATE_KEYS = {
 myPhase: "myPhase",
} as const;
```

A value crosses the phase boundary as a file, then republishes to the next process as an environment variable — which means its *encoded* form, not its in-memory shape, is what has to survive. An optional field is `Schema.OptionFromNullOr`, never `Schema.Option`: the latter's encoded form is an `Option` instance with its own serialization, which the far side's decode rejects. The mistake and its failure land in different phases — a save reports success, and only the read on the *other* side of the boundary fails — which is exactly why this gets designed up front rather than discovered in a test. See `designing-an-action`'s checkpoints reference for the full mechanism and the kit's own defense against it.

Brand an id field whose zero value would be invalid — a pid, say — so a truncated or corrupted state value fails typed on the way out of storage rather than silently becoming a value that looks legitimate.

## `format.ts` — the one rendering surface

```ts
export const formatHeadline = (subject: string): string => `Processed: ${subject}`;

export const runContextLines = (inputs: Inputs): ReadonlyArray<string> => [
 "Run context:",
 `  some-input: ${inputs.someInput}`,
];

export const formatSkipped = (step: string, reason: string): string => `Step: ${step} — SKIPPED: ${reason}`;

export const buildSummaryPanel = (outputs: OutputsModel): string =>
 [GitHubMarkdown.heading("Report"), GitHubMarkdown.table(["Fact", "Value"], [["Result", outputs.someOutput]])].join(
  "\n\n",
 );
```

Every human-readable string this action produces — a log line, the run-context block, the closing result block, a job-summary panel — is built here, pure and service-free. A fact that appears in two surfaces (a log line and a summary cell, say) calls the *same* function for both, so the two can never disagree about what happened. Markdown is assembled through the kit's own GFM writer rather than a hand-rolled string join, so escaping is inherited rather than re-derived per action.
