import { Context, Effect, Layer, Schema } from "effect";

/**
 * Indicates that the validation engine behind the {@link InstanceValidator}
 * contract failed as a *mechanism* — it could not run at all.
 *
 * By convention the error channel is reserved for exactly that: an instance
 * that fails the document is an {@link InstanceFinding} list (a value),
 * never an error. A document the engine cannot compile also lands here —
 * unlike {@link SchemaValidatorError}, whose subject IS the document, this
 * contract's subject is the instance, so a document that yields no verdict
 * means the engine could not run against that instance. Raised by
 * implementations of {@link InstanceValidatorShape.validate}.
 *
 * @public
 */
export class InstanceValidatorError extends Schema.TaggedError<InstanceValidatorError>()("InstanceValidatorError", {
	/** The underlying engine failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return "Instance validation engine failed";
	}
}

/**
 * One problem a validation engine found with an instance: a value in a
 * report, never an error channel — the consumer decides what a finding
 * gates. Structurally the same report {@link ValidationFinding} is for a
 * schema document, but its pointer addresses the INSTANCE, so the two stay
 * separate types: a caller that mixes them up is a compile error, not a
 * silently misread pointer.
 *
 * @public
 */
export class InstanceFinding extends Schema.Class<InstanceFinding>("InstanceFinding")({
	/** JSON pointer into the instance (`""` is the instance root). */
	path: Schema.String,
	/** Human-readable explanation from the engine. */
	message: Schema.String,
	/** The JSON Schema keyword the finding is about, when the engine names one. */
	keyword: Schema.optionalKey(Schema.String),
}) {}

/**
 * Options for {@link InstanceValidatorShape.validate}.
 *
 * @public
 */
export interface InstanceValidatorOptions {
	/**
	 * Whether the engine runs its strictest mode (ajv `strict: true` — the
	 * SchemaStore default gate) when compiling the document. Defaults to
	 * `true`; implementations treat an omitted value as strict.
	 */
	readonly strict?: boolean;
}

/**
 * The shape of the {@link InstanceValidator} service — what an implementation
 * provides.
 *
 * @public
 */
export interface InstanceValidatorShape {
	/**
	 * Validates an arbitrary JSON instance against a schema document with a
	 * real JSON Schema engine. An empty array is a clean pass; an instance
	 * the document rejects answers findings as values, each carrying a JSON
	 * pointer into the instance. The error channel is reserved for the
	 * engine failing as a mechanism ({@link InstanceValidatorError}),
	 * including a document the engine cannot compile.
	 */
	readonly validate: (
		document: Record<string, unknown>,
		instance: unknown,
		options?: InstanceValidatorOptions,
	) => Effect.Effect<ReadonlyArray<InstanceFinding>, InstanceValidatorError>;
}

/** The default for an unstubbed {@link InstanceValidator.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`InstanceValidator.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override.`,
		),
	);

/**
 * The payload-against-document validation contract — the question
 * {@link SchemaValidator} does not answer: not "is this document valid JSON
 * Schema", but "does this instance conform to the published document it
 * names in `$schema`". Decoding with the source Effect Schema is not a
 * substitute: that proves the instance matches the CODE, not the committed
 * document consumers actually fetch, and the two can drift.
 *
 * Like {@link SchemaValidator}, this package ships the contract and its
 * doubles only: skip validation with {@link InstanceValidator.noop}, stub it
 * with {@link InstanceValidator.layerTest}. The one real implementation is
 * `@effected/engine/schema`'s `AjvInstanceValidator.layer` — the same ajv
 * strict-mode setup `AjvValidator` gates documents with, pointed at an
 * instance — which the `schemastore validate` command composes for you and
 * which that package also exports for a program that drives the contract
 * itself. Keeping the engine there keeps `ajv` out of every application
 * that imports this package at runtime.
 *
 * @example
 * ```ts
 * import { InstanceValidator } from "@effected/schemastore";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const validator = yield* InstanceValidator;
 *   return yield* validator.validate({ type: "object" }, { any: "payload" });
 * });
 *
 * // Provide the engine at the edge — the CLI does this for you:
 * //   Effect.provide(program, AjvInstanceValidator.layer)   (from @effected/engine/schema)
 * Effect.runPromise(Effect.provide(program, InstanceValidator.noop));
 * // => []
 * ```
 *
 * @public
 */
export class InstanceValidator extends Context.Service<InstanceValidator, InstanceValidatorShape>()(
	"@effected/schemastore/InstanceValidator",
) {
	/**
	 * No-op: `validate` always succeeds with no findings, never consulting an
	 * engine. A pure `Layer.succeed`, bound to a const so the layer memoizes
	 * by reference. Use it to switch validation off deliberately — for the
	 * real engine, provide `AjvInstanceValidator.layer` from
	 * `@effected/engine/schema`.
	 */
	static readonly noop: Layer.Layer<InstanceValidator> = Layer.succeed(InstanceValidator, {
		validate: () => Effect.succeed([]),
	});

	/**
	 * An in-memory double: stub only the members the test exercises; every
	 * other member **dies** with a defect naming itself. No member has an
	 * honest default — a fabricated clean pass would leak into consumer
	 * logic as fact (use {@link InstanceValidator.noop} when a test genuinely
	 * wants an always-clean validator).
	 */
	static readonly makeTest = (overrides: Partial<InstanceValidatorShape> = {}): InstanceValidatorShape => ({
		validate: notStubbed("validate"),
		...overrides,
	});

	/** {@link InstanceValidator.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<InstanceValidatorShape> = {}): Layer.Layer<InstanceValidator> =>
		Layer.succeed(InstanceValidator, InstanceValidator.makeTest(overrides));
}
