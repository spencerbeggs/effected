import { Context, Effect, Layer, Schema } from "effect";

/**
 * Indicates that the validation engine behind the {@link SchemaValidator}
 * contract failed as a *mechanism* — it could not run at all.
 *
 * By convention the error channel is reserved for exactly that: a document
 * that fails the engine's gate is a {@link ValidationFinding} list (a
 * value), never an error. Raised by implementations of
 * {@link SchemaValidatorShape.validate}.
 *
 * @public
 */
export class SchemaValidatorError extends Schema.TaggedErrorClass<SchemaValidatorError>()("SchemaValidatorError", {
	/** The underlying engine failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return "Schema validation engine failed";
	}
}

/**
 * One problem a validation engine found with a document: a value in a
 * report, never an error channel — the consumer decides what a finding
 * gates.
 *
 * @public
 */
export class ValidationFinding extends Schema.Class<ValidationFinding>("ValidationFinding")({
	/** JSON pointer into the flat document (`""` is the root schema). */
	path: Schema.String,
	/** Human-readable explanation from the engine. */
	message: Schema.String,
	/** The JSON Schema keyword the finding is about, when the engine names one. */
	keyword: Schema.optionalKey(Schema.String),
}) {}

/**
 * Options for {@link SchemaValidatorShape.validate}.
 *
 * @public
 */
export interface SchemaValidatorOptions {
	/**
	 * Whether the engine runs its strictest mode (ajv `strict: true` — the
	 * SchemaStore default gate). Defaults to `true`; implementations treat
	 * an omitted value as strict.
	 */
	readonly strict?: boolean;
}

/**
 * The shape of the {@link SchemaValidator} service — what an implementation
 * provides.
 *
 * @public
 */
export interface SchemaValidatorShape {
	/**
	 * Validates a flat schema document (each `ValidationFinding.path`
	 * pointer addresses `StoreDocument.toJson()`'s shape) with a real JSON
	 * Schema engine. An empty array is a clean pass; a document the engine
	 * rejects — including an ajv strict-mode compile failure — answers
	 * findings as values. The error channel is reserved for the engine
	 * failing as a mechanism ({@link SchemaValidatorError}).
	 */
	readonly validate: (
		document: Record<string, unknown>,
		options?: SchemaValidatorOptions,
	) => Effect.Effect<ReadonlyArray<ValidationFinding>, SchemaValidatorError>;
}

/** The default for an unstubbed {@link SchemaValidator.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`SchemaValidator.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override.`,
		),
	);

/**
 * Contract for real-engine JSON Schema document validation — the seam
 * through which SchemaStore's own gate (ajv strict mode) reaches this
 * package without ajv ever entering its dependency graph.
 *
 * This is a contract-only service: {@link SchemaValidator.noop} is the sole
 * implementation this package ships, and it validates nothing. The consumer
 * closes the seam with a real engine at the application edge — e.g. an ajv
 * adapter whose `validate` compiles the document with
 * `new Ajv({ strict: true, allErrors: true })` and answers compile failures
 * as findings. `DocumentLint` remains the owned, always-available
 * structural half of the validation story.
 *
 * @example
 * ```ts
 * import { SchemaValidator } from "@effected/schemastore";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const validator = yield* SchemaValidator;
 *   return yield* validator.validate({ type: "object" });
 * });
 *
 * Effect.runPromise(Effect.provide(program, SchemaValidator.noop));
 * // => []
 * ```
 *
 * @public
 */
export class SchemaValidator extends Context.Service<SchemaValidator, SchemaValidatorShape>()(
	"@effected/schemastore/SchemaValidator",
) {
	/**
	 * No-op default: `validate` always succeeds with no findings, never
	 * consulting an engine. A pure `Layer.succeed`, bound to a const so the
	 * layer memoizes by reference.
	 */
	static readonly noop: Layer.Layer<SchemaValidator> = Layer.succeed(SchemaValidator, {
		validate: () => Effect.succeed([]),
	});

	/**
	 * An in-memory double: stub only the members the test exercises; every
	 * other member **dies** with a defect naming itself. No member has an
	 * honest default — a fabricated clean pass would leak into consumer
	 * logic as fact (use {@link SchemaValidator.noop} when a test genuinely
	 * wants an always-clean validator).
	 */
	static readonly makeTest = (overrides: Partial<SchemaValidatorShape> = {}): SchemaValidatorShape => ({
		validate: notStubbed("validate"),
		...overrides,
	});

	/** {@link SchemaValidator.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<SchemaValidatorShape> = {}): Layer.Layer<SchemaValidator> =>
		Layer.succeed(SchemaValidator, SchemaValidator.makeTest(overrides));
}
